# 皮肤商品图片入库设计

## 1. 背景

当前仓库已经能把 `collection`、`rarity`、磨损区间等详情字段补回 `skin` 表，但数据库里还需要保存 BUFF 商品级图片。

魔尊确认后的业务规则是：

- 一个物品 family 里的多个磨损版本、多个 BUFF `goods_id`
- 可以共用同一张商品图

因此图片补齐不再按 exact item 逐条写不同图片，而是按 family 共享一张图。

## 2. 关键结论

### 2.1 图片主源改为商品页 HTML

当前图片主源不是 `goods/info`，而是商品页 HTML：

```text
GET https://buff.163.com/goods/<goods_id>
```

解析顺序：

1. 商品页主图区域 `detail-pic img`
2. 页面里的 `market.fp.ps.netease.com/file/...` 图片
3. `og:image`

这样做的原因：

- 魔尊实际浏览器里能稳定看到的是商品页图片
- 即使某些 JSON 接口被限流或封禁，商品页图片仍常常可见
- 该来源更贴近 UI 里真正想展示的“商品级图片”

### 2.2 图片按 family 共享，不按 exact item 拆分

当前实现与业务要求一致，使用 family 级共享策略：

- 同一家族不同磨损版本共用一张图
- 同一家族不同 `buffid` 共用一张图
- 数据库存储仍在每一行各自的图片列里，但来源与写入策略按 family 广播

这比 exact-item 图片更符合当前使用目标，也能减少请求量和补齐漂移。

### 2.3 不改动现有 family 级详情主链

`collection` / `rarity` 已经是 family 级补齐逻辑，图片继续沿用相同 family 边界。

这样做的好处：

- 责任边界一致
- 请求量更低
- 一次成功即可整族复用
- 手动补图脚本也能沿用同一套逻辑

## 3. 数据库设计

在 `skin` 表保留三列图片字段：

- `goods_icon_url TEXT DEFAULT ''`
- `goods_original_icon_url TEXT DEFAULT ''`
- `goods_share_thumbnail_url TEXT DEFAULT ''`

当前实现写入策略：

- 如果 family 内已有任一成员存在完整图片，则整族可直接复用
- 如果 family 全部为空，则只请求一个代表 `goods_id`
- 成功后同一张图片写回全 family

## 4. 运行时流程

整体流程调整为四段：

1. 基础入库
2. family 级 `collection` / `rarity` 详情补齐
3. family 级磨损区间补齐
4. family 级图片补齐

图片补齐步骤：

- 扫描 `skin` 表中任一图片列为空的 family
- 选取 family 中第一个可用 `buffid` 作为代表
- 请求该代表商品页 HTML
- 解析图片 URL
- 将同一组图片字段写回该 family 的所有成员

此外保留一个手动脚本：

- `tools/fillMissingSkinImages.js`

用于只跑图片补齐，不重建全库。

## 5. 错误与节流策略

图片补齐复用当前 provider / service 的请求控制策略：

- timeout / 5xx / 429 可重试
- 429 会提升请求间隔
- 连续成功后会逐步回落延时
- 单个 family 失败不会影响前面已成功的详情和磨损补齐

失败后的 family 仍保留空图片列，等待后续重试或手动补图。

## 6. 模块改动

### 6.1 Provider

- `node_sidecar/src/services/buffSkinDetailProvider.js`
  - 提供 `fetchGoodsImageByGoodsId(goodsId)`
  - 从商品页 HTML 提取图片

### 6.2 Enrichment Service

- `node_sidecar/src/services/skinDetailEnrichmentService.js`
  - 以 family 为单位收集待补图行
  - 使用代表 `goods_id` 抓一次图片
  - 成功后整族写回
  - 统计 `image_rows_pending / ok / failed / still_missing`

### 6.3 DB Sync

- `node_sidecar/src/skinDbSync.js`
  - 确保图片列存在
  - 导入时可复用既有 family 图片元数据
  - 在 `enrichMissingDetails()` 中顺带跑图片补齐

### 6.4 Manual Tool

- `tools/fillMissingSkinImages.js`
  - 提供只补图片的独立 CLI
  - 支持 `--db`、`--delay-ms`、`--limit`、`--retry-limit`、`--retry-delay-ms`、`--no-backup`

## 7. 测试策略

覆盖以下回归点：

1. provider 能从商品页 HTML 解析图片
2. 一个 family 只抓取一次图片
3. 同 family 多条记录会写入同一张图
4. 已有详情、缺图片的记录仍可单独补图
5. 手动图片补齐脚本可以从数据库当前状态继续补

## 8. 验收标准

满足以下条件即视为达标：

1. `skin` 表存在三列商品图片字段
2. 已有 `buffid` 的 family 可从 BUFF 商品页补回图片
3. 同 family 所有成员写入同一张商品图
4. 图片补齐失败不影响详情补齐与磨损补齐成功结果
5. 重新执行重建脚本或手动补图脚本时，已保存图片可以继续复用
