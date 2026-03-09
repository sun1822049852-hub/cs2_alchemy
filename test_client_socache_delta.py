import logging
import unittest
from types import SimpleNamespace

from client import _PatchedCSGOClient


class _DummySOCache:
    def __init__(self):
        self.created = []
        self.removed = []

    def _handle_create(self, obj):
        self.created.append(obj)

    def _handle_destroy(self, obj):
        self.removed.append(obj)


class TestClientSocacheDelta(unittest.TestCase):
    def test_update_multiple_applies_added_removed_delta(self):
        dummy = SimpleNamespace(
            socache=_DummySOCache(),
            verbose_debug=False,
            _LOG=logging.getLogger("test.client.delta"),
        )
        msg = SimpleNamespace(objects_added=[1, 2], objects_removed=[3])
        _PatchedCSGOClient._handle_so_update_multiple_delta(dummy, msg)
        self.assertEqual(dummy.socache.created, [1, 2])
        self.assertEqual(dummy.socache.removed, [3])

    def test_update_multiple_without_delta_is_noop(self):
        dummy = SimpleNamespace(
            socache=_DummySOCache(),
            verbose_debug=False,
            _LOG=logging.getLogger("test.client.delta"),
        )
        msg = SimpleNamespace(objects_added=[], objects_removed=[])
        _PatchedCSGOClient._handle_so_update_multiple_delta(dummy, msg)
        self.assertEqual(dummy.socache.created, [])
        self.assertEqual(dummy.socache.removed, [])

    def test_emit_item_customization_notification_bridge(self):
        events = []

        def _emit(name, *args):
            events.append((name, args))

        dummy = SimpleNamespace(
            emit=_emit,
            _LOG=logging.getLogger("test.client.delta"),
        )
        msg = SimpleNamespace(request=1012, item_id=[46224697557, 0, 48212405707])
        _PatchedCSGOClient._emit_item_customization_notification(dummy, 1090, msg)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0][0], "itemCustomizationNotification")
        self.assertEqual(events[0][1][0], [46224697557, 48212405707])
        self.assertEqual(events[0][1][1], 1012)


if __name__ == "__main__":
    unittest.main()
