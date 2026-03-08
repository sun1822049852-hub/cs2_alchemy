import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.DEBUG, format='%(name)s %(levelname)s %(message)s')

from auth import disconnect_all, login, login_with_totp
from client import CS2Client
from craft import CraftExecutor
from schema import load_schema
from inventory_manager import InventoryManager
from account_manager import AccountManager, _safe_input
from steam.enums.emsg import EMsg
from steam.protobufs import steammessages_clientserver_pb2 as pb_cs

_RECIPE_MAP_FILE = Path("craft_recipes.json")


def _load_recipe_map() -> dict[str, int]:
    if not _RECIPE_MAP_FILE.exists():
        return {}
    try:
        data = json.loads(_RECIPE_MAP_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {str(k): int(v) for k, v in data.items()}
    except Exception:
        pass
    return {}


def _save_recipe_map(recipe_map: dict[str, int]):
    _RECIPE_MAP_FILE.write_text(
        json.dumps(recipe_map, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _resolve_recipe_id(quality: int, rarity: int, quality_name: str, rarity_name: str) -> int | None:
    recipe_map = _load_recipe_map()
    key = f"{quality}:{rarity}"
    if key in recipe_map:
        return recipe_map[key]

    print(f"\n未找到 {quality_name} + {rarity_name} 的 recipe_id 映射。")
    value = _safe_input("请输入该组合的 recipe_id（0 取消）: ").strip()
    try:
        recipe_id = int(value)
    except ValueError:
        print("输入不是有效整数，已取消")
        return None

    if recipe_id <= 0:
        print("已取消")
        return None

    remember = _safe_input("是否保存该映射供后续复用？(y/n): ").strip().lower()
    if remember == "y":
        recipe_map[key] = recipe_id
        _save_recipe_map(recipe_map)
        print("映射已保存")

    return recipe_id


def _get_craftable_groups(inv_manager):
    groups = inv_manager.group_by_quality_rarity()
    craftable = [
        (quality, rarity, items)
        for (quality, rarity), items in groups.items()
        if len(items) >= 10
    ]
    craftable.sort(key=lambda x: len(x[2]), reverse=True)
    return craftable


def _select_material_ids(inv_manager, quality: int, rarity: int) -> list[int] | None:
    candidates = inv_manager.filter_items(quality=quality, rarity=rarity)
    if len(candidates) < 10:
        return None

    print("  1. 自动选择最差磨损 10 件")
    print("  2. 手动输入 10 个 asset_id")
    mode = _safe_input("请选择材料选择方式: ").strip()

    if mode == "1":
        selected = inv_manager.get_worst_float_items(quality, rarity, count=10)
        return [item.asset_id for item in selected]

    if mode == "2":
        raw = _safe_input("输入 10 个 asset_id（空格或逗号分隔）: ").strip()
        parts = [p for p in raw.replace(",", " ").split() if p]
        try:
            ids = [int(p) for p in parts]
        except ValueError:
            print("asset_id 必须是整数")
            return None

        if len(ids) != 10:
            print("必须输入恰好 10 个 asset_id")
            return None
        if len(set(ids)) != 10:
            print("asset_id 存在重复")
            return None

        candidate_ids = {item.asset_id for item in candidates}
        invalid_ids = [asset_id for asset_id in ids if asset_id not in candidate_ids]
        if invalid_ids:
            print(f"以下 asset_id 不在该品质+稀有度组合中: {invalid_ids}")
            return None
        return ids

    print("无效选择")
    return None


def _execute_tradeup(inv_manager: InventoryManager, craft_executor: CraftExecutor):
    craftable = _get_craftable_groups(inv_manager)
    if not craftable:
        print("\n暂无可炼金组合（需要同品质+同稀有度>=10件）")
        return

    print(f"\n{'='*70}")
    print("可炼金组合")
    print(f"{'='*70}")
    for idx, (quality, rarity, items) in enumerate(craftable, start=1):
        quality_name = items[0].quality_name
        rarity_name = items[0].rarity_name
        print(f"  {idx}. {quality_name} + {rarity_name}: {len(items)} 件")
    print("  0. 取消")

    raw_idx = _safe_input("请选择组合: ").strip()
    try:
        group_idx = int(raw_idx)
    except ValueError:
        print("无效输入")
        return
    if group_idx == 0:
        return
    if group_idx < 1 or group_idx > len(craftable):
        print("无效选择")
        return

    quality, rarity, group_items = craftable[group_idx - 1]
    quality_name = group_items[0].quality_name
    rarity_name = group_items[0].rarity_name

    material_ids = _select_material_ids(inv_manager, quality, rarity)
    if not material_ids:
        return

    recipe_id = _resolve_recipe_id(quality, rarity, quality_name, rarity_name)
    if not recipe_id:
        return

    print("\n即将执行炼金：")
    print(f"  组合: {quality_name} + {rarity_name}")
    print(f"  recipe_id: {recipe_id}")
    print(f"  材料 asset_id: {material_ids}")
    confirm = _safe_input("输入 yes 确认执行（不可逆）: ").strip().lower()
    if confirm != "yes":
        print("已取消")
        return

    print("正在发送炼金请求...")
    result = craft_executor.execute(recipe_id=recipe_id, asset_ids=material_ids, timeout=20)
    if not result:
        print("炼金请求超时，未收到 GC 响应")
        return

    print(f"炼金完成：recipe={result.get('recipe')} new_items={result.get('new_items', [])}")
    print("正在刷新库存...")
    inv_manager.reload()
    print(f"刷新完成，当前库存 {len(inv_manager.items)} 件")



def _log_account_status(steam_client):
    """监听并打印账号限制状态和 CS2 许可"""

    def on_limited(msg):
        body = pb_cs.CMsgClientIsLimitedAccount()
        body.ParseFromString(msg.body.SerializeToString())
        logging.getLogger("account").warning(
            "账号状态: limited=%s community_banned=%s locked=%s",
            body.bis_limited_account,
            body.bis_community_banned,
            body.bis_locked_account,
        )

    def on_license(msg):
        licenses = msg.body.licenses
        appids = [lic.package_id for lic in licenses]
        has_cs2 = any(pid in (730, 2275500) for pid in appids)
        logging.getLogger("account").warning(
            "许可数量=%d  含CS2相关包=%s  包ID列表(前20)=%s",
            len(licenses), has_cs2, appids[:20]
        )

    steam_client.on(EMsg.ClientIsLimitedAccount, on_limited)
    steam_client.on(EMsg.ClientLicenseList, on_license)


def show_inventory_menu(inv_manager: InventoryManager, craft_executor: CraftExecutor):
    """库存管理菜单"""
    while True:
        print("\n" + "=" * 50)
        print("  库存管理")
        print("=" * 50)
        print("  1. 查看所有库存")
        print("  2. 查看库存统计")
        print("  3. 搜索物品")
        print("  4. 按品质筛选")
        print("  5. 按稀有度筛选")
        print("  6. 查看可炼金组合")
        print("  7. 刷新库存")
        print("  8. 执行炼金汰换")
        print("  9. 同名归类查看")
        print("  10. 查看被过滤条目（调试）")
        print("  0. 返回")
        print("=" * 50)

        choice = _safe_input("请选择: ").strip()

        if choice == '1':
            # 查看所有库存
            limit = _safe_input("显示数量（0=全部）: ").strip()
            try:
                limit = int(limit) if limit else 0
            except ValueError:
                limit = 0
            inv_manager.display_inventory(limit=limit, show_details=True)

        elif choice == '2':
            # 查看统计
            inv_manager.display_statistics()

        elif choice == '3':
            # 搜索物品
            keyword = _safe_input("输入搜索关键词（武器名或皮肤名）: ").strip()
            if keyword:
                results = inv_manager.search_items(keyword)
                print(f"\n找到 {len(results)} 件物品")
                inv_manager.display_inventory(items=results, show_details=True)

        elif choice == '4':
            # 按品质筛选
            print("\n品质列表:")
            print("  4 - Normal")
            print("  9 - StatTrak™")
            print("  11 - Souvenir")
            quality = _safe_input("输入品质 ID: ").strip()
            try:
                quality = int(quality)
                results = inv_manager.filter_items(quality=quality)
                print(f"\n找到 {len(results)} 件物品")
                inv_manager.display_inventory(items=results, show_details=False)
            except ValueError:
                print("无效的品质 ID")

        elif choice == '5':
            # 按稀有度筛选
            print("\n稀有度列表:")
            print("  1 - Consumer")
            print("  2 - Industrial")
            print("  3 - Mil-Spec")
            print("  4 - Restricted")
            print("  5 - Classified")
            print("  6 - Covert")
            print("  7 - Contraband")
            rarity = _safe_input("输入稀有度 ID: ").strip()
            try:
                rarity = int(rarity)
                results = inv_manager.filter_items(rarity=rarity)
                print(f"\n找到 {len(results)} 件物品")
                inv_manager.display_inventory(items=results, show_details=False)
            except ValueError:
                print("无效的稀有度 ID")

        elif choice == '6':
            # 查看可炼金组合
            craftable_groups = _get_craftable_groups(inv_manager)

            if not craftable_groups:
                print("\n暂无可炼金组合（需要同品质+同稀有度>=10件）")
            else:
                print(f"\n{'='*70}")
                print("可炼金组合")
                print(f"{'='*70}\n")
                for quality, rarity, items in craftable_groups:
                    quality_name = items[0].quality_name
                    rarity_name = items[0].rarity_name
                    count = len(items)
                    print(f"{quality_name} + {rarity_name}: {count} 件 → 可炼金 {count//10} 次")
                print(f"\n{'='*70}\n")

        elif choice == '7':
            # 刷新库存
            print("正在刷新库存...")
            inv_manager.reload()
            print(f"刷新完成，当前库存 {len(inv_manager.items)} 件")

        elif choice == '8':
            _execute_tradeup(inv_manager, craft_executor)

        elif choice == '9':
            raw_limit = _safe_input("显示前 N 组（0=全部）: ").strip()
            try:
                limit = int(raw_limit) if raw_limit else 0
            except ValueError:
                limit = 0
            inv_manager.display_grouped_by_name(limit=limit)

        elif choice == '10':
            raw_limit = _safe_input("显示前 N 条（0=全部）: ").strip()
            try:
                limit = int(raw_limit) if raw_limit else 0
            except ValueError:
                limit = 0
            inv_manager.display_filtered_out_items(limit=limit)

        elif choice == '0':
            return

        else:
            print("无效选择")


def run_alchemy(username: str, password: str):
    """
    炼金程序入口：用 login_key 免密登录 → 连接 GC → 库存管理
    """
    print(f"\n正在以账号 {username} 登录 Steam...")

    try:
        steam_client = login(username, password)
    except ValueError as e:
        print(f"登录失败：{e}")
        retry = _safe_input("是否现在输入令牌码重新初始化并继续？(y/n): ").strip().lower()
        if retry != "y":
            return
        totp_code = _safe_input("请输入手机令牌验证码（5位）: ").strip()
        try:
            steam_client = login_with_totp(username, password, totp_code)
        except ValueError as e2:
            print(f"重新初始化失败：{e2}")
            return
        except ConnectionError as e2:
            print(f"网络错误：{e2}")
            return
    except ConnectionError as e:
        print(f"网络错误：{e}")
        return

    schema = load_schema()
    client = CS2Client(steam_client)
    _log_account_status(steam_client)  # 打印账号限制状态和许可

    # 等待账号信息加载完成
    import time
    print("等待账号信息加载...")
    time.sleep(3)

    try:
        print("正在连接 CS2 GC...")
        client.launch()
        print("GC 连接成功，正在加载库存...")

        # 创建库存管理器
        inv_manager = InventoryManager(client, schema)
        craft_executor = CraftExecutor(client)
        print(f"库存加载完成，共 {len(inv_manager.items)} 件物品\n")

        # 显示库存管理菜单
        show_inventory_menu(inv_manager, craft_executor)

    except TimeoutError as e:
        print(f"GC 连接超时：{e}")
        print("可能原因：")
        print("  1. 账号没有 CS2 游戏")
        print("  2. 网络不稳定")
        print("  3. Steam 服务器繁忙")
    except Exception as e:
        print(f"发生错误：{e}")
        import traceback
        traceback.print_exc()
    finally:
        print("正在退出 GC 会话...")
        client.disconnect(logout=False)
        print("已退出 GC，会话已保留，可复用")


def main():
    manager = AccountManager()

    try:
        while True:
            active = manager.get_active_name()
            print("\n" + "=" * 36)
            print(f"  当前账号：{active or '未选择'}")
            print("=" * 36)
            print("  1. 账号管理（新增 / 切换 / 删除）")
            print("  2. 库存管理（查看 / 筛选 / 统计）")
            print("  0. 退出")
            print("=" * 36)

            choice = _safe_input("请选择: ").strip()

            if choice == '1':
                manager.show_management_menu()

            elif choice == '2':
                creds = manager.get_active_credentials()
                if not creds:
                    print("请先在账号管理中添加账号")
                else:
                    run_alchemy(*creds)

            elif choice == '0':
                print("退出程序")
                break

            else:
                print("无效选择")
    finally:
        disconnect_all()


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        print("\n已退出")
    except Exception as e:
        print(f"\n程序异常退出：{type(e).__name__}: {e}")
