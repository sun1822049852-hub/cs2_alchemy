# Weapon Armory GC Investigation

## Purpose

Internal note for reproducing the CS2 Armory / XP Shop reverse-engineering work in `cs2_alchemy`.
This file is not customer-facing.

## Current Conclusion

- `welcome/type_id=6` is XP shop account state, not a redeem request.
- Static Armory catalog comes from local `items_game.txt` / language files.
- Real redemption uses GC `9209` (`ClientRedeemMissionReward`).
- `cs2-stars` uses `armoryId` as the second field of `9209`, so it is a high-confidence candidate for `redeem_id`.
- The exact source of per-item `redeem_id` is still not publicly documented.

## Confirmed Evidence

### 1. Live trace behavior

- `ClientWelcome` is pushed automatically after GC connect; no extra request was needed.
- Account `x833830262` showed `type_id=6` with:
  - `candidate=CSOAccountXpShop`
  - `generation_time=1775719408`
  - `redeemable_balance=194`
- Account `19174601720` only showed `type_id=1/2/7`, not `type_id=6`.
- Sending `9222` (`Client2GcAckXPShopTracks`) produced no extra redeem metadata.

### 2. Public protobuf evidence

From `SteamDatabase/Protobufs`:

- `9209 = ClientRedeemMissionReward`
- `9221 = GC2ClientNotifyXPShop`
- `9222 = Client2GcAckXPShopTracks`
- `CSOAccountXpShop { generation_time, redeemable_balance, xp_tracks }`
- `CSOAccountXpShopBids { campaign_id, redeem_id, expected_cost, generation_time }`

This means `type_id=6` matching `CSOAccountXpShop` can explain balance / tracks, but not the actual redeem request.

### 3. Static catalog evidence

From `heapyxyz/items-parser`:

- `items/cs2.txt` contains `seasonaloperations -> "11" -> redeemable_goods "xpshop"`
- The same block statically lists current Armory entries such as:
  - `lootlist:set_train_2025`
  - `lootlist:set_overpass_2024`
  - `lootlist:set_realism_camo`
  - `crate_community_35` (`Fever Case`)
  - keychain / sticker lootlists
- The block includes `points` cost, callout token, and thumbnail data.
- It does **not** expose a plaintext `redeem_id` / `armoryId` field.

### 4. `cs2-stars` implementation evidence

From `gradinazz/cs2-stars`:

- `items_database.json` stores local `{ name, price, armoryId }`.
- `ArmoryManager.encodeRedeemBody()` sends four fields in order:
  - `11`
  - `armoryId`
  - `stars`
  - `price`

Because public proto `9209` is:

1. `campaign_id`
2. `redeem_id`
3. `redeemable_balance`
4. `expected_cost`

the strongest current inference is:

- `campaign_id = 11`
- `armoryId ~= redeem_id`

## Important Inference Boundaries

- Confirmed:
  - static catalog exists locally
  - balance / tracks can arrive in welcome
  - redeem request format is public
- Not confirmed:
  - where Valve's client obtains each standard Armory `redeem_id`
  - whether every `redeem_id` is derivable from local game files alone
- Likely:
  - normal catalog data is static
  - `redeem_id` is either a hidden static mapping or a transient runtime mapping not exposed by current welcome traffic

## Special Item Note

`AK-47 | Aphrodite` does not appear in the normal `operational_point_redeemable` block.
Current `items_game` data instead shows hidden `set_xpshop_wpn_*` / `Limited Edition Item` entries.
So special limited items may use a different static chain than normal Armory catalog entries.

## Recommended Reproduction Path

1. Enable GC tracing with `CS2_GC_TRACE=1`.
2. Attach `receivedFromGC` before `steam.logOn`.
3. Connect GC and capture `ClientWelcome`.
4. Decode `type_id=6` as XP shop state; do not expect redeem IDs here.
5. Optionally send `9222`, but do not expect it to reveal `redeem_id`.
6. If true `redeem_id` is needed, use the official game client and manually click Armory redeem.
7. Capture the outbound `9209` request from the official client.
8. Decode the outbound fields:
   - field 1 = `campaign_id`
   - field 2 = `redeem_id`
   - field 3 = `redeemable_balance`
   - field 4 = `expected_cost`

## External References

- `SteamDatabase/Protobufs`
- `heapyxyz/items-parser`
- `gradinazz/cs2-stars`
- `sak0a/node-cs2` issue `#1`

## Open Questions

- Exact source of standard Armory `redeem_id`
- Whether `CSOAccountXpShopBids` is only populated under rare account / UI states
- Whether official client keeps an in-memory mapping not persisted in simple static files
