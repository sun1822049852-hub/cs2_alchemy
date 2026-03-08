import json
import logging
import sqlite3
import struct
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from component_manager import ComponentManager, STORAGE_UNIT_DEF_INDEX

try:
    from google.protobuf.json_format import MessageToDict
    from google.protobuf.message import Message
except Exception:  # pragma: no cover - protobuf runtime should exist, fallback for safety
    MessageToDict = None
    Message = None

logger = logging.getLogger("inventory")
PROCESSED_SNAPSHOT_DIR = Path("logs/processed_inventory")
SKIN_DB_PATH = Path("csgo_skins.db")

try:
    from csgo.protobufs.cstrike15_gcmessages_pb2 import CAttribute_String
except Exception:  # pragma: no cover - runtime fallback
    CAttribute_String = None

QUALITY_MAP = {
    4: "Normal",
    9: "StatTrak",
    11: "Souvenir",
}

RARITY_MAP = {
    1: "Consumer",
    2: "Industrial",
    3: "Mil-Spec",
    4: "Restricted",
    5: "Classified",
    6: "Covert",
    7: "Contraband",
}


def wear_name_from_float(float_value: float) -> str:
    if float_value <= 0.07:
        return "Factory New"
    if float_value <= 0.15:
        return "Minimal Wear"
    if float_value <= 0.38:
        return "Field-Tested"
    if float_value <= 0.45:
        return "Well-Worn"
    return "Battle-Scarred"


def build_item_display_name(
    weapon_name: str,
    skin_name: str,
    item_name: str,
    float_value: float,
    custom_name: str = "",
    has_wear: bool = True,
) -> str:
    weapon_name = (weapon_name or "").strip()
    skin_name = (skin_name or "").strip()
    item_name = (item_name or "").strip()
    custom_name = (custom_name or "").strip()

    if weapon_name:
        if skin_name:
            base = f"{weapon_name} | {skin_name}"
        else:
            base = weapon_name
        if has_wear:
            base = f"{base} ({wear_name_from_float(float_value)})"
    else:
        base = item_name or "Unknown Item"

    if custom_name and custom_name != base:
        return f"{base} ({custom_name})"
    return base


@dataclass
class Item:
    asset_id: int
    def_index: int
    quality: int
    rarity: int
    paint_index: int
    paint_seed: int
    float_value: float

    weapon_name: str = ""  # 武器名（由 schema 填充）
    skin_name:   str = ""  # 皮肤名（由 schema 填充）
    item_name:   str = ""  # 非武器物品名（印花/涂鸦/工具等）
    custom_name: str = ""  # 物品自定义名称（例如组件名称）
    has_wear: bool = False
    tradable_after: int = 0
    market_hash_name: str = ""
    alchemy_name: str = ""
    alchemy_collection: str = ""
    alchemy_rarity: str = ""
    alchemy_minfloat: float | None = None
    alchemy_maxfloat: float | None = None
    alchemy_isstattrak: int = 0
    alchemy_wear_range: float | None = None
    is_craftable: bool = False
    craftable_reason: str = ""
    inventory_raw: int = 0
    inventory_pos: int = 0
    inventory_flags: int = 0
    flags: int = 0
    origin: int = 0
    quantity: int = 0
    in_use: bool = False
    casket_id: str = ""
    casket_contained_item_count: int = 0

    @property
    def quality_name(self) -> str:
        return QUALITY_MAP.get(self.quality, f"Unknown({self.quality})")

    @property
    def rarity_name(self) -> str:
        return RARITY_MAP.get(self.rarity, f"Unknown({self.rarity})")

    @property
    def full_name(self) -> str:
        return build_item_display_name(
            weapon_name=self.weapon_name,
            skin_name=self.skin_name,
            item_name=self.item_name,
            float_value=self.float_value,
            custom_name=self.custom_name,
            has_wear=self.has_wear,
        )

    @property
    def status_text(self) -> str:
        return (
            f"origin={self.origin}, flags={self.flags}, in_use={int(self.in_use)}, "
            f"qty={self.quantity}, inv_pos={self.inventory_pos}, inv_flags=0x{self.inventory_flags:08X}"
        )

    def display(self):
        print(
            f"[{self.asset_id}] {self.full_name}\n"
            f"  品质: {self.quality_name}  稀有度: {self.rarity_name}\n"
            f"  磨损: {self.float_value:.10f}  seed: {self.paint_seed}\n"
            f"  状态: {self.status_text}"
        )


def _iter_item_attributes(item):
    attrs = getattr(item, "attribute", None)
    if attrs is None:
        attrs = getattr(item, "attributes", None)
    return attrs or []


def _get_attr_bytes(item, def_index: int) -> bytes:
    """从属性中读取原始 bytes。"""
    for attr in _iter_item_attributes(item):
        if int(getattr(attr, "def_index", 0)) != def_index:
            continue
        raw = getattr(attr, "value_bytes", b"")
        if raw:
            return bytes(raw)
        value_int = int(getattr(attr, "value", 0) or 0)
        if value_int > 0:
            return struct.pack("<I", value_int & 0xFFFFFFFF)
        return b""
    return b""


def _has_attr(item, def_index: int) -> bool:
    for attr in _iter_item_attributes(item):
        if int(getattr(attr, "def_index", 0)) == def_index:
            return True
    return False

def _get_hidden_reason(raw) -> str | None:
    """
    过滤 GC SO 缓存中前台背包不应计入的条目。
    当前已验证的特征：
    - flags == 24
    - 存在 attribute def_index == 277
    """
    try:
        if int(getattr(raw, "flags", 0)) == 24:
            return "flags=24"
    except Exception:
        pass

    try:
        if _has_attr(raw, 277):
            return "attr#277"
    except Exception:
        pass

    try:
        if _has_attr(raw, 272) or _has_attr(raw, 273):
            return "attr#272/273"
    except Exception:
        pass

    return None


def _is_visible_inventory_item(raw) -> bool:
    return _get_hidden_reason(raw) is None


def _get_attr_float(item, def_index: int) -> float:
    """Read float attribute from little-endian bytes."""
    b = _get_attr_bytes(item, def_index)
    if len(b) >= 4:
        return struct.unpack('<f', b[:4])[0]
    return 0.0


def _get_attr_uint32(item, def_index: int, *, decode_float_encoded: bool = True) -> int:
    """Read uint32 attribute from little-endian bytes."""
    b = _get_attr_bytes(item, def_index)
    if len(b) >= 4:
        raw_uint = struct.unpack('<I', b[:4])[0]
        if not decode_float_encoded:
            return raw_uint
        if raw_uint <= 2_000_000:
            return raw_uint
        as_float = struct.unpack('<f', b[:4])[0]
        if 0 <= as_float <= 2_000_000:
            return int(round(as_float))
        return raw_uint
    return 0

def _decode_attr_string(item, def_index: int) -> str:
    raw = _get_attr_bytes(item, def_index)
    if not raw:
        return ""

    if CAttribute_String is not None:
        try:
            msg = CAttribute_String()
            msg.ParseFromString(raw)
            value = getattr(msg, "value", "")
            if value:
                return value.strip()
        except Exception:
            pass

    try:
        return raw.decode("utf-8", errors="ignore").strip()
    except Exception:
        return ""


def _get_casket_id(item) -> str:
    casket_id = ComponentManager.decode_casket_id(item)
    if not casket_id:
        return ""
    try:
        if int(casket_id) == int(getattr(item, "id", 0) or 0):
            return ""
    except Exception:
        pass
    return casket_id


def _get_casket_contained_item_count(item) -> int:
    if int(getattr(item, "def_index", 0)) != STORAGE_UNIT_DEF_INDEX:
        return 0
    return int(_get_attr_uint32(item, 270, decode_float_encoded=False))


def _to_json_safe(value: Any):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).hex()
    if isinstance(value, list):
        return [_to_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _to_json_safe(v) for k, v in value.items()}
    return str(value)


def _raw_item_debug_record(raw) -> dict:
    record = {
        "message_type": raw.__class__.__name__,
        "id": int(getattr(raw, "id", 0)),
        "def_index": int(getattr(raw, "def_index", 0)),
        "quality": int(getattr(raw, "quality", 0)),
        "rarity": int(getattr(raw, "rarity", 0)),
    }

    for field in ("account_id", "inventory", "flags", "origin", "quantity", "level"):
        if hasattr(raw, field):
            try:
                record[field] = int(getattr(raw, field))
            except Exception:
                record[field] = _to_json_safe(getattr(raw, field))

    attrs = []
    for attr in _iter_item_attributes(raw):
        item = {"def_index": int(getattr(attr, "def_index", 0))}
        if hasattr(attr, "value"):
            item["value"] = _to_json_safe(getattr(attr, "value"))
        if hasattr(attr, "value_bytes"):
            item["value_bytes_hex"] = _to_json_safe(getattr(attr, "value_bytes"))
        attrs.append(item)
    record["attributes"] = attrs

    try:
        record["serialized_hex"] = raw.SerializeToString().hex()
    except Exception as e:
        record["serialized_hex_error"] = str(e)

    if MessageToDict is not None and Message is not None and isinstance(raw, Message):
        try:
            record["proto_dict"] = _to_json_safe(
                MessageToDict(raw, preserving_proto_field_name=True)
            )
        except Exception as e:
            record["proto_dict_error"] = str(e)

    record["proto_text"] = str(raw)
    return record


def _save_raw_inventory_dump(dump_path: Path, records: list[dict]):
    dump_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "item_count": len(records),
        "items": records,
    }
    dump_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _fetch_skin_metadata_map(market_hash_names: set[str], db_path: Path = SKIN_DB_PATH) -> dict[str, dict]:
    names = [n.strip() for n in market_hash_names if isinstance(n, str) and n.strip()]
    if not names:
        return {}
    if not db_path.exists():
        logger.warning("skin db not found: %s", db_path)
        return {}

    result: dict[str, dict] = {}
    try:
        with sqlite3.connect(str(db_path)) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            chunk_size = 500
            for i in range(0, len(names), chunk_size):
                chunk = names[i:i + chunk_size]
                placeholders = ",".join(["?"] * len(chunk))
                sql = (
                    "SELECT markethashname, name, collection, rarity, minfloat, maxfloat, isstattrak, wear_range "
                    f"FROM skin WHERE markethashname IN ({placeholders})"
                )
                cur.execute(sql, chunk)
                for row in cur.fetchall():
                    key = str(row["markethashname"]).strip()
                    result[key] = {
                        "name": (row["name"] or "").strip(),
                        "collection": (row["collection"] or "").strip(),
                        "rarity": (row["rarity"] or "").strip(),
                        "minfloat": (float(row["minfloat"]) if row["minfloat"] is not None else None),
                        "maxfloat": (float(row["maxfloat"]) if row["maxfloat"] is not None else None),
                        "isstattrak": int(row["isstattrak"] or 0),
                        "wear_range": (float(row["wear_range"]) if row["wear_range"] is not None else None),
                    }
    except Exception as e:
        logger.warning("fetch skin metadata failed: %s", e)
        return {}
    return result


def _is_craftable_by_skin_meta(meta: dict | None) -> tuple[bool, str]:
    if not meta:
        return False, "meta_not_found"
    if not (meta.get("collection") or "").strip():
        return False, "missing_collection"
    if not (meta.get("rarity") or "").strip():
        return False, "missing_rarity"
    if meta.get("minfloat") is None or meta.get("maxfloat") is None:
        return False, "missing_float_range"
    return True, "ok"


def _build_market_hash_name(item: Item) -> str:
    return build_item_display_name(
        weapon_name=item.weapon_name,
        skin_name=item.skin_name,
        item_name=item.item_name,
        float_value=item.float_value,
        custom_name="",
        has_wear=item.has_wear,
    ).strip()


def _enrich_alchemy_metadata(items: list[Item], excluded_records: list[dict] | None):
    market_hash_names: set[str] = set()
    for item in items:
        mh = _build_market_hash_name(item)
        if mh:
            market_hash_names.add(mh)
    for rec in excluded_records or []:
        mh = str(rec.get("name", "")).strip()
        if mh:
            market_hash_names.add(mh)

    meta_map = _fetch_skin_metadata_map(market_hash_names)

    for item in items:
        mh = _build_market_hash_name(item)
        item.market_hash_name = mh
        meta = meta_map.get(mh)
        if meta:
            item.alchemy_name = meta["name"] or mh
            item.alchemy_collection = meta["collection"]
            item.alchemy_rarity = meta["rarity"]
            item.alchemy_minfloat = meta["minfloat"]
            item.alchemy_maxfloat = meta["maxfloat"]
            item.alchemy_isstattrak = int(meta["isstattrak"] or 0)
            item.alchemy_wear_range = meta["wear_range"]
        else:
            item.alchemy_name = ""
            item.alchemy_collection = ""
            item.alchemy_rarity = ""
            item.alchemy_minfloat = None
            item.alchemy_maxfloat = None
            item.alchemy_isstattrak = 0
            item.alchemy_wear_range = None
        item.is_craftable, item.craftable_reason = _is_craftable_by_skin_meta(meta)

    for rec in excluded_records or []:
        mh = str(rec.get("name", "")).strip()
        rec["market_hash_name"] = mh
        meta = meta_map.get(mh)
        if meta:
            rec["alchemy_name"] = meta["name"] or mh
            rec["alchemy_collection"] = meta["collection"]
            rec["collection"] = meta["collection"]
            rec["alchemy_rarity"] = meta["rarity"]
            rec["minfloat"] = meta["minfloat"]
            rec["maxfloat"] = meta["maxfloat"]
            rec["isstattrak"] = int(meta["isstattrak"] or 0)
            rec["wear_range"] = meta["wear_range"]
        else:
            rec["alchemy_name"] = ""
            rec["alchemy_collection"] = ""
            rec["collection"] = ""
            rec["alchemy_rarity"] = ""
            rec["minfloat"] = None
            rec["maxfloat"] = None
            rec["isstattrak"] = 0
            rec["wear_range"] = None
        is_craftable, craftable_reason = _is_craftable_by_skin_meta(meta)
        rec["is_craftable"] = bool(is_craftable)
        rec["craftable_reason"] = craftable_reason


def _resolve_special_item_name(raw, item_defs: dict) -> str:
    # Sticker / patch / pin 等物品常把真实款式 ID 放在 attr#113
    style_id = int(_get_attr_uint32(raw, 113))
    if style_id > 0:
        name = (item_defs.get(str(style_id), "") or "").strip()
        if name:
            return name

    # Music Kit 常通过 attr#166 携带具体音乐盒 ID
    music_id = int(_get_attr_uint32(raw, 166))
    if music_id > 0:
        music_name = (item_defs.get(str(music_id), "") or "").strip()
        if music_name:
            if music_name.lower().startswith("music kit"):
                return music_name
            return f"Music Kit | {music_name}"

    return ""


def _resolve_display_parts(raw, weapons: dict, paints: dict, item_defs: dict) -> tuple[str, str, str, int, bool]:
    paint_index = _get_attr_uint32(raw, 6)
    resolved_weapon = weapons.get(str(raw.def_index), "")
    resolved_item = item_defs.get(str(raw.def_index), "")
    has_wear = bool(resolved_weapon)

    if resolved_weapon:
        display_weapon = resolved_weapon
        display_item_name = ""
    else:
        display_weapon = ""
        special_name = _resolve_special_item_name(raw, item_defs)
        display_item_name = special_name or resolved_item or f"def#{raw.def_index}"

    return display_weapon, paints.get(str(paint_index), ""), display_item_name, int(paint_index), has_wear


def get_inventory(
    cs2_client,
    schema: dict,
    dump_raw_path: str | Path | None = None,
    excluded_records: list[dict] | None = None,
) -> list[Item]:
    """
    从 SO 缓存读取库存，并结合 schema 填充可读名称。
    SO 缓存是 GC 连接成功后推送的本地镜像，会实时同步。
    """
    weapons = schema.get("weapons", {})
    paints = schema.get("paints", {})
    item_defs = schema.get("item_defs", {})
    items = []

    from csgo.enums import ESOType
    so_items = cs2_client.cs2.socache.get(ESOType.CSOEconItem, {})
    debug_records = [] if dump_raw_path is not None else None

    for raw in so_items.values():
        if debug_records is not None:
            try:
                debug_records.append(_raw_item_debug_record(raw))
            except Exception as e:
                logger.warning("raw item dump failed for id=%s: %s", getattr(raw, "id", "unknown"), e)

        hidden_reason = _get_hidden_reason(raw)
        if hidden_reason is not None:
            if excluded_records is not None:
                display_weapon, skin_name, item_name, paint_index, has_wear = _resolve_display_parts(
                    raw, weapons, paints, item_defs
                )
                float_value = float(_get_attr_float(raw, 8))
                tradable_after = int(_get_attr_uint32(raw, 75, decode_float_encoded=False))
                full_name = build_item_display_name(
                    weapon_name=display_weapon,
                    skin_name=skin_name,
                    item_name=item_name,
                    float_value=float_value,
                    custom_name="",
                    has_wear=has_wear,
                )
                excluded_records.append(
                    {
                        "asset_id": int(getattr(raw, "id", 0)),
                        "def_index": int(getattr(raw, "def_index", 0)),
                        "paint_index": int(paint_index),
                        "paint_seed": int(_get_attr_uint32(raw, 7)),
                        "float_value": float_value,
                        "name": full_name,
                        "quality": int(getattr(raw, "quality", 0)),
                        "rarity": int(getattr(raw, "rarity", 0)),
                        "origin": int(getattr(raw, "origin", 0)),
                        "flags": int(getattr(raw, "flags", 0)),
                        "inventory": int(getattr(raw, "inventory", 0)),
                        "tradable_after": tradable_after,
                        "reason": hidden_reason,
                        "casket_id": _get_casket_id(raw),
                        "casket_contained_item_count": _get_casket_contained_item_count(raw),
                    }
                )
            continue

        display_weapon, skin_name, display_item_name, paint_index, has_wear = _resolve_display_parts(
            raw, weapons, paints, item_defs
        )

        inventory_raw = int(getattr(raw, "inventory", 0))
        inventory_pos = inventory_raw & 0x0000FFFF
        inventory_flags = inventory_raw & 0xFFFF0000

        custom_name = (getattr(raw, "custom_name", "") or "").strip()
        if not custom_name:
            custom_name = _decode_attr_string(raw, 111)

        item = Item(
            asset_id=int(raw.id),
            def_index=int(raw.def_index),
            quality=int(raw.quality),
            # CSOEconItem 的 rarity 来自直接字段，不需要从 attribute 读取
            rarity=int(raw.rarity),
            paint_index=int(paint_index),
            paint_seed=int(_get_attr_uint32(raw, 7)),
            float_value=float(_get_attr_float(raw, 8)),
            weapon_name=display_weapon,
            skin_name=skin_name,
            item_name=display_item_name,
            custom_name=custom_name,
            has_wear=has_wear,
            tradable_after=int(_get_attr_uint32(raw, 75, decode_float_encoded=False)),
            inventory_raw=inventory_raw,
            inventory_pos=inventory_pos,
            inventory_flags=inventory_flags,
            flags=int(getattr(raw, "flags", 0)),
            origin=int(getattr(raw, "origin", 0)),
            quantity=int(getattr(raw, "quantity", 0)),
            in_use=bool(getattr(raw, "in_use", False)),
            casket_id=_get_casket_id(raw),
            casket_contained_item_count=_get_casket_contained_item_count(raw),
        )
        items.append(item)

    if debug_records is not None:
        try:
            _save_raw_inventory_dump(Path(dump_raw_path), debug_records)
        except Exception as e:
            logger.warning("save raw inventory dump failed: %s", e)

    _enrich_alchemy_metadata(items, excluded_records)
    return items


def save_processed_inventory_snapshot(
    items: list[Item],
    excluded_records: list[dict] | None = None,
    out_dir: Path = PROCESSED_SNAPSHOT_DIR,
) -> tuple[Path, list[dict]]:
    now = datetime.now()
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"inventory_processed_{now.strftime('%Y%m%d_%H%M%S')}.json"

    rows: list[dict] = []
    for item in items:
        rows.append(
            {
                "asset_id": int(item.asset_id),
                "def_index": int(item.def_index),
                "paint_index": int(item.paint_index),
                "paint_seed": int(item.paint_seed),
                "float_value": float(item.float_value),
                "quality": int(item.quality),
                "rarity": int(item.rarity),
                "origin": int(item.origin),
                "flags": int(item.flags),
                "inventory": int(item.inventory_raw),
                "tradable_after": int(item.tradable_after),
                "name": item.full_name,
                "market_hash_name": item.market_hash_name,
                "alchemy_name": item.alchemy_name,
                "collection": item.alchemy_collection,
                "alchemy_rarity": item.alchemy_rarity,
                "minfloat": item.alchemy_minfloat,
                "maxfloat": item.alchemy_maxfloat,
                "isstattrak": int(item.alchemy_isstattrak),
                "wear_range": item.alchemy_wear_range,
                "is_craftable": bool(item.is_craftable),
                "craftable_reason": item.craftable_reason,
                "casket_id": str(item.casket_id or "").strip(),
                "casket_contained_item_count": int(item.casket_contained_item_count or 0),
                "hidden_reason": None,
            }
        )

    for rec in excluded_records or []:
        rows.append(
            {
                "asset_id": int(rec.get("asset_id", rec.get("id", 0))),
                "def_index": int(rec.get("def_index", 0)),
                "paint_index": int(rec.get("paint_index", 0)),
                "paint_seed": int(rec.get("paint_seed", 0)),
                "float_value": float(rec.get("float_value", 0.0)),
                "quality": int(rec.get("quality", 0)),
                "rarity": int(rec.get("rarity", 0)),
                "origin": int(rec.get("origin", 0)),
                "flags": int(rec.get("flags", 0)),
                "inventory": int(rec.get("inventory", 0)),
                "tradable_after": int(rec.get("tradable_after", 0)),
                "name": str(rec.get("name", "")).strip(),
                "market_hash_name": str(rec.get("market_hash_name", "")).strip(),
                "alchemy_name": str(rec.get("alchemy_name", "")).strip(),
                "collection": str(rec.get("collection", rec.get("alchemy_collection", ""))).strip(),
                "alchemy_rarity": str(rec.get("alchemy_rarity", "")).strip(),
                "minfloat": rec.get("minfloat"),
                "maxfloat": rec.get("maxfloat"),
                "isstattrak": int(rec.get("isstattrak", 0)),
                "wear_range": rec.get("wear_range"),
                "is_craftable": bool(rec.get("is_craftable", False)),
                "craftable_reason": str(rec.get("craftable_reason", "")),
                "casket_id": str(rec.get("casket_id", "")).strip(),
                "casket_contained_item_count": int(rec.get("casket_contained_item_count", 0) or 0),
                "hidden_reason": str(rec.get("reason") or rec.get("hidden_reason") or "hidden"),
            }
        )

    rows.sort(key=lambda x: int(x.get("asset_id", 0)))
    payload = {
        "format": "processed_inventory_v1",
        "generated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
        "item_count": len(rows),
        "items": rows,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path, rows



