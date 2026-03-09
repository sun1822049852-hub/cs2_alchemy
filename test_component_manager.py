import unittest
from types import SimpleNamespace

from component_manager import ComponentManager
from csgo.protobufs.econ_gcmessages_pb2 import (
    CMsgCasketItem,
    CMsgGCItemCustomizationNotification,
    k_EGCItemCustomizationNotification_CasketContents,
)
from inventory import _get_casket_id


class TestComponentManager(unittest.TestCase):
    def test_decode_casket_id_supports_attributes_field(self):
        raw = SimpleNamespace(
            attributes=[
                SimpleNamespace(def_index=272, value_bytes=(123456789).to_bytes(4, byteorder="little", signed=False)),
                SimpleNamespace(def_index=273, value=0),
            ],
            flags=24,
            id=1,
            original_id=0,
        )
        self.assertEqual(ComponentManager.decode_casket_id(raw), "123456789")

    def test_decode_casket_id_skips_malformed_attr_and_continues(self):
        raw = SimpleNamespace(
            attribute=[
                SimpleNamespace(def_index=272, value_bytes=object()),
                SimpleNamespace(def_index=272, value=42),
            ],
            flags=24,
            id=1,
            original_id=0,
        )
        self.assertEqual(ComponentManager.decode_casket_id(raw), "42")

    def test_send_component_load_request_default_cursor_uses_component_id(self):
        class _DummyCS2:
            def __init__(self):
                self.emsg = None
                self.payload = None

            def send_raw_gc(self, emsg, payload):
                self.emsg = emsg
                self.payload = payload

        class _DummyClient:
            def __init__(self):
                self.cs2 = _DummyCS2()

        cli = _DummyClient()
        ComponentManager._send_component_load_request(cli, 123456789, cursor_item_id=0)
        self.assertIsNotNone(cli.cs2.payload)
        msg = CMsgCasketItem()
        msg.ParseFromString(cli.cs2.payload)
        self.assertEqual(int(msg.casket_item_id), 123456789)
        self.assertEqual(int(msg.item_item_id), 123456789)

    def test_get_casket_id_keeps_value_even_when_equals_item_id(self):
        casket_id = 46224697557
        low = casket_id & 0xFFFFFFFF
        high = casket_id >> 32
        raw = SimpleNamespace(
            id=casket_id,
            attribute=[
                SimpleNamespace(def_index=272, value_bytes=low.to_bytes(4, byteorder="little", signed=False)),
                SimpleNamespace(def_index=273, value_bytes=high.to_bytes(4, byteorder="little", signed=False)),
            ],
        )
        self.assertEqual(_get_casket_id(raw), str(casket_id))

    def test_extract_casket_contents_ids_from_message(self):
        msg = CMsgGCItemCustomizationNotification()
        msg.request = int(k_EGCItemCustomizationNotification_CasketContents)
        msg.item_id.extend([46224697557, 48107444575])
        ids = ComponentManager._extract_casket_contents_ids(msg)
        self.assertEqual(ids, [46224697557, 48107444575])

    def test_extract_casket_contents_ids_from_bytes(self):
        msg = CMsgGCItemCustomizationNotification()
        msg.request = int(k_EGCItemCustomizationNotification_CasketContents)
        msg.item_id.extend([48212405707])
        payload = msg.SerializeToString()
        ids = ComponentManager._extract_casket_contents_ids(payload)
        self.assertEqual(ids, [48212405707])


if __name__ == "__main__":
    unittest.main()
