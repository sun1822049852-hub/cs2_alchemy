import logging
import time
from dataclasses import dataclass
from typing import Any

from csgo.enums import ESOType
from csgo.proto_enums import ECsgoGCMsg

try:
    from csgo.protobufs.econ_gcmessages_pb2 import CMsgCasketItem
except Exception:  # pragma: no cover
    CMsgCasketItem = None

logger = logging.getLogger("component_manager")

STORAGE_UNIT_DEF_INDEX = 1201
_CASKET_ID_LOW_ATTR = 272
_CASKET_ID_HIGH_ATTR = 273
_CASKET_LOAD_CONTENTS_EMSG = 1094


@dataclass
class ComponentSummary:
    component_id: str
    asset_id: int
    name: str
    expected_count: int
    loaded_count: int


class ComponentManager:
    """Storage Unit loading and index building."""

    def preload_component_contents(
        self,
        cs2_client,
        *,
        request_interval_seconds: float = 0.08,
        settle_seconds: float = 2.0,
        max_wait_seconds: float = 8.0,
    ) -> int:
        component_ids = self._collect_component_ids_from_socache(cs2_client)
        if not component_ids:
            return 0

        baseline_loaded = self._count_items_with_component_id(cs2_client)
        sent = 0
        for component_id in component_ids:
            try:
                # For load-contents, item_item_id is a cursor; first page should use 0.
                self._send_component_load_request(cs2_client, int(component_id), cursor_item_id=0)
                sent += 1
            except Exception as exc:
                logger.warning(
                    "request component load failed: component=%s err_type=%s err=%s",
                    component_id,
                    type(exc).__name__,
                    exc,
                )
            time.sleep(max(0.0, request_interval_seconds))

        if sent > 0:
            self._wait_component_items_settled(
                cs2_client,
                baseline_loaded=baseline_loaded,
                settle_seconds=max(0.0, settle_seconds),
                max_wait_seconds=max(0.0, max_wait_seconds),
            )
        return sent

    @staticmethod
    def _send_component_load_request(cs2_client, component_id: int, *, cursor_item_id: int = 0):
        enum_send_error: Exception | None = None

        emsg_enum = getattr(ECsgoGCMsg, "EMsgGCCasketItemLoadContents", None)
        if emsg_enum is not None:
            try:
                cs2_client.cs2.send(
                    emsg_enum,
                    {
                        "casket_item_id": int(component_id),
                        "item_item_id": int(cursor_item_id),
                    },
                )
                return
            except Exception as exc:
                enum_send_error = exc

        if CMsgCasketItem is not None and hasattr(cs2_client.cs2, "send_raw_gc"):
            msg = CMsgCasketItem()
            msg.casket_item_id = int(component_id)
            msg.item_item_id = int(cursor_item_id)
            cs2_client.cs2.send_raw_gc(_CASKET_LOAD_CONTENTS_EMSG, msg.SerializeToString())
            return

        if enum_send_error is not None:
            raise enum_send_error
        raise RuntimeError("casket load request unavailable: missing enum and raw fallback")

    def _wait_component_items_settled(
        self,
        cs2_client,
        *,
        baseline_loaded: int,
        settle_seconds: float,
        max_wait_seconds: float,
    ):
        min_wait_deadline = time.time() + settle_seconds
        hard_deadline = time.time() + max_wait_seconds
        last_loaded = -1
        stable_ticks = 0

        while time.time() < hard_deadline:
            loaded_now = self._count_items_with_component_id(cs2_client)
            if loaded_now == last_loaded:
                stable_ticks += 1
            else:
                stable_ticks = 0
                last_loaded = loaded_now

            reached_min_wait = time.time() >= min_wait_deadline
            if reached_min_wait and loaded_now > baseline_loaded and stable_ticks >= 2:
                break
            if reached_min_wait and loaded_now == baseline_loaded and stable_ticks >= 6:
                break

            time.sleep(0.2)

        loaded_final = self._count_items_with_component_id(cs2_client)
        if loaded_final <= baseline_loaded:
            logger.warning(
                "component preload finished but no extra component items found (baseline=%s current=%s)",
                baseline_loaded,
                loaded_final,
            )
        else:
            logger.info(
                "component preload finished (baseline=%s current=%s)",
                baseline_loaded,
                loaded_final,
            )

    def _count_items_with_component_id(self, cs2_client) -> int:
        so_items = cs2_client.cs2.socache.get(ESOType.CSOEconItem, {})
        cnt = 0
        for raw in so_items.values():
            if self.decode_casket_id(raw):
                cnt += 1
        return cnt

    def build_component_index(self, entries: list[Any]) -> tuple[dict[str, ComponentSummary], dict[str, list[Any]]]:
        component_items: dict[str, list[Any]] = {}
        component_meta: dict[str, Any] = {}

        for entry in entries:
            component_id = str(getattr(entry, "casket_id", "") or "").strip()
            if component_id:
                component_items.setdefault(component_id, []).append(entry)

            if int(getattr(entry, "def_index", 0)) == STORAGE_UNIT_DEF_INDEX:
                key = str(int(getattr(entry, "asset_id", 0)))
                component_meta[key] = entry

        summary_map: dict[str, ComponentSummary] = {}
        for component_id, entry in component_meta.items():
            name = str(getattr(entry, "alchemy_name", "") or "").strip() or str(getattr(entry, "name", "") or "").strip()
            expected_count = int(getattr(entry, "casket_contained_item_count", 0) or 0)
            loaded_count = len(component_items.get(component_id, []))
            summary_map[component_id] = ComponentSummary(
                component_id=component_id,
                asset_id=int(getattr(entry, "asset_id", 0)),
                name=name or f"组件 {component_id}",
                expected_count=expected_count,
                loaded_count=loaded_count,
            )
        return summary_map, component_items

    @staticmethod
    def _collect_component_ids_from_socache(cs2_client) -> list[int]:
        so_items = cs2_client.cs2.socache.get(ESOType.CSOEconItem, {})
        component_ids = sorted(
            {
                int(getattr(raw, "id", 0))
                for raw in so_items.values()
                if int(getattr(raw, "def_index", 0)) == STORAGE_UNIT_DEF_INDEX and int(getattr(raw, "id", 0)) > 0
            }
        )
        return component_ids

    @staticmethod
    def decode_casket_id(raw_item) -> str:
        low = ComponentManager._read_attr_u32(raw_item, _CASKET_ID_LOW_ATTR)
        high = ComponentManager._read_attr_u32(raw_item, _CASKET_ID_HIGH_ATTR)
        if low > 0 or high > 0:
            return str((high << 32) | low)

        # 保守兜底：仅在疑似“隐藏条目”时才尝试 original_id，避免把普通库存误判为组件内物品。
        try:
            flags = int(getattr(raw_item, "flags", 0) or 0)
            if flags != 24:
                return ""
            item_id = int(getattr(raw_item, "id", 0) or 0)
            original_id = int(getattr(raw_item, "original_id", 0) or 0)
            if original_id > 0 and original_id != item_id:
                return str(original_id)
        except Exception:
            pass
        return ""

    @staticmethod
    def _read_attr_u32(raw_item, def_index: int) -> int:
        for attr in getattr(raw_item, "attribute", []):
            try:
                if int(getattr(attr, "def_index", 0)) != def_index:
                    continue
                value_bytes = bytes(getattr(attr, "value_bytes", b""))
                if len(value_bytes) >= 4:
                    return int.from_bytes(value_bytes[:4], byteorder="little", signed=False)
                value_int = int(getattr(attr, "value", 0) or 0)
                if value_int > 0:
                    return value_int
                return 0
            except Exception:
                return 0
        return 0
