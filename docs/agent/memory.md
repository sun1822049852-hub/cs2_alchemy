# Memory

- 2026-04-16: `craftAssistService` 的成功返回路径带有终局磨损校验。该硬闸只作用于 `below` 模式，`infinite` 模式必须跳过，避免误伤“逼近磨损”选择。若终局校验拦截，失败结果与服务端日志都要带上 `safe_target`、`approach_mode`、`item_ids`，并展开 `selected_items` 明细，其中至少包含每件材料的 `asset_id`、`name`、`absolute_wear`、`relative_wear`。
