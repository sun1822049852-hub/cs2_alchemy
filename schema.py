"""
CS2 物品 Schema 加载模块

数据来源：ByMykel/CSGO-API（GitHub 静态 JSON，无需 API key）
  - weapons:   def_index(武器/刀/手套) -> 名称
  - paints:    paint_index -> 皮肤名
  - item_defs: def_index(贴纸/涂鸦/工具/收藏品等) -> 名称
"""

import json
import os
import time
from pathlib import Path

import requests

CACHE_FILE = Path("schema_cache.json")
_BASE_URL = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api"
_SCHEMA_LOCALE = "en"
_SKINS_URL = f"{_BASE_URL}/{_SCHEMA_LOCALE}/skins.json"
_ITEM_DEF_ENDPOINTS = (
    "tools",
    "collectibles",
    "music_kits",
    "agents",
    "patches",
    "keychains",
    "graffiti",
    "stickers",
)
_FALLBACK_ITEM_DEFS = {
    # 已在 ByMykel 数据中验证过的常见非武器物品 def_index
    "996": "Global Offensive Badge",
    "1201": "Storage Unit",
    "1209": "Sticker | Zeus (Gold) | MLG Columbus 2016",
    "1314": "Sticker | TaZ (Gold) | MLG Columbus 2016",
    "1348": "Sticker | Natus Vincere (Gold) | Cologne 2016",
    "4001": "Sealed Graffiti | Hop (Brick Red)",
}
_HTTP_TIMEOUT = (10, 90)
_MAX_RETRIES = 4


def _proxy_url() -> str | None:
    # 优先读取项目配置
    try:
        from config import PROXY_URL, USE_PROXY  # type: ignore

        if USE_PROXY and PROXY_URL:
            return str(PROXY_URL)
    except Exception:
        pass

    # 回退到环境变量
    return (
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("http_proxy")
    )


def _fetch_json(url: str):
    proxies = None
    proxy = _proxy_url()
    if proxy:
        proxies = {"http": proxy, "https": proxy}

    last_error = None
    for attempt in range(_MAX_RETRIES):
        try:
            resp = requests.get(
                url,
                timeout=_HTTP_TIMEOUT,
                proxies=proxies,
                headers={"User-Agent": "cs2-alchemy/1.0", "Accept": "application/json"},
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            last_error = e
            if attempt < _MAX_RETRIES - 1:
                time.sleep(1 + attempt)
                continue
            break

    raise RuntimeError(f"拉取失败: {url} ({last_error})")


def _build_weapon_and_paint_maps(skins: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    weapon_map: dict[str, str] = {}
    paint_map: dict[str, str] = {}

    for skin in skins:
        weapon = skin.get("weapon", {})
        weapon_id = weapon.get("weapon_id")
        if weapon_id is not None:
            weapon_map[str(weapon_id)] = weapon.get("name", "")

        paint_index = skin.get("paint_index")
        if paint_index is not None:
            name = skin.get("name", "")
            if " | " in name:
                name = name.split(" | ", 1)[1]
            paint_map[str(paint_index)] = name

    return weapon_map, paint_map


def _build_item_def_map(locale: str = _SCHEMA_LOCALE) -> dict[str, str]:
    item_defs: dict[str, str] = {}
    for endpoint in _ITEM_DEF_ENDPOINTS:
        url = f"{_BASE_URL}/{locale}/{endpoint}.json"
        try:
            data = _fetch_json(url)
        except Exception as e:
            print(f"警告：拉取 {endpoint}.json 失败，已跳过: {e}")
            continue
        if not isinstance(data, list):
            continue

        for item in data:
            def_index = item.get("def_index")
            name = item.get("name")
            if def_index is None or not name:
                continue
            key = str(def_index)
            # 保留首次命中，避免同 def_index 的彩色变体覆盖通用名
            if key not in item_defs:
                item_defs[key] = name

    for key, value in _FALLBACK_ITEM_DEFS.items():
        item_defs.setdefault(key, value)

    return item_defs


def _is_complete_schema(schema: dict) -> bool:
    return (
        isinstance(schema, dict)
        and isinstance(schema.get("weapons"), dict)
        and isinstance(schema.get("paints"), dict)
        and isinstance(schema.get("item_defs"), dict)
        and len(schema.get("item_defs")) > 0
    )


def load_schema(api_key: str = "") -> dict:
    """
    获取 CS2 物品 schema，返回三个映射表：
      weapons: { def_index -> 武器名 }
      paints: { paint_index -> 皮肤名 }
      item_defs: { def_index -> 非武器物品名(贴纸/涂鸦/工具/收藏品等) }
    """
    if CACHE_FILE.exists():
        cached = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        if _is_complete_schema(cached):
            return cached

        # 兼容旧缓存：补齐 item_defs
        if isinstance(cached, dict) and isinstance(cached.get("weapons"), dict) and isinstance(cached.get("paints"), dict):
            print("检测到旧版 schema_cache，正在补充 item_defs 映射...")
            try:
                cached["item_defs"] = _build_item_def_map()
                CACHE_FILE.write_text(json.dumps(cached, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"Schema 补充完成：item_defs={len(cached['item_defs'])}")
            except Exception as e:
                print(f"补充 item_defs 失败，继续使用现有缓存: {e}")
                cached.setdefault("item_defs", {})
            return cached

    print("正在从 GitHub 拉取物品数据...")
    try:
        skins = _fetch_json(_SKINS_URL)
        if not isinstance(skins, list):
            raise RuntimeError("skins.json 结构异常")
        weapon_map, paint_map = _build_weapon_and_paint_maps(skins)
        item_defs = _build_item_def_map()
    except Exception as e:
        raise RuntimeError(f"无法从 GitHub 获取物品数据: {e}")

    schema = {
        "weapons": weapon_map,
        "paints": paint_map,
        "item_defs": item_defs,
    }
    CACHE_FILE.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Schema 已缓存：{len(weapon_map)} 种武器，"
        f"{len(paint_map)} 种皮肤，{len(item_defs)} 种其他物品"
    )
    return schema
