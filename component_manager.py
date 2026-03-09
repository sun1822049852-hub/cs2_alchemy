import logging
import time
from dataclasses import dataclass
from typing import Any

from csgo.enums import ESOType
from csgo.proto_enums import ECsgoGCMsg
try:
    from csgo.proto_enums import EGCItemMsg
except Exception:  # pragma: no cover
    EGCItemMsg = None

try:
    from csgo.protobufs.econ_gcmessages_pb2 import (
        CMsgCasketItem,
        CMsgGCItemCustomizationNotification,
        k_EGCItemCustomizationNotification_CasketContents,
    )
except Exception:  # pragma: no cover
    CMsgCasketItem = None
    CMsgGCItemCustomizationNotification = None
    k_EGCItemCustomizationNotification_CasketContents = 1012

logger = logging.getLogger("component_manager")

STORAGE_UNIT_DEF_INDEX = 1201
_CASKET_ID_LOW_ATTR = 272
_CASKET_ID_HIGH_ATTR = 273
_CASKET_LOAD_CONTENTS_EMSG = 1094
_ITEM_CUSTOMIZATION_EMSG = 1090
_CASKET_CONTENTS_NOTIFICATION = int(k_EGCItemCustomizationNotification_CasketContents or 1012)


@dataclass
class ComponentSummary:
    component_id: str
    asset_id: int
    name: str
    expected_count: int
    loaded_count: int


class ComponentManager:
    """Storage Unit loading and index building."""

    def __init__(self):
        self.last_preload_stats: dict[str, int] = {
            "sent": 0,
            "waiting": 0,
            "notified": 0,
            "baseline_loaded": 0,
            "final_loaded": 0,
        }

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
            self.last_preload_stats = {
                "sent": 0,
                "waiting": 0,
                "notified": 0,
                "baseline_loaded": 0,
                "final_loaded": 0,
            }
            return 0

        waiting_ids = {int(x) for x in component_ids if int(x) > 0}
        notified_ids: set[int] = set()
        detach_listener = self._attach_component_notification_listener(cs2_client, waiting_ids, notified_ids)

        baseline_loaded = self._count_items_with_component_id(cs2_client)
        self.last_preload_stats = {
            "sent": 0,
            "waiting": len(waiting_ids),
            "notified": 0,
            "baseline_loaded": int(baseline_loaded),
            "final_loaded": int(baseline_loaded),
        }
        sent = 0
        try:
            for component_id in component_ids:
                try:
                    # 与 node-globaloffensive 对齐：item_item_id 使用 casket 本身 id 触发加载。
                    self._send_component_load_request(cs2_client, int(component_id), cursor_item_id=int(component_id))
                    sent += 1
                    self._wait_single_component_notification(
                        component_id=int(component_id),
                        notified_ids=notified_ids,
                        max_wait_seconds=max(1.0, max_wait_seconds / max(1, len(component_ids))),
                    )
                except Exception as exc:
                    logger.warning(
                        "request component load failed: component=%s err_type=%s err=%s",
                        component_id,
                        type(exc).__name__,
                        exc,
                    )
                time.sleep(max(0.0, request_interval_seconds))

            if sent > 0:
                self._wait_component_notifications(
                    waiting_ids=waiting_ids,
                    notified_ids=notified_ids,
                    max_wait_seconds=max(0.0, max_wait_seconds),
                )
                self._wait_component_items_settled(
                    cs2_client,
                    baseline_loaded=baseline_loaded,
                    settle_seconds=max(0.0, settle_seconds),
                    max_wait_seconds=max(0.0, max_wait_seconds),
                )
            final_loaded = self._count_items_with_component_id(cs2_client)
            self.last_preload_stats = {
                "sent": int(sent),
                "waiting": len(waiting_ids),
                "notified": len(notified_ids),
                "baseline_loaded": int(baseline_loaded),
                "final_loaded": int(final_loaded),
            }
        finally:
            detach_listener()
        return sent

    @staticmethod
    def _wait_single_component_notification(*, component_id: int, notified_ids: set[int], max_wait_seconds: float):
        deadline = time.time() + max(0.3, max_wait_seconds)
        while time.time() < deadline:
            if int(component_id) in notified_ids:
                return
            time.sleep(0.05)

    def _attach_component_notification_listener(self, cs2_client, waiting_ids: set[int], notified_ids: set[int]):
        gc = getattr(cs2_client, "cs2", None)
        if gc is None:
            return lambda: None

        event_keys: list[Any] = ["itemCustomizationNotification", _ITEM_CUSTOMIZATION_EMSG]
        if EGCItemMsg is not None:
            ev = getattr(EGCItemMsg, "EMsgGCItemCustomizationNotification", None)
            if ev is not None:
                event_keys.append(ev)

        unique_event_keys = list(dict.fromkeys(event_keys))

        def _on_notify(*args):
            if len(args) >= 2 and isinstance(args[0], (list, tuple)):
                ids = []
                req = 0
                try:
                    ids = [int(x) for x in args[0] if int(x) > 0]
                    req = int(args[1] or 0)
                except Exception:
                    return
                if req != _CASKET_CONTENTS_NOTIFICATION:
                    return
            else:
                if not args:
                    return
                ids = self._extract_casket_contents_ids(args[0])
                if not ids:
                    return
            for cid in ids:
                if cid in waiting_ids:
                    notified_ids.add(cid)

        for key in unique_event_keys:
            try:
                gc.on(key, _on_notify)
            except Exception:
                pass

        def _detach():
            for key in unique_event_keys:
                try:
                    gc.remove_listener(key, _on_notify)
                except Exception:
                    pass

        return _detach

    def _wait_component_notifications(self, *, waiting_ids: set[int], notified_ids: set[int], max_wait_seconds: float):
        if not waiting_ids:
            return
        deadline = time.time() + max(0.5, max_wait_seconds)
        while time.time() < deadline:
            if len(notified_ids) >= len(waiting_ids):
                break
            time.sleep(0.1)
        logger.info(
            "component contents notifications: got=%d expected=%d",
            len(notified_ids),
            len(waiting_ids),
        )

    @staticmethod
    def _extract_casket_contents_ids(message) -> list[int]:
        msg = message
        if isinstance(message, (bytes, bytearray)):
            if CMsgGCItemCustomizationNotification is None:
                return []
            try:
                parsed = CMsgGCItemCustomizationNotification()
                parsed.ParseFromString(bytes(message))
                msg = parsed
            except Exception:
                return []

        try:
            req = int(getattr(msg, "request", 0) or 0)
        except Exception:
            return []
        if req != _CASKET_CONTENTS_NOTIFICATION:
            return []

        out: list[int] = []
        for x in getattr(msg, "item_id", []) or []:
            try:
                xid = int(x)
            except Exception:
                continue
            if xid > 0:
                out.append(xid)
        return out

    @staticmethod
    def _send_component_load_request(cs2_client, component_id: int, *, cursor_item_id: int = 0):
        enum_send_error: Exception | None = None
        cursor = int(cursor_item_id) if int(cursor_item_id) > 0 else int(component_id)

        emsg_enum = None
        if EGCItemMsg is not None:
            emsg_enum = getattr(EGCItemMsg, "EMsgGCCasketItemLoadContents", None)
        if emsg_enum is None:
            emsg_enum = getattr(ECsgoGCMsg, "EMsgGCCasketItemLoadContents", None)
        if emsg_enum is not None:
            try:
                if CMsgCasketItem is not None:
                    cs2_client.cs2.send(
                        emsg_enum,
                        {
                            "casket_item_id": int(component_id),
                            "item_item_id": cursor,
                        },
                        proto=CMsgCasketItem,
                    )
                else:
                    cs2_client.cs2.send(
                        emsg_enum,
                        {
                            "casket_item_id": int(component_id),
                            "item_item_id": cursor,
                        },
                    )
                return
            except Exception as exc:
                enum_send_error = exc

        if CMsgCasketItem is not None and hasattr(cs2_client.cs2, "send_raw_gc"):
            msg = CMsgCasketItem()
            msg.casket_item_id = int(component_id)
            msg.item_item_id = cursor
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
        try:
            direct_id = int(getattr(raw_item, "casket_id", 0) or 0)
            if direct_id > 0:
                return str(direct_id)
        except Exception:
            pass

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
        attr_list = getattr(raw_item, "attribute", None)
        if attr_list is None:
            attr_list = getattr(raw_item, "attributes", None)
        for attr in attr_list or []:
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
                # 兼容脏属性数据：跳过当前属性，继续尝试后续属性。
                continue
        return 0
