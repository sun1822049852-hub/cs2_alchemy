const assert = require("node:assert/strict");

const {parseInventory} = require("../node_sidecar/src/inventoryParser");

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

test_parse_inventory_prefers_crates_category_over_flat_item_defs_for_direct_items();
test_parse_inventory_prefers_patch_category_for_style_based_items();

console.log("inventoryCategoryAwareSchema tests passed");
