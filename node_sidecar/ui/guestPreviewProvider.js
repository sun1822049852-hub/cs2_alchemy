(function bootstrapGuestPreviewProvider(globalScope) {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createInventoryRow({
    id,
    name,
    collection,
    rarity = 4,
    rarityName = "Restricted",
    wear = 0.1,
    minFloat = 0,
    maxFloat = 1,
    paintIndex = 1,
    paintSeed = 1,
    craftable = true,
    casketId = "",
    hiddenReason = ""
  }) {
    return {
      asset_id: id,
      item_id: id,
      id,
      name,
      alchemy_name: name,
      market_hash_name: name,
      collection,
      collection_en: collection,
      rarity,
      rarity_name: rarityName,
      quality: 4,
      quality_name: "Normal",
      float_value: wear,
      minfloat: minFloat,
      maxfloat: maxFloat,
      paint_index: paintIndex,
      paint_seed: paintSeed,
      is_craftable: craftable,
      casket_id: casketId,
      hidden_reason: hiddenReason,
      goods_icon_url: "",
      goods_original_icon_url: "",
      goods_share_thumbnail_url: ""
    };
  }

  function createSimulationItem({
    key,
    name,
    collection,
    rarity,
    wearLabel,
    minFloat,
    maxFloat,
    absoluteWear,
    editable = true
  }) {
    return {
      markethashname: key,
      name,
      basemarkethashname: name,
      basename: name,
      collection,
      rarity,
      wear_label: wearLabel,
      wearlevel: wearLabel,
      minfloat: minFloat,
      maxfloat: maxFloat,
      absolute_wear: absoluteWear,
      editable,
      goods_icon_url: "",
      goods_original_icon_url: "",
      goods_share_thumbnail_url: ""
    };
  }

  function createSimulationPreset({
    id,
    name,
    primaryOutput,
    auxOutput,
    mainMaterial,
    auxMaterial,
    outputRows,
    materialRows,
    anchorWear
  }) {
    return {
      id,
      name,
      primary_output: clone(primaryOutput),
      aux_output: clone(auxOutput),
      main_material: clone(mainMaterial),
      aux_material: clone(auxMaterial),
      cover_output: clone(primaryOutput),
      active_anchor_item: clone(primaryOutput),
      active_anchor_abs_wear: anchorWear,
      output_rows: clone(outputRows),
      material_rows: clone(materialRows),
      rows: clone(outputRows),
      output_candidates: [],
      warnings: [],
      dirty: false,
      created_at: 1760000000000,
      updated_at: 1760003600000
    };
  }

  const guestAccountCards = [
    {
      remark: "示例主号",
      username: "steam_demo_alpha",
      status: "样例账号",
      note: "登录后可保存 Steam 账号并绑定到当前客户端身份。"
    },
    {
      remark: "示例炼金号",
      username: "steam_demo_beta",
      status: "访客只读",
      note: "当前只展示正式布局与虚构数据，不会读取真实本地账号。"
    }
  ];

  const mainInventoryRows = [
    createInventoryRow({
      id: "guest_row_usp_1",
      name: "USP-S | Cortex",
      collection: "The Clutch Collection",
      wear: 0.08251,
      minFloat: 0.06,
      maxFloat: 0.8,
      paintIndex: 705,
      paintSeed: 101
    }),
    createInventoryRow({
      id: "guest_row_usp_2",
      name: "USP-S | Cortex",
      collection: "The Clutch Collection",
      wear: 0.087263,
      minFloat: 0.06,
      maxFloat: 0.8,
      paintIndex: 705,
      paintSeed: 115
    }),
    createInventoryRow({
      id: "guest_row_usp_3",
      name: "USP-S | Cortex",
      collection: "The Clutch Collection",
      wear: 0.095182,
      minFloat: 0.06,
      maxFloat: 0.8,
      paintIndex: 705,
      paintSeed: 132
    }),
    createInventoryRow({
      id: "guest_row_usp_4",
      name: "USP-S | Cortex",
      collection: "The Clutch Collection",
      wear: 0.101426,
      minFloat: 0.06,
      maxFloat: 0.8,
      paintIndex: 705,
      paintSeed: 143
    }),
    createInventoryRow({
      id: "guest_row_usp_5",
      name: "USP-S | Cortex",
      collection: "The Clutch Collection",
      wear: 0.109864,
      minFloat: 0.06,
      maxFloat: 0.8,
      paintIndex: 705,
      paintSeed: 157
    }),
    createInventoryRow({
      id: "guest_row_awp_1",
      name: "AWP | Atheris",
      collection: "The Prisma Collection",
      wear: 0.091204,
      minFloat: 0,
      maxFloat: 1,
      paintIndex: 838,
      paintSeed: 211
    }),
    createInventoryRow({
      id: "guest_row_awp_2",
      name: "AWP | Atheris",
      collection: "The Prisma Collection",
      wear: 0.108331,
      minFloat: 0,
      maxFloat: 1,
      paintIndex: 838,
      paintSeed: 223
    }),
    createInventoryRow({
      id: "guest_row_awp_3",
      name: "AWP | Atheris",
      collection: "The Prisma Collection",
      wear: 0.116417,
      minFloat: 0,
      maxFloat: 1,
      paintIndex: 838,
      paintSeed: 247
    }),
    createInventoryRow({
      id: "guest_row_awp_4",
      name: "AWP | Atheris",
      collection: "The Prisma Collection",
      wear: 0.124905,
      minFloat: 0,
      maxFloat: 1,
      paintIndex: 838,
      paintSeed: 268
    }),
    createInventoryRow({
      id: "guest_row_awp_5",
      name: "AWP | Atheris",
      collection: "The Prisma Collection",
      wear: 0.138712,
      minFloat: 0,
      maxFloat: 1,
      paintIndex: 838,
      paintSeed: 294
    })
  ];

  const hiddenResultRows = [
    createInventoryRow({
      id: "guest_result_neo_noir",
      name: "M4A4 | Neo-Noir",
      collection: "The Clutch Collection",
      rarity: 5,
      rarityName: "Classified",
      wear: 0.104321,
      minFloat: 0,
      maxFloat: 0.8,
      paintIndex: 695,
      paintSeed: 401,
      craftable: false,
      hiddenReason: "guest_preview_result"
    }),
    createInventoryRow({
      id: "guest_result_neon_rider",
      name: "AK-47 | Neon Rider",
      collection: "The Prisma Collection",
      rarity: 5,
      rarityName: "Classified",
      wear: 0.15777,
      minFloat: 0,
      maxFloat: 1,
      paintIndex: 600,
      paintSeed: 417,
      craftable: false,
      hiddenReason: "guest_preview_result"
    })
  ];

  const componentRows = [
    createInventoryRow({
      id: "guest_component_item_1",
      name: "USP-S | Cortex",
      collection: "The Clutch Collection",
      wear: 0.084911,
      minFloat: 0.06,
      maxFloat: 0.8,
      paintIndex: 705,
      paintSeed: 511,
      casketId: "guest_component_1",
      hiddenReason: "attr#272/273"
    }),
    createInventoryRow({
      id: "guest_component_item_2",
      name: "AWP | Atheris",
      collection: "The Prisma Collection",
      wear: 0.143582,
      minFloat: 0,
      maxFloat: 1,
      paintIndex: 838,
      paintSeed: 533,
      casketId: "guest_component_1",
      hiddenReason: "attr#272/273"
    })
  ];

  const guestInventoryPreview = {
    summary: "访客态沿用正式库存布局，当前全部为虚构样例数据。",
    snapshotPath: "guest-preview/snapshots/mock_inventory.json",
    fetchTime: "2026-04-05 20:16:00",
    rows: mainInventoryRows.concat(hiddenResultRows),
    component: {
      summary_map: {
        guest_component_1: {
          component_id: "guest_component_1",
          name: "Storage Unit | 样例组件 A",
          expected_count: 1000,
          loaded_count: componentRows.length
        }
      },
      item_map: {
        guest_component_1: componentRows
      }
    }
  };

  const activeRecipeId = "guest_recipe_active";
  const guestCraftPreview = {
    summary: "访客态只展示虚构炼金候选、配方队列和预测结果，所有真实执行能力均锁定。",
    candidateRows: clone(mainInventoryRows),
    candidateStats: {
      main_free_slots: 988,
      selected_component_count: 0,
      cooling_count: 0
    },
    recipeQueue: [
      {
        id: activeRecipeId,
        status: "pending",
        prepare_status: "ready",
        item_ids: mainInventoryRows.map((row) => row.asset_id),
        item_sources: {}
      },
      {
        id: "guest_recipe_done",
        status: "done",
        gained_ids: ["guest_result_neo_noir"]
      }
    ],
    activeRecipeId,
    predictor: {
      ok: true,
      required_count: 10,
      current_count: 10,
      target_relative_wear: 0.117638,
      input_rarity: "Restricted",
      output_rarity: "Classified",
      outcomes: [
        {
          base_name: "M4A4 | Neo-Noir",
          name: "M4A4 | Neo-Noir",
          collection_display: "The Clutch Collection",
          collection_key: "The Clutch Collection",
          probability: 0.4,
          predicted_float: 0.104321,
          predicted_wearlevel: "Minimal Wear",
          minfloat: 0,
          maxfloat: 0.8
        },
        {
          base_name: "MP7 | Bloodsport",
          name: "MP7 | Bloodsport",
          collection_display: "The Clutch Collection",
          collection_key: "The Clutch Collection",
          probability: 0.2,
          predicted_float: 0.142219,
          predicted_wearlevel: "Field-Tested",
          minfloat: 0,
          maxfloat: 0.8
        },
        {
          base_name: "AK-47 | Neon Rider",
          name: "AK-47 | Neon Rider",
          collection_display: "The Prisma Collection",
          collection_key: "The Prisma Collection",
          probability: 0.2,
          predicted_float: 0.15777,
          predicted_wearlevel: "Field-Tested",
          minfloat: 0,
          maxfloat: 1
        },
        {
          base_name: "Desert Eagle | Code Red",
          name: "Desert Eagle | Code Red",
          collection_display: "The Prisma Collection",
          collection_key: "The Prisma Collection",
          probability: 0.2,
          predicted_float: 0.081334,
          predicted_wearlevel: "Minimal Wear",
          minfloat: 0,
          maxfloat: 1
        }
      ]
    }
  };

  const presetPrimaryA = createSimulationItem({
    key: "M4A1-S | Player Two",
    name: "M4A1-S | Player Two",
    collection: "The Prisma 2 Collection",
    rarity: "Classified",
    wearLabel: "Minimal Wear",
    minFloat: 0,
    maxFloat: 1,
    absoluteWear: 0.126543
  });
  const presetAuxA = createSimulationItem({
    key: "AK-47 | Ice Coaled",
    name: "AK-47 | Ice Coaled",
    collection: "The Recoil Collection",
    rarity: "Classified",
    wearLabel: "Field-Tested",
    minFloat: 0,
    maxFloat: 1,
    absoluteWear: 0.158412
  });
  const presetMainMaterialA = createSimulationItem({
    key: "USP-S | Cortex",
    name: "USP-S | Cortex",
    collection: "The Clutch Collection",
    rarity: "Restricted",
    wearLabel: "Minimal Wear",
    minFloat: 0.06,
    maxFloat: 0.8,
    absoluteWear: 0.08421
  });
  const presetAuxMaterialA = createSimulationItem({
    key: "AWP | Atheris",
    name: "AWP | Atheris",
    collection: "The Prisma Collection",
    rarity: "Restricted",
    wearLabel: "Field-Tested",
    minFloat: 0,
    maxFloat: 1,
    absoluteWear: 0.149875
  });
  const presetOutputRowsA = [
    {
      collection: "The Prisma 2 Collection",
      rarity: "Classified",
      outputs: [
        clone(presetPrimaryA),
        createSimulationItem({
          key: "MAC-10 | Disco Tech",
          name: "MAC-10 | Disco Tech",
          collection: "The Prisma 2 Collection",
          rarity: "Classified",
          wearLabel: "Minimal Wear",
          minFloat: 0,
          maxFloat: 1,
          absoluteWear: 0.093124
        })
      ]
    },
    {
      collection: "The Recoil Collection",
      rarity: "Classified",
      outputs: [clone(presetAuxA)]
    }
  ];
  const presetMaterialRowsA = [
    {
      collection: "The Clutch Collection",
      rarity: "Restricted",
      materials: [
        clone(presetMainMaterialA),
        createSimulationItem({
          key: "MP7 | Bloodsport",
          name: "MP7 | Bloodsport",
          collection: "The Clutch Collection",
          rarity: "Restricted",
          wearLabel: "Field-Tested",
          minFloat: 0,
          maxFloat: 0.8,
          absoluteWear: 0.183441
        })
      ]
    },
    {
      collection: "The Prisma Collection",
      rarity: "Restricted",
      materials: [clone(presetAuxMaterialA)]
    }
  ];

  const presetPrimaryB = createSimulationItem({
    key: "P90 | Shallow Grave",
    name: "P90 | Shallow Grave",
    collection: "The Gamma 2 Collection",
    rarity: "Classified",
    wearLabel: "Field-Tested",
    minFloat: 0,
    maxFloat: 0.8,
    absoluteWear: 0.214381
  });
  const presetAuxB = createSimulationItem({
    key: "M4A4 | Buzz Kill",
    name: "M4A4 | Buzz Kill",
    collection: "The Spectrum Collection",
    rarity: "Classified",
    wearLabel: "Minimal Wear",
    minFloat: 0,
    maxFloat: 1,
    absoluteWear: 0.132556
  });
  const presetMainMaterialB = createSimulationItem({
    key: "SG 553 | Phantom",
    name: "SG 553 | Phantom",
    collection: "The Spectrum Collection",
    rarity: "Restricted",
    wearLabel: "Minimal Wear",
    minFloat: 0,
    maxFloat: 0.8,
    absoluteWear: 0.079881
  });
  const presetAuxMaterialB = createSimulationItem({
    key: "P250 | See Ya Later",
    name: "P250 | See Ya Later",
    collection: "The Gamma 2 Collection",
    rarity: "Restricted",
    wearLabel: "Field-Tested",
    minFloat: 0,
    maxFloat: 1,
    absoluteWear: 0.196472
  });
  const presetOutputRowsB = [
    {
      collection: "The Gamma 2 Collection",
      rarity: "Classified",
      outputs: [clone(presetPrimaryB)]
    },
    {
      collection: "The Spectrum Collection",
      rarity: "Classified",
      outputs: [clone(presetAuxB)]
    }
  ];
  const presetMaterialRowsB = [
    {
      collection: "The Spectrum Collection",
      rarity: "Restricted",
      materials: [clone(presetMainMaterialB)]
    },
    {
      collection: "The Gamma 2 Collection",
      rarity: "Restricted",
      materials: [clone(presetAuxMaterialB)]
    }
  ];

  const savedPresetA = createSimulationPreset({
    id: "guest_sim_saved_a",
    name: "示例配方 A",
    primaryOutput: presetPrimaryA,
    auxOutput: presetAuxA,
    mainMaterial: presetMainMaterialA,
    auxMaterial: presetAuxMaterialA,
    outputRows: presetOutputRowsA,
    materialRows: presetMaterialRowsA,
    anchorWear: 0.126543
  });
  const savedPresetB = createSimulationPreset({
    id: "guest_sim_saved_b",
    name: "示例配方 B",
    primaryOutput: presetPrimaryB,
    auxOutput: presetAuxB,
    mainMaterial: presetMainMaterialB,
    auxMaterial: presetAuxMaterialB,
    outputRows: presetOutputRowsB,
    materialRows: presetMaterialRowsB,
    anchorWear: 0.214381
  });
  const workspacePreset = createSimulationPreset({
    id: "guest_sim_workspace",
    name: "当前示例工作台",
    primaryOutput: presetPrimaryA,
    auxOutput: presetAuxA,
    mainMaterial: presetMainMaterialA,
    auxMaterial: presetAuxMaterialA,
    outputRows: presetOutputRowsA,
    materialRows: presetMaterialRowsA,
    anchorWear: 0.126543
  });

  const guestSimulationPreview = {
    summary: "访客态复用正式汰换布局，显示的配方、产物与材料均为虚构样例。",
    savedPresets: [savedPresetA, savedPresetB],
    workspacePreset
  };

  function createGuestPreviewProvider() {
    return {
      getGuestAccountCards() {
        return clone(guestAccountCards);
      },
      getGuestInventoryPreview() {
        return clone(guestInventoryPreview);
      },
      getGuestCraftPreview() {
        return clone(guestCraftPreview);
      },
      getGuestSimulationPreview() {
        return clone(guestSimulationPreview);
      }
    };
  }

  globalScope.createGuestPreviewProvider = createGuestPreviewProvider;
  if (!globalScope.guestPreviewProvider) {
    globalScope.guestPreviewProvider = createGuestPreviewProvider();
  }
})(typeof window !== "undefined" ? window : globalThis);
