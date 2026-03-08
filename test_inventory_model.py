import tempfile
import unittest
from pathlib import Path

from inventory import Item, save_processed_inventory_snapshot


class TestInventoryModel(unittest.TestCase):
    def test_item_constructor_accepts_core_fields(self):
        item = Item(
            asset_id=1,
            def_index=7,
            quality=4,
            rarity=3,
            paint_index=44,
            paint_seed=123,
            float_value=0.12345,
        )
        self.assertEqual(item.def_index, 7)
        self.assertEqual(item.paint_index, 44)
        self.assertAlmostEqual(item.float_value, 0.12345)

    def test_save_snapshot_contains_core_fields(self):
        item = Item(
            asset_id=2,
            def_index=9,
            quality=4,
            rarity=3,
            paint_index=100,
            paint_seed=321,
            float_value=0.22,
        )
        with tempfile.TemporaryDirectory() as td:
            out_dir = Path(td)
            path, rows = save_processed_inventory_snapshot([item], excluded_records=[], out_dir=out_dir)
            self.assertTrue(path.exists())
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["def_index"], 9)
            self.assertEqual(rows[0]["paint_index"], 100)


if __name__ == "__main__":
    unittest.main()

