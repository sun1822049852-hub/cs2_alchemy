"""
库存管理模块

提供库存查看、筛选、排序、统计等功能
为炼金系统提供物品数据支持
"""
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Callable, Optional, Any
from inventory import Item, get_inventory


class InventoryFilter:
    """库存筛选器"""

    @staticmethod
    def by_quality(items: List[Item], quality: int) -> List[Item]:
        """按品质筛选"""
        return [item for item in items if item.quality == quality]

    @staticmethod
    def by_rarity(items: List[Item], rarity: int) -> List[Item]:
        """按稀有度筛选"""
        return [item for item in items if item.rarity == rarity]

    @staticmethod
    def by_weapon(items: List[Item], weapon_name: str) -> List[Item]:
        """按武器名筛选"""
        return [item for item in items if weapon_name.lower() in item.weapon_name.lower()]

    @staticmethod
    def by_skin(items: List[Item], skin_name: str) -> List[Item]:
        """按皮肤名筛选"""
        return [item for item in items if skin_name.lower() in item.skin_name.lower()]

    @staticmethod
    def by_float_range(items: List[Item], min_float: float, max_float: float) -> List[Item]:
        """按磨损值范围筛选"""
        return [item for item in items if min_float <= item.float_value <= max_float]

    @staticmethod
    def by_quality_and_rarity(items: List[Item], quality: int, rarity: int) -> List[Item]:
        """按品质和稀有度组合筛选（炼金常用）"""
        return [item for item in items
                if item.quality == quality and item.rarity == rarity]

    @staticmethod
    def by_craftable(items: List[Item], craftable: bool) -> List[Item]:
        """按是否可炼金筛选"""
        target = bool(craftable)
        return [item for item in items if bool(getattr(item, "is_craftable", False)) == target]


class InventorySorter:
    """库存排序器"""

    @staticmethod
    def by_float(items: List[Item], reverse: bool = False) -> List[Item]:
        """按磨损值排序"""
        return sorted(items, key=lambda x: x.float_value, reverse=reverse)

    @staticmethod
    def by_rarity(items: List[Item], reverse: bool = True) -> List[Item]:
        """按稀有度排序（默认从高到低）"""
        return sorted(items, key=lambda x: x.rarity, reverse=reverse)

    @staticmethod
    def by_asset_id(items: List[Item], reverse: bool = False) -> List[Item]:
        """按 asset_id 排序"""
        return sorted(items, key=lambda x: x.asset_id, reverse=reverse)

    @staticmethod
    def by_weapon_name(items: List[Item], reverse: bool = False) -> List[Item]:
        """按武器名排序"""
        return sorted(items, key=lambda x: x.weapon_name, reverse=reverse)


@dataclass
class InventoryStats:
    """库存统计信息"""
    total_count: int                    # 总数量
    quality_distribution: Dict[str, int]  # 品质分布
    rarity_distribution: Dict[str, int]   # 稀有度分布
    weapon_distribution: Dict[str, int]   # 武器分布
    avg_float: float                    # 平均磨损值
    craftable_groups: Dict[str, int]    # 可炼金组合数量


class InventoryManager:
    """库存管理器"""

    def __init__(self, cs2_client, schema: dict):
        self.cs2_client = cs2_client
        self.schema = schema
        self.items: List[Item] = []
        self.filtered_out_items: List[Dict[str, Any]] = []
        self.debug_save_raw_inventory = True
        self.raw_inventory_dump_dir = Path("logs/raw_inventory")
        try:
            from config import DEBUG_SAVE_RAW_INVENTORY, RAW_INVENTORY_DUMP_DIR  # type: ignore

            self.debug_save_raw_inventory = bool(DEBUG_SAVE_RAW_INVENTORY)
            self.raw_inventory_dump_dir = Path(str(RAW_INVENTORY_DUMP_DIR))
        except Exception:
            pass
        self._load_inventory()

    def _build_raw_dump_path(self) -> Path:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return self.raw_inventory_dump_dir / f"inventory_raw_{timestamp}.json"

    def _load_inventory(self):
        """加载库存数据"""
        dump_path = self._build_raw_dump_path() if self.debug_save_raw_inventory else None
        excluded_records: List[Dict[str, Any]] = []
        self.items = get_inventory(
            self.cs2_client,
            self.schema,
            dump_raw_path=dump_path,
            excluded_records=excluded_records,
        )
        self.filtered_out_items = excluded_records
        if dump_path is not None:
            print(f"原始库存快照已保存: {dump_path}")

    def reload(self):
        """重新加载库存"""
        self._load_inventory()

    def get_all_items(self) -> List[Item]:
        """获取所有物品"""
        return self.items.copy()

    def get_item_by_asset_id(self, asset_id: int) -> Optional[Item]:
        """根据 asset_id 获取物品"""
        for item in self.items:
            if item.asset_id == asset_id:
                return item
        return None

    def filter_items(self, **kwargs) -> List[Item]:
        """
        灵活筛选物品

        支持的参数：
        - quality: int - 品质
        - rarity: int - 稀有度
        - weapon: str - 武器名（模糊匹配）
        - skin: str - 皮肤名（模糊匹配）
        - min_float: float - 最小磨损值
        - max_float: float - 最大磨损值
        - craftable: bool - 是否可炼金
        """
        result = self.items.copy()

        if 'quality' in kwargs:
            result = InventoryFilter.by_quality(result, kwargs['quality'])

        if 'rarity' in kwargs:
            result = InventoryFilter.by_rarity(result, kwargs['rarity'])

        if 'weapon' in kwargs:
            result = InventoryFilter.by_weapon(result, kwargs['weapon'])

        if 'skin' in kwargs:
            result = InventoryFilter.by_skin(result, kwargs['skin'])

        if 'min_float' in kwargs and 'max_float' in kwargs:
            result = InventoryFilter.by_float_range(
                result, kwargs['min_float'], kwargs['max_float'])

        if 'craftable' in kwargs:
            result = InventoryFilter.by_craftable(result, kwargs['craftable'])

        return result

    def get_craftable_items(self, quality: int, rarity: int,
                           min_count: int = 10) -> List[Item]:
        """
        获取可用于炼金的物品

        Args:
            quality: 品质
            rarity: 稀有度
            min_count: 最少需要的数量（默认10件）

        Returns:
            符合条件的物品列表，如果数量不足返回空列表
        """
        items = InventoryFilter.by_craftable(self.items, True)
        items = InventoryFilter.by_quality_and_rarity(items, quality, rarity)
        if len(items) >= min_count:
            return items
        return []

    def get_tradeup_eligible_items(self) -> List[Item]:
        """获取可炼金物品"""
        return InventoryFilter.by_craftable(self.items, True)

    def get_non_craftable_items(self) -> List[Item]:
        """获取不可炼金物品"""
        return InventoryFilter.by_craftable(self.items, False)

    def get_statistics(self) -> InventoryStats:
        """获取库存统计信息"""
        if not self.items:
            return InventoryStats(
                total_count=0,
                quality_distribution={},
                rarity_distribution={},
                weapon_distribution={},
                avg_float=0.0,
                craftable_groups={}
            )

        # 品质分布
        quality_dist = {}
        for item in self.items:
            quality_name = item.quality_name
            quality_dist[quality_name] = quality_dist.get(quality_name, 0) + 1

        # 稀有度分布
        rarity_dist = {}
        for item in self.items:
            rarity_name = item.rarity_name
            rarity_dist[rarity_name] = rarity_dist.get(rarity_name, 0) + 1

        # 武器分布
        weapon_dist = {}
        for item in self.items:
            weapon_name = item.weapon_name
            weapon_dist[weapon_name] = weapon_dist.get(weapon_name, 0) + 1

        # 平均磨损值
        avg_float = sum(item.float_value for item in self.items) / len(self.items)

        # 可炼金组合（品质+稀有度组合，数量>=10）
        craftable_groups = {}
        for item in self.items:
            if not bool(getattr(item, "is_craftable", False)):
                continue
            key = f"{item.quality_name}+{item.rarity_name}"
            craftable_groups[key] = craftable_groups.get(key, 0) + 1
        # 只保留数量>=10的组合
        craftable_groups = {k: v for k, v in craftable_groups.items() if v >= 10}

        return InventoryStats(
            total_count=len(self.items),
            quality_distribution=quality_dist,
            rarity_distribution=rarity_dist,
            weapon_distribution=weapon_dist,
            avg_float=avg_float,
            craftable_groups=craftable_groups
        )

    def display_inventory(self, items: Optional[List[Item]] = None,
                         limit: int = 0, show_details: bool = True):
        """
        显示库存

        Args:
            items: 要显示的物品列表，None 则显示全部
            limit: 显示数量限制，0 表示不限制
            show_details: 是否显示详细信息
        """
        if items is None:
            items = self.items

        if not items:
            print("库存为空")
            return

        display_items = items[:limit] if limit > 0 else items

        print(f"\n{'='*70}")
        print(f"库存物品列表（共 {len(items)} 件{f'，显示前 {limit} 件' if limit > 0 else ''}）")
        print(f"{'='*70}\n")

        for i, item in enumerate(display_items, 1):
            if show_details:
                print(f"[{i}] {item.full_name}")
                print(f"    Asset ID: {item.asset_id}")
                print(f"    DefIndex/Paint: {item.def_index}/{item.paint_index}")
                print(f"    品质: {item.quality_name}  稀有度: {item.rarity_name}")
                print(f"    磨损: {item.float_value:.10f}  种子: {item.paint_seed}")
                print(f"    状态: {item.status_text}")
                print()
            else:
                print(f"[{i}] {item.full_name} | {item.quality_name} | "
                      f"{item.rarity_name} | Float: {item.float_value:.6f}")

    def display_statistics(self):
        """显示库存统计信息"""
        stats = self.get_statistics()

        print(f"\n{'='*70}")
        print("库存统计信息")
        print(f"{'='*70}\n")

        print(f"总数量: {stats.total_count} 件")
        print(f"平均磨损值: {stats.avg_float:.6f}\n")

        print("品质分布:")
        for quality, count in sorted(stats.quality_distribution.items()):
            print(f"  {quality:15s}: {count:4d} 件")

        print("\n稀有度分布:")
        for rarity, count in sorted(stats.rarity_distribution.items()):
            print(f"  {rarity:15s}: {count:4d} 件")

        print("\n武器分布（前10）:")
        sorted_weapons = sorted(stats.weapon_distribution.items(),
                               key=lambda x: x[1], reverse=True)[:10]
        for weapon, count in sorted_weapons:
            print(f"  {weapon:20s}: {count:4d} 件")

        if stats.craftable_groups:
            print("\n可炼金组合（数量>=10）:")
            for group, count in sorted(stats.craftable_groups.items(),
                                      key=lambda x: x[1], reverse=True):
                print(f"  {group:30s}: {count:4d} 件 → 可炼金 {count//10} 次")
        else:
            print("\n暂无可炼金组合（需要同品质+同稀有度>=10件）")

        print(f"\n{'='*70}\n")

    def search_items(self, keyword: str) -> List[Item]:
        """
        搜索物品（武器名或皮肤名）

        Args:
            keyword: 搜索关键词

        Returns:
            匹配的物品列表
        """
        keyword_lower = keyword.lower()
        return [item for item in self.items
                if keyword_lower in item.weapon_name.lower()
                or keyword_lower in item.skin_name.lower()]

    def group_by_quality_rarity(self) -> Dict[tuple, List[Item]]:
        """
        按品质和稀有度分组（用于炼金）

        Returns:
            {(quality, rarity): [items]} 字典
        """
        groups = {}
        for item in self.items:
            key = (item.quality, item.rarity)
            if key not in groups:
                groups[key] = []
            groups[key].append(item)
        return groups

    def group_by_full_name(self) -> Dict[str, List[Item]]:
        """按完整名称分组（同名归类）"""
        groups: Dict[str, List[Item]] = {}
        for item in self.items:
            key = item.full_name
            groups.setdefault(key, []).append(item)
        return groups

    def display_grouped_by_name(self, limit: int = 0):
        """显示同名归类结果"""
        groups = self.group_by_full_name()
        if not groups:
            print("库存为空")
            return

        rows = sorted(groups.items(), key=lambda kv: len(kv[1]), reverse=True)
        if limit > 0:
            rows = rows[:limit]

        print(f"\n{'='*90}")
        print(f"同名归类结果（共 {len(groups)} 组）")
        print(f"{'='*90}")
        for idx, (name, items) in enumerate(rows, 1):
            sample = items[0]
            float_values = [it.float_value for it in items if it.float_value > 0]
            if float_values:
                float_text = f"{min(float_values):.6f} ~ {max(float_values):.6f}"
            else:
                float_text = "-"

            quality_ids = sorted({it.quality for it in items})
            rarity_ids = sorted({it.rarity for it in items})
            if len(quality_ids) == 1:
                quality_text = f"{sample.quality_name}({quality_ids[0]})"
            else:
                quality_text = f"Mixed{quality_ids}"
            if len(rarity_ids) == 1:
                rarity_text = f"{sample.rarity_name}({rarity_ids[0]})"
            else:
                rarity_text = f"Mixed{rarity_ids}"

            print(
                f"[{idx}] {name}\n"
                f"    数量: {len(items)}  DefIndex: {sample.def_index}  "
                f"品质: {quality_text}  稀有度: {rarity_text}\n"
                f"    Float范围: {float_text}"
            )
        print(f"{'='*90}\n")

    def display_filtered_out_items(self, limit: int = 0):
        """显示本次加载中被过滤的条目（调试用）"""
        if not self.filtered_out_items:
            print("本次加载没有过滤任何条目")
            return

        rows = list(self.filtered_out_items)
        if limit > 0:
            rows = rows[:limit]

        print(f"\n{'='*110}")
        print(
            f"被过滤条目（本次共 {len(self.filtered_out_items)} 条）"
            f"{f'，显示前 {limit} 条' if limit > 0 else ''}"
        )
        print(f"{'='*110}")
        for idx, record in enumerate(rows, 1):
            print(
                f"[{idx}] {record.get('name', '-')}\n"
                f"    Asset ID: {record.get('asset_id')}  Def/Paint: "
                f"{record.get('def_index')}/{record.get('paint_index')}\n"
                f"    品质/稀有度: {record.get('quality')}/{record.get('rarity')}  "
                f"origin: {record.get('origin')}  flags: {record.get('flags')}  "
                f"inventory: {record.get('inventory')}\n"
                f"    过滤原因: {record.get('reason')}"
            )
        print(f"{'='*110}\n")

    def get_worst_float_items(self, quality: int, rarity: int,
                             count: int = 10) -> List[Item]:
        """
        获取指定品质和稀有度中磨损值最差的物品（用于炼金）

        Args:
            quality: 品质
            rarity: 稀有度
            count: 数量

        Returns:
            磨损值最高的物品列表
        """
        items = InventoryFilter.by_quality_and_rarity(self.items, quality, rarity)
        sorted_items = InventorySorter.by_float(items, reverse=True)  # 磨损值从高到低
        return sorted_items[:count]
