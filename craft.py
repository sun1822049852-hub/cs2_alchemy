from gevent.event import Event
from csgo.proto_enums import EGCItemMsg
from proto_messages import CMsgGCCraft, CMsgGCCraftResponse

EMSG_CRAFT = int(EGCItemMsg.EMsgGCCraft)  # GC 消息 ID：发送炼金请求
EMSG_CRAFT_RESPONSE = int(EGCItemMsg.EMsgGCCraftResponse)  # GC 消息 ID：接收炼金结果


class CraftExecutor:
    def __init__(self, cs2_client):
        self.cs2     = cs2_client.cs2
        self._event  = Event()  # gevent 友好的等待事件
        self._result = None

        # 注册响应处理器，GC 返回 1003 消息时自动触发
        self.cs2.on(EGCItemMsg.EMsgGCCraftResponse, self._on_response)
        self.cs2.on(EMSG_CRAFT_RESPONSE, self._on_response)

    def _on_response(self, msg_body):
        """
        GC 炼金响应回调
        msg_body: 原始 Protobuf 二进制数据，解析后得到：
          recipe_def_index: 本次使用的配方 ID（用于确认）
          item_ids: 新生成物品的 asset_id 列表（汰换结果只有 1 件）
        """
        if isinstance(msg_body, (bytes, bytearray)):
            raw = bytes(msg_body)
        elif hasattr(msg_body, "SerializeToString"):
            raw = msg_body.SerializeToString()
        else:
            return

        resp = CMsgGCCraftResponse()
        resp.ParseFromString(raw)
        self._result = {
            "recipe":    resp.recipe_def_index,
            "new_items": list(resp.item_ids),  # 新物品 asset_id
        }
        self._event.set()  # 通知 execute() 结果已到达

    def execute(self, recipe_id: int, asset_ids: list[int], timeout: int = 10) -> dict | None:
        """
        发送炼金请求并阻塞等待结果

        recipe_id : 配方 ID，由上层筛选逻辑根据 (quality, rarity) 映射后传入
        asset_ids : 10 件材料的 asset_id，由上层筛选逻辑选好后传入
        timeout   : 等待 GC 响应的最长秒数

        返回值：
          成功 → {"recipe": int, "new_items": [asset_id]}
          超时 → None
        """
        if recipe_id <= 0:
            raise ValueError("recipe_id 必须是正整数")
        if len(asset_ids) != 10:
            raise ValueError("asset_ids 必须恰好 10 个")
        if any(not isinstance(asset_id, int) or asset_id <= 0 for asset_id in asset_ids):
            raise ValueError("asset_ids 必须都是正整数")
        if len(set(asset_ids)) != 10:
            raise ValueError("asset_ids 中存在重复项")

        self._event.clear()
        self._result = None

        payload = CMsgGCCraft(recipe=recipe_id, items=asset_ids).SerializeToString()
        self.cs2.send_raw_gc(EMSG_CRAFT, payload)

        return self._result if self._event.wait(timeout) else None
