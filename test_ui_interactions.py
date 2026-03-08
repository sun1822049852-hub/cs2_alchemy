import tkinter as tk
import unittest
from unittest import mock

import main_ui


class TestUIInteractions(unittest.TestCase):
    def setUp(self):
        self._patch_load_schema = mock.patch("main_ui.load_schema", return_value={})
        self._patch_disconnect_account = mock.patch("main_ui.disconnect_account", return_value=None)
        self._patch_disconnect_all = mock.patch("main_ui.disconnect_all", return_value=None)
        self._patch_load_schema.start()
        self._mock_disconnect_account = self._patch_disconnect_account.start()
        self._mock_disconnect_all = self._patch_disconnect_all.start()

        self.root = tk.Tk()
        self.root.withdraw()
        self.page = main_ui.InventoryOverviewPage(self.root)
        self.root.update_idletasks()

    def tearDown(self):
        try:
            self.page.shutdown()
        except Exception:
            pass
        try:
            self.root.destroy()
        except Exception:
            pass
        self._patch_disconnect_all.stop()
        self._patch_disconnect_account.stop()
        self._patch_load_schema.stop()

    def _entry(self, **kwargs):
        defaults = dict(
            asset_id=1,
            def_index=1,
            paint_index=1,
            paint_seed=1,
            float_value=0.15,
            quality=4,
            rarity=3,
            origin=0,
            flags=0,
            inventory=0,
            tradable_after=0,
            name="AK-47 | Redline (Field-Tested)",
            hidden_reason=None,
            market_hash_name="AK-47 | Redline (Field-Tested)",
            alchemy_name="AK-47 | 赤线 (久经沙场)",
            collection="猎杀者收藏品",
            alchemy_rarity="Mil-Spec",
            minfloat=0.10,
            maxfloat=0.70,
            isstattrak=0,
            wear_range=0.60,
            is_craftable=True,
            craftable_reason="ok",
        )
        defaults.update(kwargs)
        return main_ui.InventoryEntry(**defaults)

    def test_english_search_still_works_with_cn_display_name(self):
        item = self._entry(
            name="UMP-45 | Late Night Transit (Field-Tested)",
            market_hash_name="UMP-45 | Late Night Transit (Field-Tested)",
            alchemy_name="UMP-45 | 深夜通勤 (久经沙场)",
        )
        self.page.entries = [item]
        self.page.search_var.set("late night transit")
        self.page._apply_filter()
        self.assertEqual(len(self.page.filtered_entries), 1)

    def test_multi_select_filters_apply_on_wear_items(self):
        a = self._entry(asset_id=1, rarity=3, collection="猎杀者收藏品")
        b = self._entry(asset_id=2, rarity=4, collection="2025 列车停放站收藏品", name="FAMAS | 2A2F (Field-Tested)")
        c = self._entry(
            asset_id=3,
            rarity=4,
            collection="2025 列车停放站收藏品",
            minfloat=None,
            maxfloat=None,
            float_value=0.0,
            name="Global Offensive Badge",
            market_hash_name="Global Offensive Badge",
            alchemy_name="",
        )
        self.page.entries = [a, b, c]
        self.page._refresh_collection_filter_options()
        self.page.selected_rarity_filters = {"Restricted"}
        self.page.selected_collection_filters = {"2025 列车停放站收藏品"}
        self.page.search_var.set("")
        self.page._apply_filter()

        # b 符合磨损物品筛选；c 无磨损不受筛选影响并置底保留
        ids = [x.asset_id for x in self.page.filtered_entries]
        self.assertEqual(ids, [2, 3])

    def test_auto_refresh_skips_when_not_connected(self):
        self.page._refresh_account_selector = lambda prefer_username=None: None
        self.page._show_cached_inventory = lambda username: None
        self.page._update_connection_ui = lambda: None
        self.page._save_ui_state = lambda: None

        with mock.patch.object(main_ui.AccountStore, "get", return_value={"password": "pwd"}):
            with mock.patch.object(self.page, "_need_auto_refresh", return_value=True):
                with mock.patch.object(self.page, "_is_username_connected", return_value=False):
                    with mock.patch.object(self.page, "_start_refresh") as m_start:
                        self.page._switch_account_view("demo_user", auto_refresh_if_stale=True, force_refresh=False)
                        m_start.assert_not_called()
                        self.assertIn("未自动刷新", self.page.summary_var.get())

    def test_single_item_group_can_expand(self):
        row = self._entry(asset_id=10)
        self.assertTrue(self.page._group_needs_expand([row]))

    def test_main_window_close_disconnects(self):
        app = main_ui.MainUI()
        app.withdraw()
        try:
            inventory_page = app.pages.get("inventory")
            self.assertIsNotNone(inventory_page)
            inventory_page.current_username = "demo_user"
            with mock.patch.object(inventory_page, "shutdown", wraps=inventory_page.shutdown) as m_shutdown:
                app._on_close()
                self.assertTrue(m_shutdown.called)
            self._mock_disconnect_account.assert_any_call("demo_user")
            self.assertGreaterEqual(self._mock_disconnect_all.call_count, 1)
        finally:
            try:
                app.destroy()
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main()
