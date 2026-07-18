const assert = require("node:assert/strict");

const SHARED_HELPER_PATH = "../node_sidecar/ui/craftAssistItemWearShared";
const tests = [];

function test(name, fn) {
  tests.push({name, fn});
}

function loadSharedHelper() {
  return require(SHARED_HELPER_PATH);
}

function getSharedMethod(methodName) {
  const shared = loadSharedHelper();
  assert.ok(shared && typeof shared === "object", "shared helper should export an object");
  assert.equal(typeof shared[methodName], "function", `${methodName} should be exported`);
  return shared[methodName];
}

function makeInventoryRow({
  id,
  name,
  relative = 0.5,
  min = 0,
  max = 1,
  rarity = 4
}) {
  return {
    asset_id: String(id),
    name,
    alchemy_name: name,
    float_value: min + (max - min) * relative,
    minfloat: min,
    maxfloat: max,
    rarity,
    quality: 0,
    quality_name: "Normal",
    is_craftable: true,
    hidden_reason: "",
    casket_id: "",
    tradable_after: 0
  };
}

const LEGACY_MAIN_MATERIAL = {
  id: "main-legacy",
  role: "main",
  count: 2,
  names: [
    "AK-47 | Slate (Field-Tested)",
    "AK-47 | Slate (Field-Tested)",
    "M4A1-S | Basilisk (Field-Tested)"
  ],
  wear_min: 0.123456789,
  wear_max: 0.234567891,
  custom_range: true
};

const NEW_AUX_MATERIAL = {
  id: "aux-modern",
  role: "aux",
  count: 8,
  names: ["legacy names should be ignored"],
  wear_min: 0.91,
  wear_max: 0.99,
  custom_range: true,
  items: [
    {
      name: "USP-S | Cortex (Field-Tested)",
      wear_filter_mode: "relative",
      wear_min: 0.345678912,
      wear_max: 0.567891234,
      custom_range: true
    },
    {
      id: "keep-explicit",
      name: "P250 | Muertos (Factory New)",
      wear_filter_mode: "absolute",
      wear_min: 0.99,
      wear_max: 0.99,
      custom_range: false
    },
    {
      name: "AK-47 | Slate (Field-Tested)",
      wear_filter_mode: "relative",
      wear_min: 0.01,
      wear_max: 0.02,
      custom_range: true
    }
  ]
};

const FALLBACK_INDEX_FIXTURE = [
  {
    id: "lead-main",
    role: "main",
    count: 1,
    names: ["Lead Skin (Factory New)"],
    wear_min: 0.2,
    wear_max: 0.3,
    custom_range: true
  },
  {
    role: "aux",
    count: 9,
    items: [
      {
        name: "Fallback Skin (Field-Tested)",
        wear_filter_mode: "relative",
        wear_min: 0.12,
        wear_max: 0.34,
        custom_range: true
      }
    ]
  }
];

const CANONICAL_ROWS = [
  makeInventoryRow({
    id: "usp-1",
    name: "USP-S | Cortex (Field-Tested)",
    relative: 0.5,
    min: 0.2,
    max: 0.6
  }),
  makeInventoryRow({
    id: "p250-1",
    name: "P250 | Muertos (Factory New)",
    relative: 0.5,
    min: 0,
    max: 0.08
  }),
  makeInventoryRow({
    id: "fallback-1",
    name: "Fallback Skin (Field-Tested)",
    relative: 0.4,
    min: 0.2,
    max: 0.5
  })
];

function normalizeCanonical(materials, options = {}) {
  const normalize = getSharedMethod("normalizeCraftAssistMaterialListCanonical");
  return normalize(materials, {
    rows: CANONICAL_ROWS,
    source: "load",
    ...options
  });
}

test("canonical normalize upgrades legacy payloads, ignores stale material-level fields, and exposes runtime projections", () => {
  const first = normalizeCanonical([LEGACY_MAIN_MATERIAL, NEW_AUX_MATERIAL]);
  const second = normalizeCanonical([LEGACY_MAIN_MATERIAL, NEW_AUX_MATERIAL]);

  assert.equal(first.length, 2);

  const main = first[0];
  const aux = first[1];

  assert.equal(main.id, "main-legacy");
  assert.equal(main.role, "main");
  assert.equal(main.count, 2);
  assert.deepEqual(main.item_names, [
    "AK-47 | Slate (Field-Tested)",
    "M4A1-S | Basilisk (Field-Tested)"
  ]);
  assert.equal(main.primary_name, "AK-47 | Slate (Field-Tested)");
  assert.equal(main.label, "AK-47 | Slate (Field-Tested) / M4A1-S | Basilisk (Field-Tested)");
  assert.equal(main.name, main.primary_name);
  assert.deepEqual(main.names, main.item_names);
  assert.equal(main.items.length, 2);
  assert.equal(main.items[0].wear_filter_mode, "relative");
  assert.equal(main.items[0].wear_min, 0.123456789);
  assert.equal(main.items[0].wear_max, 0.234567891);
  assert.equal(main.items[0].custom_range, true);
  assert.equal(main.items[0].id, second[0].items[0].id);
  assert.equal(main.items[1].id, second[0].items[1].id);
  assert.notEqual(main.items[0].id, main.items[1].id);
  assert.match(main.items[0].id, /main-legacy/i);

  assert.equal(aux.id, "aux-modern");
  assert.equal(aux.role, "aux");
  assert.equal(aux.count, 8);
  assert.deepEqual(aux.item_names, [
    "USP-S | Cortex (Field-Tested)",
    "P250 | Muertos (Factory New)"
  ]);
  assert.equal(aux.primary_name, "USP-S | Cortex (Field-Tested)");
  assert.equal(aux.label, "USP-S | Cortex (Field-Tested) / P250 | Muertos (Factory New)");
  assert.equal(aux.name, aux.primary_name);
  assert.deepEqual(aux.names, aux.item_names);
  assert.equal(aux.items.length, 2);
  assert.equal(aux.items[0].id, second[1].items[0].id);
  assert.equal(aux.items[0].custom_range, true);
  assert.equal(aux.items[0].wear_filter_mode, "relative");
  assert.equal(aux.items[0].wear_min, 0.345678912);
  assert.equal(aux.items[0].wear_max, 0.567891234);
  assert.equal(aux.items[1].id, "keep-explicit");
  assert.equal(aux.items[1].custom_range, false);
  assert.equal(aux.items[1].wear_filter_mode, "absolute");
  assert.equal(aux.items[1].wear_min, 0);
  assert.equal(aux.items[1].wear_max, 0.07);
  assert.equal(aux.item_names.includes("legacy names should be ignored"), false);
});

test("canonical normalize mints deterministic item ids when material.id is missing", () => {
  const first = normalizeCanonical(FALLBACK_INDEX_FIXTURE);
  const second = normalizeCanonical(FALLBACK_INDEX_FIXTURE);

  assert.equal(first.length, 2);
  assert.equal(first[1].items.length, 1);
  assert.equal(first[1].items[0].id, second[1].items[0].id);
  assert.notEqual(first[1].items[0].id, "");
  assert.match(first[1].items[0].id, /fallback/i);
});

test("canonical normalize keeps minted item ids stable when earlier id-less materials disappear", () => {
  const first = normalizeCanonical([
    {role: "main", count: 1, name: "A"},
    {role: "aux", count: 1, name: "B"}
  ], {rows: []});
  const second = normalizeCanonical([
    {role: "aux", count: 1, name: "B"}
  ], {rows: []});

  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  assert.equal(first[1].items[0].id, second[0].items[0].id);
});

test("canonical normalize keeps auxiliary zero counts and catalog metadata while main remains required", () => {
  const canonical = normalizeCanonical([
    {
      id: "main-zero",
      role: "main",
      count: 0,
      items: [{name: "Required Main", wear_filter_mode: "relative", wear_min: 0, wear_max: 1}]
    },
    {
      id: "aux-zero",
      role: "aux",
      count: 0,
      items: [{
        name: "FAMAS | Half Sleeve (Field-Tested)",
        display_name: "法玛斯 | 半袖式 (久经沙场)",
        rarity: "军规级",
        collection: "狩猎运动收藏品",
        wear_filter_mode: "relative",
        wear_min: 0.15,
        wear_max: 0.38
      }]
    }
  ], {rows: []});

  assert.equal(canonical[0].count, 1);
  assert.equal(canonical[1].count, 0);
  assert.equal(canonical[1].items[0].display_name, "法玛斯 | 半袖式 (久经沙场)");
  assert.equal(canonical[1].items[0].rarity, "军规级");
  assert.equal(canonical[1].items[0].collection, "狩猎运动收藏品");

  const projected = getSharedMethod("projectCraftAssistPersistedMaterials")(canonical);
  assert.equal(projected[1].count, 0);
  assert.equal(projected[1].items[0].display_name, "法玛斯 | 半袖式 (久经沙场)");
  assert.equal(projected[1].items[0].rarity, "军规级");
  assert.equal(projected[1].items[0].collection, "狩猎运动收藏品");
});

test("persisted projection strips runtime-only fields and shared cache/trace helpers reuse the canonical item projection", () => {
  const canonical = normalizeCanonical([LEGACY_MAIN_MATERIAL, NEW_AUX_MATERIAL]);
  const projectPersisted = getSharedMethod("projectCraftAssistPersistedMaterials");
  const buildCacheTuple = getSharedMethod("buildCraftAssistCandidateCacheKeyTuple");
  const projectTraceMaterial = getSharedMethod("projectCraftAssistTraceMaterial");

  const projected = projectPersisted(canonical);
  assert.deepEqual(projected, [
    {
      id: "main-legacy",
      role: "main",
      count: 2,
      items: [
        {
          id: canonical[0].items[0].id,
          name: "AK-47 | Slate (Field-Tested)",
          wear_filter_mode: "relative",
          wear_min: 0.123456789,
          wear_max: 0.234567891,
          custom_range: true
        },
        {
          id: canonical[0].items[1].id,
          name: "M4A1-S | Basilisk (Field-Tested)",
          wear_filter_mode: "relative",
          wear_min: 0.123456789,
          wear_max: 0.234567891,
          custom_range: true
        }
      ]
    },
    {
      id: "aux-modern",
      role: "aux",
      count: 8,
      items: [
        {
          id: canonical[1].items[0].id,
          name: "USP-S | Cortex (Field-Tested)",
          wear_filter_mode: "relative",
          wear_min: 0.345678912,
          wear_max: 0.567891234,
          custom_range: true
        },
        {
          id: "keep-explicit",
          name: "P250 | Muertos (Factory New)",
          wear_filter_mode: "absolute",
          wear_min: 0,
          wear_max: 0.07,
          custom_range: false
        }
      ]
    }
  ]);
  for (const material of projected) {
    assert.equal(Object.prototype.hasOwnProperty.call(material, "item_names"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(material, "primary_name"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(material, "label"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(material, "name"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(material, "names"), false);
  }

  assert.deepEqual(
    buildCacheTuple(canonical[1], 0.3333339),
    [
      "0.3333339000000000",
      "USP-S | Cortex (Field-Tested)",
      "relative",
      "0.3456789120000000",
      "0.5678912340000000",
      "P250 | Muertos (Factory New)",
      "absolute",
      "0.0000000000000000",
      "0.0700000000000000"
    ]
  );

  const traceProjection = projectTraceMaterial(canonical[1]);
  assert.equal(traceProjection.materialName, "USP-S | Cortex (Field-Tested)");
  assert.equal(traceProjection.primary_name, "USP-S | Cortex (Field-Tested)");
  assert.deepEqual(traceProjection.item_names, [
    "USP-S | Cortex (Field-Tested)",
    "P250 | Muertos (Factory New)"
  ]);
  assert.equal(traceProjection.label, "USP-S | Cortex (Field-Tested) / P250 | Muertos (Factory New)");
});

test("resolveCraftAssistItemDefaultRange follows the resolver matrix for load/restore/renormalize/mode-switch", () => {
  const resolveDefaultRange = getSharedMethod("resolveCraftAssistItemDefaultRange");

  const cases = [
    {
      name: "relative load merges metadata and rows via valid intersection",
      args: [
        "Resolver Skin (Field-Tested)",
        {
          wearFilterMode: "relative",
          rows: [
            makeInventoryRow({
              id: "resolver-intersection",
              name: "Resolver Skin (Field-Tested)",
              relative: 0.5,
              min: 0.2,
              max: 0.4
            })
          ],
          storedRange: {wear_min: 0.91, wear_max: 0.99},
          customRange: false,
          source: "load"
        }
      ],
      expected: {
        wear_min: 0,
        wear_max: 0.8999999999999999,
        usedStoredFallback: false,
        resolvedCustomRange: false
      }
    },
    {
      name: "absolute restore salvages swapped stored fallback when rows are unavailable",
      args: [
        "Fallback Only Skin",
        {
          wearFilterMode: "absolute",
          rows: null,
          storedRange: {wear_min: 0.42, wear_max: 0.18},
          customRange: false,
          source: "restore"
        }
      ],
      expected: {
        wear_min: 0.18,
        wear_max: 0.42,
        usedStoredFallback: true,
        resolvedCustomRange: false
      }
    },
    {
      name: "renormalize downgrades unusable stored fallback to 0~1 when customRange is false",
      args: [
        "Broken Stored Range Skin",
        {
          wearFilterMode: "absolute",
          rows: null,
          storedRange: {wear_min: 0.35, wear_max: Number.NaN},
          customRange: false,
          source: "renormalize"
        }
      ],
      expected: {
        wear_min: 0,
        wear_max: 1,
        usedStoredFallback: false,
        resolvedCustomRange: false
      }
    },
    {
      name: "load clamps custom ranges to current rows metadata and keeps custom semantics",
      args: [
        "Clamp Custom Skin (Field-Tested)",
        {
          wearFilterMode: "absolute",
          rows: [
            makeInventoryRow({
              id: "custom-clamp",
              name: "Clamp Custom Skin (Field-Tested)",
              relative: 0.5,
              min: 0.3,
              max: 0.5
            })
          ],
          storedRange: {wear_min: 0.9, wear_max: 0.1},
          customRange: true,
          source: "load"
        }
      ],
      expected: {
        wear_min: 0.3,
        wear_max: 0.38,
        usedStoredFallback: false,
        resolvedCustomRange: true
      }
    },
    {
      name: "restore downgrades invalid custom ranges back to the current default range",
      args: [
        "Downgrade Custom Skin (Field-Tested)",
        {
          wearFilterMode: "absolute",
          rows: [
            makeInventoryRow({
              id: "custom-downgrade",
              name: "Downgrade Custom Skin (Field-Tested)",
              relative: 0.5,
              min: 0.2,
              max: 0.4
            })
          ],
          storedRange: {wear_min: 0.27, wear_max: Number.NaN},
          customRange: true,
          source: "restore"
        }
      ],
      expected: {
        wear_min: 0.2,
        wear_max: 0.38,
        usedStoredFallback: false,
        resolvedCustomRange: false
      }
    },
    {
      name: "rows+metadata invalid intersection falls back to float bounds instead of stale stored data",
      args: [
        "Conflict Skin (Factory New)",
        {
          wearFilterMode: "absolute",
          rows: [
            makeInventoryRow({
              id: "conflict-range",
              name: "Conflict Skin (Factory New)",
              relative: 0.5,
              min: 0.2,
              max: 0.4
            })
          ],
          storedRange: {wear_min: 0.01, wear_max: 0.02},
          customRange: false,
          source: "load"
        }
      ],
      expected: {
        wear_min: 0.2,
        wear_max: 0.4,
        usedStoredFallback: false,
        resolvedCustomRange: false
      }
    },
    {
      name: "mode-switch never falls back to storedRange when current constraints are unavailable",
      args: [
        "Mode Switch Skin",
        {
          wearFilterMode: "absolute",
          rows: null,
          storedRange: {wear_min: 0.22, wear_max: 0.24},
          customRange: false,
          source: "mode-switch"
        }
      ],
      expected: {
        wear_min: 0,
        wear_max: 1,
        usedStoredFallback: false,
        resolvedCustomRange: false
      }
    }
  ];

  for (const entry of cases) {
    assert.deepEqual(resolveDefaultRange(...entry.args), entry.expected, entry.name);
  }
});

(async () => {
  const failures = [];
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`ok - ${entry.name}`);
    } catch (error) {
      failures.push({name: entry.name, error});
      console.error(`not ok - ${entry.name}`);
      console.error(error);
    }
  }
  if (failures.length > 0) {
    console.error(`craftAssistItemWearShared tests failed: ${failures.length}`);
    process.exit(1);
  }
  console.log("craftAssistItemWearShared tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
