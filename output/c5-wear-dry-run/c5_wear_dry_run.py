#!/usr/bin/env python3
"""
One-off C5 wear range dry-run.

This script intentionally lives under output/ and opens the SQLite database in
read-only mode. It writes only checkpoint/report files next to itself.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import dataclasses
import datetime as dt
import hashlib
import json
import math
import os
import pathlib
import re
import sqlite3
import sys
import time
import urllib.parse
from collections import Counter, defaultdict
from typing import Any

import aiohttp


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
DEFAULT_DB = pathlib.Path.cwd() / "csgo_skins.db"
DEFAULT_OUTPUT_DIR = SCRIPT_DIR

WEAR_ORDER = [
    ("Factory New", "崭新出厂"),
    ("Minimal Wear", "略有磨损"),
    ("Field-Tested", "久经沙场"),
    ("Well-Worn", "破损不堪"),
    ("Battle-Scarred", "战痕累累"),
]
WEAR_RANK_BY_EN = {en: index for index, (en, _zh) in enumerate(WEAR_ORDER)}
WEAR_RANK_BY_ZH = {zh: index for index, (_en, zh) in enumerate(WEAR_ORDER)}
WEAR_EN_BY_ZH = {zh: en for en, zh in WEAR_ORDER}
WEAR_ZH_BY_EN = {en: zh for en, zh in WEAR_ORDER}
KNOWN_WEAR_LEVELS = tuple(WEAR_RANK_BY_EN.keys()) + tuple(WEAR_RANK_BY_ZH.keys())

VERSION_OR_QUALITY_LABELS = {
    "普通版",
    "普通",
    "Normal",
    "normal",
    "暗金",
    "StatTrak",
    "StatTrak™",
    "StatTrak\u2122",
    "纪念品",
    "Souvenir",
    "souvenir",
}

BACKOFF_SECONDS = [1, 2, 4, 8]
FLOAT_TOLERANCE = 1e-8
PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
RANGE_ACCEPT = "application/json, text/plain, */*"


class DryRunError(Exception):
    def __init__(self, error_type: str, message: str, *, blocked: bool = False, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.error_type = error_type
        self.message = message
        self.blocked = blocked
        self.details = details or {}


class RateLimiter:
    def __init__(self, min_interval_seconds: float):
        self.min_interval_seconds = max(0.0, float(min_interval_seconds))
        self._lock = asyncio.Lock()
        self._next_allowed = 0.0

    async def wait(self) -> None:
        if self.min_interval_seconds <= 0:
            return
        async with self._lock:
            now = time.monotonic()
            if now < self._next_allowed:
                await asyncio.sleep(self._next_allowed - now)
                now = time.monotonic()
            self._next_allowed = now + self.min_interval_seconds


@dataclasses.dataclass
class RunPaths:
    output_dir: pathlib.Path
    checkpoint: pathlib.Path
    families: pathlib.Path
    successes: pathlib.Path
    differences: pathlib.Path
    failures: pathlib.Path
    summary: pathlib.Path
    report: pathlib.Path
    events: pathlib.Path


def make_paths(output_dir: pathlib.Path) -> RunPaths:
    return RunPaths(
        output_dir=output_dir,
        checkpoint=output_dir / "checkpoint.json",
        families=output_dir / "families.json",
        successes=output_dir / "successes.current.jsonl",
        differences=output_dir / "differences.current.jsonl",
        failures=output_dir / "failures.current.jsonl",
        summary=output_dir / "summary.json",
        report=output_dir / "report.md",
        events=output_dir / "events.jsonl",
    )


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def json_default(value: Any) -> Any:
    if isinstance(value, pathlib.Path):
        return str(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def write_json_atomic(path: pathlib.Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=True, default=json_default)
        fh.write("\n")
    os.replace(tmp, path)


def append_jsonl(path: pathlib.Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(data, ensure_ascii=False, sort_keys=True, default=json_default))
        fh.write("\n")


def sha256_file(path: pathlib.Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def float_equal(left: float | None, right: float | None, tolerance: float = FLOAT_TOLERANCE) -> bool:
    if left is None or right is None:
        return left is None and right is None
    return abs(float(left) - float(right)) <= tolerance


def canonical_wear(value: Any) -> str | None:
    text = normalize_text(value)
    if text in WEAR_RANK_BY_EN:
        return text
    if text in WEAR_EN_BY_ZH:
        return WEAR_EN_BY_ZH[text]
    return None


def row_wear_rank(row: dict[str, Any]) -> int:
    wear = canonical_wear(row.get("wearlevel"))
    if wear is None:
        return 999
    return WEAR_RANK_BY_EN[wear]


def choose_most_common(values: list[str]) -> str:
    cleaned = [value for value in values if normalize_text(value)]
    if not cleaned:
        return ""
    return Counter(cleaned).most_common(1)[0][0]


def read_skin_rows(db_path: pathlib.Path) -> list[dict[str, Any]]:
    resolved = db_path.resolve()
    uri = f"file:{resolved.as_posix()}?mode=ro"
    placeholders = ",".join("?" for _ in KNOWN_WEAR_LEVELS)
    query = f"""
        SELECT
          id, markethashname, name, basemarkethashname, basename,
          wearlevel, minfloat, maxfloat, wear_range, isstattrak, c5id
        FROM skin
        WHERE wearlevel IN ({placeholders})
        ORDER BY basemarkethashname, basename, id
    """
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in conn.execute(query, KNOWN_WEAR_LEVELS)]
    finally:
        conn.close()


def build_families(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        base_market = normalize_text(row.get("basemarkethashname"))
        base_name = normalize_text(row.get("basename"))
        if not base_market and not base_name:
            continue
        grouped[(base_market, base_name)].append(row)

    families: list[dict[str, Any]] = []
    for (base_market, base_name), group_rows in grouped.items():
        sorted_rows = sorted(group_rows, key=lambda row: (row_wear_rank(row), int(row.get("id") or 0)))
        c5_rows = [row for row in sorted_rows if normalize_text(row.get("c5id"))]
        old_values_counter: Counter[tuple[Any, Any, Any]] = Counter()
        for row in sorted_rows:
            old_values_counter[
                (
                    parse_float(row.get("minfloat")),
                    parse_float(row.get("maxfloat")),
                    parse_float(row.get("wear_range")),
                )
            ] += 1

        old_values = [
            {
                "minfloat": key[0],
                "maxfloat": key[1],
                "wear_range": key[2],
                "row_count": count,
            }
            for key, count in sorted(
                old_values_counter.items(),
                key=lambda item: (-item[1], str(item[0])),
            )
        ]
        common_old = old_values[0] if old_values else {"minfloat": None, "maxfloat": None, "wear_range": None}
        representative = c5_rows[0] if c5_rows else sorted_rows[0]
        family_key = base_market or base_name
        families.append(
            {
                "family_id": f"{base_market}\u241f{base_name}",
                "family_key": family_key,
                "basemarkethashname": base_market,
                "basename": base_name or choose_most_common([normalize_text(row.get("name")) for row in sorted_rows]),
                "representative_c5id": normalize_text(representative.get("c5id")),
                "representative_wearlevel": normalize_text(representative.get("wearlevel")),
                "rows_count": len(sorted_rows),
                "row_ids": [row.get("id") for row in sorted_rows],
                "wearlevels_present": sorted(
                    {canonical_wear(row.get("wearlevel")) or normalize_text(row.get("wearlevel")) for row in sorted_rows},
                    key=lambda wear: WEAR_RANK_BY_EN.get(wear, 999),
                ),
                "old": {
                    "minfloat": common_old.get("minfloat"),
                    "maxfloat": common_old.get("maxfloat"),
                    "wear_range": common_old.get("wear_range"),
                },
                "old_values": old_values,
                "old_inconsistent": len(old_values) > 1,
            }
        )

    return sorted(families, key=lambda family: (family["family_key"], family["basename"], family["representative_c5id"]))


def find_matching(text: str, open_index: int, open_char: str, close_char: str) -> int:
    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(open_index, len(text)):
        char = text[index]
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in ("'", '"'):
            quote = char
            continue
        if char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0:
                return index
    raise ValueError(f"No matching {close_char!r} for {open_char!r} at {open_index}")


def split_top_level(text: str, delimiter: str = ",") -> list[str]:
    parts: list[str] = []
    start = 0
    quote: str | None = None
    escaped = False
    depth_round = 0
    depth_square = 0
    depth_curly = 0
    for index, char in enumerate(text):
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in ("'", '"'):
            quote = char
            continue
        if char == "(":
            depth_round += 1
        elif char == ")":
            depth_round -= 1
        elif char == "[":
            depth_square += 1
        elif char == "]":
            depth_square -= 1
        elif char == "{":
            depth_curly += 1
        elif char == "}":
            depth_curly -= 1
        elif (
            char == delimiter
            and depth_round == 0
            and depth_square == 0
            and depth_curly == 0
        ):
            parts.append(text[start:index].strip())
            start = index + 1
    tail = text[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def parse_js_string_literal(token: str) -> str:
    quote = token[0]
    if quote == '"':
        return json.loads(token)
    if quote != "'":
        raise ValueError(f"Unsupported string token: {token[:20]}")
    content = token[1:-1]
    content = content.replace("\\'", "'")
    return json.loads('"' + content.replace('"', '\\"') + '"')


def parse_js_value(token: str, variables: dict[str, Any]) -> Any:
    token = token.strip()
    if not token:
        return None
    if token in variables:
        return variables[token]
    if token in ("null", "undefined"):
        return None
    if token == "true":
        return True
    if token == "false":
        return False
    if token[0] in ("'", '"'):
        return parse_js_string_literal(token)
    numeric = token
    if numeric.startswith("."):
        numeric = "0" + numeric
    elif numeric.startswith("-."):
        numeric = "-0" + numeric[1:]
    try:
        if re.fullmatch(r"-?\d+", numeric):
            return int(numeric)
        return float(numeric)
    except ValueError:
        return token


def extract_nuxt_script(html: str) -> str:
    marker = "window.__NUXT__="
    start = html.find(marker)
    if start < 0:
        raise DryRunError("page_parse_no_nuxt", "window.__NUXT__ was not found in page HTML")
    end = html.find("</script>", start)
    if end < 0:
        raise DryRunError("page_parse_no_nuxt_script_end", "window.__NUXT__ script end was not found")
    return html[start:end]


def extract_iife_variables(script: str) -> dict[str, Any]:
    function_marker = "(function("
    function_start = script.find(function_marker)
    if function_start < 0:
        return {}
    params_open = function_start + len("(function")
    params_close = find_matching(script, params_open, "(", ")")
    params = [part.strip() for part in script[params_open + 1 : params_close].split(",") if part.strip()]
    body_open = script.find("{", params_close)
    if body_open < 0:
        return {}
    body_close = find_matching(script, body_open, "{", "}")
    args_open = body_close + 1
    while args_open < len(script) and script[args_open].isspace():
        args_open += 1
    if args_open >= len(script) or script[args_open] != "(":
        return {}
    args_close = find_matching(script, args_open, "(", ")")
    arg_tokens = split_top_level(script[args_open + 1 : args_close])
    variables: dict[str, Any] = {}
    for name, token in zip(params, arg_tokens):
        variables[name] = parse_js_value(token, {})
    return variables


def parse_js_object_literal(object_text: str, variables: dict[str, Any]) -> dict[str, Any]:
    text = object_text.strip()
    if text.startswith("{") and text.endswith("}"):
        text = text[1:-1]
    parsed: dict[str, Any] = {}
    for field in split_top_level(text):
        if ":" not in field:
            continue
        key, raw_value = field.split(":", 1)
        key = key.strip().strip("'\"")
        if key not in {"itemId", "tag", "enTag", "marketHashName"}:
            continue
        value = parse_js_value(raw_value, variables)
        if key == "itemId" and value is not None:
            value = str(value)
        parsed[key] = value
    return parsed


def extract_related_list_from_html(html: str) -> list[dict[str, Any]]:
    script = extract_nuxt_script(html)
    variables = extract_iife_variables(script)
    marker = "relatedList:["
    marker_index = script.find(marker)
    if marker_index < 0:
        raise DryRunError("page_parse_no_related_list", "relatedList was not found in window.__NUXT__")
    array_open = marker_index + len("relatedList:")
    array_close = find_matching(script, array_open, "[", "]")
    array_content = script[array_open + 1 : array_close]
    related: list[dict[str, Any]] = []
    for item_text in split_top_level(array_content):
        if not item_text.strip():
            continue
        item = parse_js_object_literal(item_text, variables)
        if item:
            related.append(item)
    if not related:
        raise DryRunError("page_parse_empty_related_list", "relatedList was present but no items were parsed")
    return related


def filter_wear_options(related_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
    wear_options: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in related_list:
        tag = normalize_text(item.get("tag"))
        en_tag = normalize_text(item.get("enTag"))
        if tag in VERSION_OR_QUALITY_LABELS or en_tag in VERSION_OR_QUALITY_LABELS:
            continue
        wear = canonical_wear(en_tag) or canonical_wear(tag)
        if wear is None:
            continue
        item_id = normalize_text(item.get("itemId"))
        if not item_id or item_id in seen:
            continue
        seen.add(item_id)
        copied = dict(item)
        copied["canonical_wear"] = wear
        copied["wear_rank"] = WEAR_RANK_BY_EN[wear]
        wear_options.append(copied)
    return sorted(wear_options, key=lambda item: item["wear_rank"])


def extract_ranges_from_payload(payload: dict[str, Any]) -> list[dict[str, float]]:
    data = payload.get("data")
    if isinstance(data, dict):
        candidates = data.get("list") or data.get("ranges") or data.get("data") or []
    else:
        candidates = data
    if not isinstance(candidates, list):
        raise DryRunError("range_payload_missing_data", "wear range payload data is not a list")
    ranges: list[dict[str, float]] = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        begin = parse_float(item.get("begin"))
        end = parse_float(item.get("end"))
        if begin is None or end is None:
            continue
        ranges.append({"begin": begin, "end": end})
    if not ranges:
        raise DryRunError("range_payload_no_begin_end", "wear range payload did not contain numeric begin/end values")
    return ranges


def compute_new_wear_range(low_ranges: list[dict[str, Any]], high_ranges: list[dict[str, Any]]) -> dict[str, float]:
    low_begins = [parse_float(item.get("begin")) for item in low_ranges]
    high_ends = [parse_float(item.get("end")) for item in high_ranges]
    low_begins = [value for value in low_begins if value is not None]
    high_ends = [value for value in high_ends if value is not None]
    if not low_begins or not high_ends:
        raise DryRunError("range_compute_missing_bounds", "cannot compute min/max from empty begin/end lists")
    minfloat = min(low_begins)
    maxfloat = max(high_ends)
    return {
        "minfloat": minfloat,
        "maxfloat": maxfloat,
        "wear_range": maxfloat - minfloat,
    }


def family_page_url(family: dict[str, Any]) -> str:
    c5id = normalize_text(family.get("representative_c5id"))
    encoded_name = urllib.parse.quote(normalize_text(family.get("basename")) or normalize_text(family.get("family_key")), safe="")
    return f"https://www.c5game.com/CSGO/{c5id}/{encoded_name}/sell"


def range_url(item_id: str) -> str:
    return f"https://api.c5game.com/search/v2/item/{urllib.parse.quote(str(item_id), safe='')}/wear/range"


def classify_http_status(prefix: str, status: int) -> tuple[str, bool]:
    if status == 403:
        return f"{prefix}_http_403", True
    if status == 429:
        return f"{prefix}_http_429", True
    if 500 <= status <= 599:
        return f"{prefix}_http_{status}", False
    return f"{prefix}_http_{status}", False


def classify_non_json_response(prefix: str, text: str, status: int) -> DryRunError:
    head = text[:500]
    lowered = head.casefold()
    blocked_signals = (
        "onload=\"check()\"" in lowered
        or "name=\"parm_0\"" in lowered
        or "aliyuncaptchaconfig" in lowered
        or "captcha" in lowered
        or "验证码" in head
        or "登录" in head
    )
    if blocked_signals:
        return DryRunError(
            f"{prefix}_c5_check_page",
            f"C5 returned a check/login/captcha page instead of JSON for HTTP {status}",
            blocked=True,
            details={"status": status, "body_head": head},
        )
    return DryRunError(
        f"{prefix}_json_decode_error",
        f"C5 returned non-JSON response for HTTP {status}",
        details={"status": status, "body_head": head},
    )


async def fetch_text_with_retries(
    session: aiohttp.ClientSession,
    limiter: RateLimiter,
    url: str,
    *,
    prefix: str,
) -> str:
    last_error: DryRunError | None = None
    for attempt, delay in enumerate([0, *BACKOFF_SECONDS], start=1):
        if delay:
            await asyncio.sleep(delay)
        await limiter.wait()
        try:
            async with session.get(url, headers={"Accept": PAGE_ACCEPT}) as response:
                text = await response.text(errors="replace")
                if response.status == 200:
                    return text
                error_type, blocked = classify_http_status(prefix, response.status)
                last_error = DryRunError(
                    error_type,
                    f"HTTP {response.status} for {url}",
                    blocked=blocked,
                    details={"status": response.status, "attempt": attempt},
                )
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            last_error = DryRunError(
                f"{prefix}_fetch_error",
                f"{type(exc).__name__}: {exc}",
                details={"attempt": attempt},
            )
    assert last_error is not None
    raise last_error


async def fetch_json_with_retries(
    session: aiohttp.ClientSession,
    limiter: RateLimiter,
    url: str,
    *,
    prefix: str,
) -> dict[str, Any]:
    last_error: DryRunError | None = None
    for attempt, delay in enumerate([0, *BACKOFF_SECONDS], start=1):
        if delay:
            await asyncio.sleep(delay)
        await limiter.wait()
        try:
            async with session.get(url, headers={"Accept": RANGE_ACCEPT}) as response:
                text = await response.text(errors="replace")
                if response.status != 200:
                    error_type, blocked = classify_http_status(prefix, response.status)
                    last_error = DryRunError(
                        error_type,
                        f"HTTP {response.status} for {url}",
                        blocked=blocked,
                        details={"status": response.status, "attempt": attempt},
                    )
                    continue
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError as exc:
                    classified = classify_non_json_response(prefix, text, response.status)
                    classified.details["attempt"] = attempt
                    if not classified.message.startswith(type(exc).__name__):
                        classified.message = f"{type(exc).__name__}: {exc}; {classified.message}"
                    last_error = classified
                    continue
                return payload
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            last_error = DryRunError(
                f"{prefix}_fetch_error",
                f"{type(exc).__name__}: {exc}",
                details={"attempt": attempt},
            )
    assert last_error is not None
    raise last_error


def has_difference(family: dict[str, Any], new_values: dict[str, float]) -> bool:
    old = family.get("old") or {}
    return (
        family.get("old_inconsistent")
        or not float_equal(parse_float(old.get("minfloat")), new_values.get("minfloat"))
        or not float_equal(parse_float(old.get("maxfloat")), new_values.get("maxfloat"))
        or not float_equal(parse_float(old.get("wear_range")), new_values.get("wear_range"))
    )


async def process_family(
    family: dict[str, Any],
    session: aiohttp.ClientSession,
    limiter: RateLimiter,
) -> dict[str, Any]:
    if not normalize_text(family.get("representative_c5id")):
        raise DryRunError("family_missing_c5id", "family does not have a representative c5id")

    page = family_page_url(family)
    html = await fetch_text_with_retries(session, limiter, page, prefix="page")
    related = extract_related_list_from_html(html)
    wear_options = filter_wear_options(related)
    if not wear_options:
        raise DryRunError(
            "page_parse_no_wear_options",
            "relatedList contained no accepted wear labels",
            details={"relatedList": related[:10]},
        )

    lowest = wear_options[0]
    highest = wear_options[-1]
    lowest_item_id = normalize_text(lowest.get("itemId"))
    highest_item_id = normalize_text(highest.get("itemId"))
    low_payload = await fetch_json_with_retries(session, limiter, range_url(lowest_item_id), prefix="range")
    low_ranges = extract_ranges_from_payload(low_payload)
    if highest_item_id == lowest_item_id:
        high_payload = low_payload
        high_ranges = low_ranges
    else:
        high_payload = await fetch_json_with_retries(session, limiter, range_url(highest_item_id), prefix="range")
        high_ranges = extract_ranges_from_payload(high_payload)

    new_values = compute_new_wear_range(low_ranges, high_ranges)
    diff = has_difference(family, new_values)
    return {
        "status": "success",
        "has_diff": bool(diff),
        "processed_at": now_iso(),
        "family_id": family["family_id"],
        "family_key": family["family_key"],
        "basemarkethashname": family.get("basemarkethashname"),
        "basename": family.get("basename"),
        "page_url": page,
        "representative_c5id": family.get("representative_c5id"),
        "representative_wearlevel": family.get("representative_wearlevel"),
        "rows_count": family.get("rows_count"),
        "wearlevels_present": family.get("wearlevels_present"),
        "old": family.get("old"),
        "old_values": family.get("old_values"),
        "old_inconsistent": family.get("old_inconsistent"),
        "new": new_values,
        "selected_wear": {
            "lowest": {
                "itemId": lowest_item_id,
                "tag": lowest.get("tag"),
                "enTag": lowest.get("enTag"),
                "canonical_wear": lowest.get("canonical_wear"),
                "ranges": low_ranges,
            },
            "highest": {
                "itemId": highest_item_id,
                "tag": highest.get("tag"),
                "enTag": highest.get("enTag"),
                "canonical_wear": highest.get("canonical_wear"),
                "ranges": high_ranges,
            },
        },
    }


def make_failure_result(family: dict[str, Any], exc: Exception) -> dict[str, Any]:
    if isinstance(exc, DryRunError):
        error_type = exc.error_type
        message = exc.message
        blocked = exc.blocked
        details = exc.details
    else:
        error_type = type(exc).__name__
        message = str(exc)
        blocked = False
        details = {}
    return {
        "status": "failure",
        "has_diff": False,
        "processed_at": now_iso(),
        "family_id": family["family_id"],
        "family_key": family["family_key"],
        "basemarkethashname": family.get("basemarkethashname"),
        "basename": family.get("basename"),
        "representative_c5id": family.get("representative_c5id"),
        "representative_wearlevel": family.get("representative_wearlevel"),
        "rows_count": family.get("rows_count"),
        "wearlevels_present": family.get("wearlevels_present"),
        "old": family.get("old"),
        "error_type": error_type,
        "error_message": message,
        "blocked": bool(blocked),
        "details": details,
    }


def load_checkpoint(path: pathlib.Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "schema": 1,
            "created_at": now_iso(),
            "updated_at": None,
            "runs": [],
            "results": {},
            "db_hashes": {},
        }
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def checkpoint_counts(checkpoint: dict[str, Any], target_family_ids: set[str] | None = None) -> dict[str, int]:
    results = checkpoint.get("results") or {}
    if target_family_ids is None:
        selected = list(results.values())
    else:
        selected = [result for family_id, result in results.items() if family_id in target_family_ids]
    success = sum(1 for result in selected if result.get("status") == "success")
    failures = sum(1 for result in selected if result.get("status") == "failure")
    differences = sum(1 for result in selected if result.get("status") == "success" and result.get("has_diff"))
    return {
        "processed": success + failures,
        "success": success,
        "failure": failures,
        "difference": differences,
    }


def write_current_reports(paths: RunPaths, checkpoint: dict[str, Any], families: list[dict[str, Any]]) -> dict[str, Any]:
    family_ids = {family["family_id"] for family in families}
    results = checkpoint.get("results") or {}
    selected_results = [result for family_id, result in results.items() if family_id in family_ids]
    selected_results.sort(key=lambda result: (result.get("family_key") or "", result.get("basename") or ""))

    successes = [result for result in selected_results if result.get("status") == "success"]
    differences = [result for result in successes if result.get("has_diff")]
    failures = [result for result in selected_results if result.get("status") == "failure"]

    for path, rows in (
        (paths.successes, successes),
        (paths.differences, differences),
        (paths.failures, failures),
    ):
        with path.open("w", encoding="utf-8", newline="\n") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True, default=json_default))
                fh.write("\n")

    failure_types = Counter(result.get("error_type") or "unknown" for result in failures)
    total = len(families)
    counts = checkpoint_counts(checkpoint, family_ids)
    skipped = total - counts["processed"]
    summary = {
        "updated_at": now_iso(),
        "total_families": total,
        "success_count": counts["success"],
        "failure_count": counts["failure"],
        "skip_count": max(0, skipped),
        "difference_count": counts["difference"],
        "failure_type_counts": dict(sorted(failure_types.items())),
        "paths": {
            "checkpoint": str(paths.checkpoint),
            "families": str(paths.families),
            "successes": str(paths.successes),
            "differences": str(paths.differences),
            "failures": str(paths.failures),
            "report": str(paths.report),
        },
        "db_hashes": checkpoint.get("db_hashes") or {},
    }
    write_json_atomic(paths.summary, summary)

    lines = [
        "# C5 Wear Range Dry-Run Report",
        "",
        f"- Updated at: {summary['updated_at']}",
        f"- Total families: {summary['total_families']}",
        f"- Success: {summary['success_count']}",
        f"- Failure: {summary['failure_count']}",
        f"- Skipped / not processed: {summary['skip_count']}",
        f"- Differences: {summary['difference_count']}",
        f"- Difference list: `{paths.differences}`",
        f"- Failure list: `{paths.failures}`",
        "",
        "## Failure Types",
        "",
    ]
    if failure_types:
        for error_type, count in sorted(failure_types.items()):
            lines.append(f"- {error_type}: {count}")
    else:
        lines.append("- None")
    lines.extend(["", "## First 20 Differences", ""])
    if differences:
        for result in differences[:20]:
            lines.append(
                "- {family}: old {old_min}~{old_max} ({old_range}) -> new {new_min}~{new_max} ({new_range})".format(
                    family=result.get("family_key"),
                    old_min=(result.get("old") or {}).get("minfloat"),
                    old_max=(result.get("old") or {}).get("maxfloat"),
                    old_range=(result.get("old") or {}).get("wear_range"),
                    new_min=(result.get("new") or {}).get("minfloat"),
                    new_max=(result.get("new") or {}).get("maxfloat"),
                    new_range=(result.get("new") or {}).get("wear_range"),
                )
            )
    else:
        lines.append("- None")
    lines.extend(["", "## Database Write Guard", ""])
    for name, hashes in sorted((checkpoint.get("db_hashes") or {}).items()):
        lines.append(f"- {name}: before `{hashes.get('before')}`, after `{hashes.get('after')}`")
    paths.report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return summary


def print_progress(prefix: str, total: int, counts: dict[str, int], started_at: float, queue_size: int) -> None:
    elapsed = max(0.001, time.monotonic() - started_at)
    rate = counts["processed"] / elapsed
    print(
        "[{time}] {prefix} processed={processed}/{total} success={success} failure={failure} "
        "diff={diff} pending={pending} rate={rate:.2f}/s".format(
            time=now_iso(),
            prefix=prefix,
            processed=counts["processed"],
            total=total,
            success=counts["success"],
            failure=counts["failure"],
            diff=counts["difference"],
            pending=queue_size,
            rate=rate,
        ),
        flush=True,
    )


async def run_dry_run(args: argparse.Namespace) -> int:
    output_dir = pathlib.Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = make_paths(output_dir)

    db_path = pathlib.Path(args.db).resolve()
    seed_db_path = pathlib.Path(args.seed_db).resolve()
    db_hash_before = sha256_file(db_path)
    seed_hash_before = sha256_file(seed_db_path)

    rows = read_skin_rows(db_path)
    families = build_families(rows)
    if args.family_contains:
        needle = args.family_contains.casefold()
        families = [
            family
            for family in families
            if needle in normalize_text(family.get("family_key")).casefold()
            or needle in normalize_text(family.get("basename")).casefold()
        ]
    if args.limit is not None:
        families = families[: args.limit]
    write_json_atomic(paths.families, families)

    checkpoint = load_checkpoint(paths.checkpoint) if args.resume else load_checkpoint(pathlib.Path("__missing_checkpoint__.json"))
    checkpoint.setdefault("results", {})
    checkpoint.setdefault("runs", [])
    checkpoint.setdefault("db_hashes", {})
    checkpoint["db_hashes"]["csgo_skins.db"] = {"before": db_hash_before, "after": None}
    checkpoint["db_hashes"]["node_sidecar/build/csgo_skins.seed.db"] = {"before": seed_hash_before, "after": None}
    checkpoint["runs"].append(
        {
            "started_at": now_iso(),
            "db": str(db_path),
            "output_dir": str(output_dir),
            "limit": args.limit,
            "concurrency": args.concurrency,
            "min_interval": args.min_interval,
            "resume": args.resume,
            "retry_failures": args.retry_failures,
            "family_contains": args.family_contains,
        }
    )

    target_ids = {family["family_id"] for family in families}
    to_process: list[dict[str, Any]] = []
    skipped_existing = 0
    for family in families:
        existing = checkpoint["results"].get(family["family_id"])
        if existing and not args.retry_failures:
            skipped_existing += 1
            continue
        if existing and existing.get("status") == "success" and args.retry_failures:
            skipped_existing += 1
            continue
        to_process.append(family)

    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    for family in to_process:
        queue.put_nowait(family)

    timeout = aiohttp.ClientTimeout(total=args.request_timeout)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://www.c5game.com/",
    }
    limiter = RateLimiter(args.min_interval)
    checkpoint_lock = asyncio.Lock()
    stop_event = asyncio.Event()
    recent_blocked: list[bool] = []
    started_at = time.monotonic()
    total = len(families)

    print(f"Loaded {len(rows)} skin rows into {len(families)} target families.", flush=True)
    print(f"Resume skipped existing results: {skipped_existing}; queued: {len(to_process)}.", flush=True)
    print(f"Output: {output_dir}", flush=True)

    async def save_result(result: dict[str, Any]) -> None:
        nonlocal recent_blocked
        async with checkpoint_lock:
            checkpoint["results"][result["family_id"]] = result
            checkpoint["updated_at"] = now_iso()
            write_json_atomic(paths.checkpoint, checkpoint)
            append_jsonl(paths.events, result)
            if result.get("status") == "failure":
                recent_blocked.append(bool(result.get("blocked")))
                recent_blocked = recent_blocked[-args.blocked_window :]
            counts = checkpoint_counts(checkpoint, target_ids)
            if counts["processed"] == 1 or counts["processed"] % args.progress_every == 0:
                print_progress("dry-run", total, counts, started_at, queue.qsize())
            blocked_count = sum(1 for value in recent_blocked if value)
            if (
                args.stop_on_blocked
                and len(recent_blocked) >= args.max_blocked_failures
                and blocked_count >= args.max_blocked_failures
                and blocked_count / len(recent_blocked) >= args.blocked_ratio
            ):
                print(
                    f"Stopping early: blocked/limited failures {blocked_count}/{len(recent_blocked)} "
                    f"in recent results.",
                    flush=True,
                )
                stop_event.set()

    async def worker(worker_id: int, session: aiohttp.ClientSession) -> None:
        while not stop_event.is_set():
            try:
                family = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            try:
                result = await process_family(family, session, limiter)
            except Exception as exc:  # noqa: BLE001 - this is a reporting dry-run.
                result = make_failure_result(family, exc)
            await save_result(result)
            queue.task_done()

    async def progress_reporter() -> None:
        while not stop_event.is_set():
            await asyncio.sleep(args.progress_seconds)
            async with checkpoint_lock:
                counts = checkpoint_counts(checkpoint, target_ids)
            print_progress("periodic", total, counts, started_at, queue.qsize())
            if counts["processed"] >= total:
                return

    try:
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            workers = [asyncio.create_task(worker(index + 1, session)) for index in range(args.concurrency)]
            reporter = asyncio.create_task(progress_reporter())
            await asyncio.gather(*workers)
            reporter.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reporter
    except KeyboardInterrupt:
        print("Interrupted; writing current reports from checkpoint.", flush=True)
        stop_event.set()
    finally:
        checkpoint["db_hashes"]["csgo_skins.db"]["after"] = sha256_file(db_path)
        checkpoint["db_hashes"]["node_sidecar/build/csgo_skins.seed.db"]["after"] = sha256_file(seed_db_path)
        checkpoint["updated_at"] = now_iso()
        write_json_atomic(paths.checkpoint, checkpoint)
        summary = write_current_reports(paths, checkpoint, families)
        print_progress("final", total, checkpoint_counts(checkpoint, target_ids), started_at, queue.qsize())
        print("Summary:", json.dumps(summary, ensure_ascii=False), flush=True)

    if stop_event.is_set() and queue.qsize() > 0:
        return 2
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dry-run C5 wear ranges against local skin DB without DB writes.")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Path to csgo_skins.db. Opened with SQLite mode=ro.")
    parser.add_argument(
        "--seed-db",
        default=str(pathlib.Path.cwd() / "node_sidecar" / "build" / "csgo_skins.seed.db"),
        help="Seed DB path used only for before/after hashing.",
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Checkpoint/report directory.")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of target families, for smoke runs.")
    parser.add_argument("--concurrency", type=int, default=3, help="Small C5 concurrency. Recommended 2-6.")
    parser.add_argument("--min-interval", type=float, default=0.35, help="Minimum seconds between request starts.")
    parser.add_argument("--request-timeout", type=float, default=30.0, help="Per-request timeout in seconds.")
    parser.add_argument("--progress-seconds", type=float, default=300.0, help="Periodic progress interval.")
    parser.add_argument("--progress-every", type=int, default=25, help="Print progress every N completed families.")
    parser.add_argument("--resume", dest="resume", action="store_true", default=True, help="Resume from checkpoint.")
    parser.add_argument("--no-resume", dest="resume", action="store_false", help="Ignore existing checkpoint.")
    parser.add_argument("--retry-failures", action="store_true", help="Retry checkpoint failures; keep successes.")
    parser.add_argument("--family-contains", default=None, help="Optional substring filter for targeted checks.")
    parser.add_argument("--stop-on-blocked", dest="stop_on_blocked", action="store_true", default=True)
    parser.add_argument("--no-stop-on-blocked", dest="stop_on_blocked", action="store_false")
    parser.add_argument("--max-blocked-failures", type=int, default=5)
    parser.add_argument("--blocked-window", type=int, default=20)
    parser.add_argument("--blocked-ratio", type=float, default=0.5)
    args = parser.parse_args(argv)
    if args.concurrency < 1 or args.concurrency > 8:
        parser.error("--concurrency must be between 1 and 8")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    return asyncio.run(run_dry_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
