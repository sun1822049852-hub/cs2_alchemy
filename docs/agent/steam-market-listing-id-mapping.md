# Steam Market 上架 ID / `itemid` 调查

## 判词

当前项目的 Steam 上架链路里，真正涉及的是三种不同 ID：

| 环节 | Steam / 依赖字段 | 本项目字段 | 含义 |
| --- | --- | --- | --- |
| 上架提交 | `assetid` | `assetId` | 待上架库存物品 ID |
| 待确认列表 | `id` | `confirmation.id` | 手机确认单 ID |
| 待确认列表 | `creator_id` | `creator` | 被确认对象 ID；在 MarketListing 场景下是 market listing 对象号 |

这三者不是同一个东西。当前链路里没有可靠的 `itemid` 字段；若有人口头说“itemid”，必须先问清是在指 `assetid`、`confirmation.id`，还是 `creator_id`。

## 证据链

### 1. 上架提交只用 `assetid`

- `node_sidecar/src/steamMarketService.js`
  - `sellItem({ assetId, ... })` 调 `POST https://steamcommunity.com/market/sellitem/`
  - 请求体固定带：
    - `appid=730`
    - `contextid=2`
    - `assetid=String(assetId)`
- 结论：
  - Web 上架提交定位具体物品，靠的是 `assetid`
  - 这就是 Web Inventory API 返回的 `assetid`
  - 也是 GC 库存 `item.id -> asset_id`

### 2. 手机确认列表里的 `id` 不是物品 ID

- `node_sidecar/node_modules/steamcommunity/components/confirmations.js`
  - `getConfirmations()` 把 `body.conf[].id` 映射成 `CConfirmation.id`
- 结论：
  - 这里的 `id` 是确认单本身的 ID
  - 批量确认接口 `/api/market/confirm-listings` 也正是用它来选中确认项

### 3. 手机确认列表里的 `creator_id` 才是被确认对象号

- `node_sidecar/node_modules/steamcommunity/components/confirmations.js`
  - `creator: conf.creator_id`
- `node_sidecar/node_modules/steamcommunity/components/confirmations.js`
  - `acceptConfirmationForObject(identitySecret, objectID, ...)`
  - 内部直接 `conf.creator == objectID` 做匹配
  - 注释明确写的是 `trade offer or market listing`
- `node_sidecar/node_modules/steamcommunity/classes/CConfirmation.js`
  - Trade 场景把 `creator` 视为 `offerID`
  - 非 Trade 不会把它叫 `offerID`，但字段仍保留为被确认对象号
- 结论：
  - 对 MarketListing 类型确认，`creator_id` 不是确认单 ID
  - 它是被确认的 market listing 对象 ID

## 当前项目状态

### 已经有的

- `node_sidecar/src/steamMarketService.js`
  - `getMarketConfirmations()` 已经把 `creator` 从依赖对象里透传出来
- `node_sidecar/src/uiServer.js`
  - `/api/market/confirmations` 可以把确认列表返回给前端

### 还缺的

1. `sellItem()` 当前没有解析或返回 `listingId`
2. `/api/market/batch-sell` 只往 SSE 发 `assetId + result`，没保留 listing 对象号
3. `node_sidecar/ui/app.js` 的确认弹窗只展示 `id/title/description/icon`，没有使用 `creator`

## 直接后果

当前项目可以：

- 用 `assetid` 正确提交上架
- 用 `confirmation.id` 正确批量确认

但当前项目还不能：

- 在“待确认上架项”里精确回指到原始库存行
- 稳定建立 `assetid -> market listing object id -> confirmation.id` 的完整映射

## 后续第一刀

若要继续把这条线做实，优先级应是：

1. 先确认 `/market/sellitem/` 响应里是否稳定带 `listingid` / `listing_id`
2. 若有，扩 `sellItem()` 返回值，并在 `/api/market/batch-sell` 里把 `assetId -> listingId` 暂存
3. 前端确认弹窗同时展示 `confirmation.id` 与 `creator`
4. 用本地暂存映射把确认项反查回原始 `assetid`

在这四步没做完之前，不要把 `creator_id` 混叫成 `itemid`，否则后面一定串线。
