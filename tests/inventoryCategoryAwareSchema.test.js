const assert = require("node:assert/strict");

const {parseInventory} = require("../node_sidecar/src/inventoryParser");
const {buildCraftCandidateContext} = require("../node_sidecar/src/services/craftCandidateService");

function writeUint32Bytes(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(Number(value) >>> 0, 0);
  return buf;
}

function test_parse_inventory_prefers_crates_category_over_flat_item_defs_for_direct_items() {
  const parsed = parseInventory([{
    id: "9001",
    def_index: 4880,
    quality: 4,
    rarity: 1,
    inventory: 1,
    attribute: []
  }], {
    weapons: {},
    paints: {},
    item_defs: {
      "4880": "Sticker | Dark Water Surf Ava (Foil)"
    },
    item_defs_by_category: {
      crates: {
        "4880": "Revolution Case"
      },
      stickers: {
        "4880": "Sticker | Dark Water Surf Ava (Foil)"
      }
    }
  });
  const row = parsed.rows[0];
  assert.equal(row.name, "Revolution Case");
  assert.equal(row.market_hash_name, "Revolution Case");
}

function test_parse_inventory_prefers_patch_category_for_style_based_items() {
  const parsed = parseInventory([{
    id: "9002",
    def_index: 6000,
    quality: 4,
    rarity: 1,
    inventory: 1,
    attribute: [
      {def_index: 113, value_bytes: writeUint32Bytes(5105)}
    ]
  }], {
    weapons: {},
    paints: {},
    item_defs: {
      "5105": "Ground Rebel  | Elite Crew"
    },
    item_defs_by_category: {
      patches: {
        "5105": "Patch | Movers"
      },
      agents: {
        "5105": "Ground Rebel  | Elite Crew"
      }
    }
  });
  const row = parsed.rows[0];
  assert.equal(row.name, "Patch | Movers");
  assert.equal(row.market_hash_name, "Patch | Movers");
}

function test_parse_inventory_keeps_64_bit_asset_ids_as_strings() {
  const largeIdA = "9007199254740993";
  const largeIdB = "9007199254740992";
  const parsed = parseInventory([{
    id: largeIdA,
    def_index: 7,
    quality: 4,
    rarity: 3,
    inventory: 1,
    casket_id: "9007199254740995",
    attribute: []
  }, {
    id: largeIdB,
    def_index: 8,
    quality: 4,
    rarity: 3,
    inventory: 1,
    attribute: []
  }], {
    weapons: {},
    paints: {},
    item_defs: {
      "7": "Component Item",
      "8": "Market Item"
    }
  });

  assert.deepEqual(parsed.rows.map((row) => row.asset_id), [largeIdB, largeIdA]);
  assert.equal(typeof parsed.rows[0].asset_id, "string");

  for (const row of parsed.rows) {
    row.is_craftable = true;
    row.craftable_reason = "ok";
  }
  const rowsByAssetId = new Map(parsed.rows.map((row) => [String(row.asset_id), row]));
  assert.equal(rowsByAssetId.get(largeIdA).casket_id, "9007199254740995");
  assert.equal(rowsByAssetId.get(largeIdB).market_hash_name, "Market Item");

  const craftContext = buildCraftCandidateContext({
    rows: parsed.rows,
    includeComponentItems: true,
    includeCooling: false,
    selectedItemIds: [largeIdA]
  });
  assert.equal(craftContext.rowsById.get(largeIdA).asset_id, largeIdA);
  assert.equal(craftContext.stats.selected_component_count, 1);
}

test_parse_inventory_prefers_crates_category_over_flat_item_defs_for_direct_items();
test_parse_inventory_prefers_patch_category_for_style_based_items();
test_parse_inventory_keeps_64_bit_asset_ids_as_strings();

console.log("inventoryCategoryAwareSchema tests passed");
