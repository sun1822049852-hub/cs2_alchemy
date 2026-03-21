const assert = require("node:assert/strict");

const {createBuffSkinDetailProvider} = require("../node_sidecar/src/services/buffSkinDetailProvider");

function makeResponse({status = 200, body = {}, headers = {}} = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name).toLowerCase()) || null;
      }
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    async json() {
      return typeof body === "string" ? JSON.parse(body) : body;
    }
  };
}

function formatChoiceValue(value) {
  return Number(value).toFixed(2);
}

function makeGoodsPageHtml({
  title = "Test Skin",
  relativeGoodsIds = [],
  filterChoices = [],
  templateChoices = []
} = {}) {
  const templateChoiceText = JSON.stringify(
    templateChoices.map(([min, max]) => [formatChoiceValue(min), formatChoiceValue(max)])
  );
  const filterChoiceText = JSON.stringify(
    filterChoices.map(([min, max]) => [formatChoiceValue(min), formatChoiceValue(max)])
  );
  const relativeGoodsText = relativeGoodsIds
    .map((goodsId) => `relative_goods_ids.push("${goodsId}")`)
    .join(";\n");
  return `
    <html>
      <head>
        <title>${title}</title>
      </head>
      <body>
        <script type="text/html" id="paintwear-template">
          <% if (paintwear_choices && paintwear_choices.length > 0) { %>
          paintwear_choices: ${templateChoiceText}
          <% } %>
        </script>
        <script>
          var filter_data_selling = {
            asset_tags: [],
            paintwear_choices: ${filterChoiceText},
            fade_choices: []
          };
          var relative_goods_ids = [];
          ${relativeGoodsText};
        </script>
      </body>
    </html>
  `;
}

function makePaintwearRankPayload(values = []) {
  return {
    code: "OK",
    data: {
      ranks: values.map((paintwear) => ({paintwear: String(paintwear)}))
    }
  };
}

function createCapturingLogger() {
  const entries = [];
  return {
    entries,
    warn(scope, message) {
      entries.push({level: "warn", scope, message});
    },
    info(scope, message) {
      entries.push({level: "info", scope, message});
    }
  };
}

async function test_provider_success() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("csgo_goods_containers")) {
      return makeResponse({
        body: {
          code: "OK",
          data: {
            container_type: "weaponcase",
            containers: [
              {container: "armory", name: "军械库"},
              {container: "gallery_case", name: "Gallery Case"}
            ]
          }
        }
      });
    }
    return makeResponse({
      body: {
        code: "OK",
        data: {
          items: [
            {
              goods_id: "123",
              goods: {
                name: "Test Skin",
                tags: {
                  rarity: {
                    localized_name: "金"
                  }
                }
              }
            }
          ]
        }
      }
    });
  };
  const provider = createBuffSkinDetailProvider({fetchImpl, timeoutMs: 50});
  const result = await provider.fetchByGoodsId("123");
  assert.deepEqual(result, {
    collection: "Gallery Case",
    rarity: "金",
    detail_source: "buff"
  });
  assert.equal(calls.length, 2);
}

async function test_provider_fetches_goods_image_from_goods_page_first() {
  const calls = [];
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/goods/42998")) {
        return makeResponse({
          body: `
            <html>
              <head>
                <meta property="og:image" content="https://img.example/default.webp">
              </head>
              <body>
                <div class="detail-pic">
                  <div class="t_Center">
                    <img src="https://img.example/page-item.webp" style="max-width:269px;">
                  </div>
                </div>
              </body>
            </html>
          `
        });
      }
      return makeResponse({
        body: {
          code: "OK",
          data: {
            goods_info: {
              icon_url: "https://img.example/icon.webp",
              original_icon_url: "https://img.example/original.webp"
            },
            share_data: {
              thumbnail: "https://img.example/share.webp"
            }
          }
        }
      });
    },
    timeoutMs: 50
  });

  const result = await provider.fetchGoodsImageByGoodsId("42998");
  assert.deepEqual(result, {
    goods_icon_url: "https://img.example/page-item.webp",
    goods_original_icon_url: "https://img.example/page-item.webp",
    goods_share_thumbnail_url: "https://img.example/page-item.webp"
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes("/goods/42998"), true);
}

async function test_provider_rejects_when_goods_page_has_no_image_and_never_calls_goods_info() {
  const calls = [];
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/goods/42998")) {
        return makeResponse({
          body: "<html><head><title>no image</title></head></html>"
        });
      }
      throw new Error("must not call goods info");
    },
    timeoutMs: 50
  });

  await assert.rejects(
    () => provider.fetchGoodsImageByGoodsId("42998"),
    /goods page image missing/i
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes("/goods/42998"), true);
}

async function test_provider_does_not_fallback_to_goods_info_when_goods_page_is_rate_limited() {
  const calls = [];
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/goods/42998")) {
        return makeResponse({
          status: 429,
          headers: {
            "retry-after": "0"
          },
          body: {code: "Too Many Requests"}
        });
      }
      return makeResponse({
        body: {
          code: "OK",
          data: {
            goods_info: {
              icon_url: "https://img.example/icon.webp",
              original_icon_url: "https://img.example/original.webp"
            },
            share_data: {
              thumbnail: "https://img.example/share.webp"
            }
          }
        }
      });
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  await assert.rejects(
    () => provider.fetchGoodsImageByGoodsId("42998"),
    /http=429/i
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes("/goods/42998"), true);
}

async function test_provider_falls_back_to_paintwear_rank_when_goods_page_range_unavailable() {
  const calls = [];
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/goods/42998")) {
        return makeResponse({
          body: "<html><head><title>Test</title></head><body>no filter data</body></html>"
        });
      }
      if (!String(url).includes("/api/market/paintwear_rank")) {
        throw new Error(`unexpected url: ${url}`);
      }
      if (String(url).includes("order_type=1")) {
        return makeResponse({
          body: {
            code: "OK",
            data: {
              ranks: [
                {paintwear: "0.7999999523162842"}
              ]
            }
          }
        });
      }
      return makeResponse({
        body: {
          code: "OK",
          data: {
            ranks: [
              {paintwear: "0.06000000238418579"}
            ]
          }
        }
      });
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  const result = await provider.fetchWearRangeByGoodsId("42998");
  assert.deepEqual(result, {
    minfloat: 0.06,
    maxfloat: 0.8,
    wear_range: 0.74
  });
  assert.equal(calls.some((url) => url.includes("/goods/42998")), true);
  assert.equal(calls.filter((url) => url.includes("/api/market/paintwear_rank")).length, 2);
}

async function test_provider_reads_wear_range_from_filter_data_selling_html() {
  const calls = [];
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (!String(url).includes("/goods/1001")) {
        throw new Error(`unexpected url: ${url}`);
      }
      return makeResponse({
        body: makeGoodsPageHtml({
          title: "AWP | Test (Field-Tested)_CS2饰品交易_网易BUFF",
          filterChoices: [[0, 1]],
          templateChoices: [[0.9, 0.91]]
        })
      });
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  const result = await provider.fetchWearRangeByGoodsId("1001");
  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  assert.equal(calls.filter((url) => url.includes("/goods/1001")).length, 1);
  assert.equal(calls.some((url) => url.includes("/api/market/paintwear_rank")), false);
}

async function test_provider_filters_stattrak_mirror_before_aggregating_html_range() {
  const calls = [];
  const relativeGoodsIds = ["1001", "1002", "1003", "1004", "1005", "1006"];
  const pages = {
    "1001": makeGoodsPageHtml({
      title: "AWP | Test (Factory New)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0, 0.07]],
      templateChoices: [[0.99, 1]]
    }),
    "1002": makeGoodsPageHtml({
      title: "AWP | Test (Minimal Wear)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0.07, 0.15]]
    }),
    "1003": makeGoodsPageHtml({
      title: "AWP | Test (Field-Tested)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0.15, 0.38]]
    }),
    "1004": makeGoodsPageHtml({
      title: "AWP | Test (Well-Worn)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0.38, 0.45]]
    }),
    "1005": makeGoodsPageHtml({
      title: "AWP | Test (Battle-Scarred)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0.45, 1]]
    }),
    "1006": makeGoodsPageHtml({
      title: "AWP（StatTrak™） | Test (Field-Tested)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0.15, 0.38]]
    })
  };
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/api/market/paintwear_rank")) {
        throw new Error(`unexpected url: ${url}`);
      }
      const match = String(url).match(/\/goods\/(\d+)/);
      if (!match || !pages[match[1]]) {
        throw new Error(`unexpected url: ${url}`);
      }
      return makeResponse({body: pages[match[1]]});
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  const result = await provider.fetchWearRangeByGoodsId("1003");
  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  assert.equal(calls.filter((url) => /\/goods\/\d+/.test(url)).length, 6);
  assert.equal(calls.some((url) => url.includes("/goods/1006")), true);
}

async function test_provider_does_not_expand_candidate_set_from_member_pages() {
  const calls = [];
  const seedRelativeGoodsIds = ["2001", "2002", "2003", "2004", "2005", "2006"];
  function makeMemberPage(goodsId, title, range, extraIds = []) {
    return makeGoodsPageHtml({
      title,
      relativeGoodsIds: [...seedRelativeGoodsIds, ...extraIds],
      filterChoices: [range]
    });
  }
  const pages = {
    "2001": makeMemberPage("2001", "AK-47 | Test (Factory New)_CS2饰品交易_网易BUFF", [0, 0.07]),
    "2002": makeMemberPage("2002", "AK-47 | Test (Minimal Wear)_CS2饰品交易_网易BUFF", [0.07, 0.15], ["2007"]),
    "2003": makeMemberPage("2003", "AK-47 | Test (Field-Tested)_CS2饰品交易_网易BUFF", [0.15, 0.38], ["2007"]),
    "2004": makeMemberPage("2004", "AK-47 | Test (Well-Worn)_CS2饰品交易_网易BUFF", [0.38, 0.45], ["2007"]),
    "2005": makeMemberPage("2005", "AK-47 | Test (Battle-Scarred)_CS2饰品交易_网易BUFF", [0.45, 1], ["2007"]),
    "2006": makeMemberPage("2006", "AK-47（StatTrak™） | Test (Field-Tested)_CS2饰品交易_网易BUFF", [0.15, 0.38], ["2007"])
  };
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/api/market/paintwear_rank")) {
        throw new Error(`unexpected url: ${url}`);
      }
      if (String(url).includes("/goods/2007")) {
        throw new Error("should not fetch expanded candidate");
      }
      const match = String(url).match(/\/goods\/(\d+)/);
      if (!match || !pages[match[1]]) {
        throw new Error(`unexpected url: ${url}`);
      }
      return makeResponse({body: pages[match[1]]});
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  const result = await provider.fetchWearRangeByGoodsId("2003");
  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  assert.equal(calls.some((url) => url.includes("/goods/2007")), false);
}

async function test_provider_bypasses_rank_when_main_html_range_is_full() {
  const calls = [];
  const logger = createCapturingLogger();
  const provider = createBuffSkinDetailProvider({
    logger,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (!String(url).includes("/goods/3001")) {
        throw new Error(`unexpected url: ${url}`);
      }
      return makeResponse({
        body: makeGoodsPageHtml({
          title: "AWP | Full Range (Field-Tested)_CS2饰品交易_网易BUFF",
          filterChoices: [[0, 1]]
        })
      });
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  const result = await provider.fetchWearRangeByGoodsId("3001", {familyKey: "awp_full_range"});
  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  assert.equal(calls.some((url) => url.includes("/api/market/paintwear_rank")), false);
  assert.equal(
    logger.entries.some((entry) => entry.level === "warn" && entry.message.includes("warn=rank_bypass_full_range")),
    true
  );
}

async function test_provider_returns_main_range_and_warns_when_rank_incomplete() {
  const logger = createCapturingLogger();
  const relativeGoodsIds = ["3101", "3102"];
  const pages = {
    "3101": makeGoodsPageHtml({
      title: "★ Bayonet | Doppler (Factory New)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0, 0.07]]
    }),
    "3102": makeGoodsPageHtml({
      title: "★ Bayonet | Doppler (Minimal Wear)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0.07, 0.08]]
    })
  };
  const provider = createBuffSkinDetailProvider({
    logger,
    fetchImpl: async (url) => {
      if (String(url).includes("/goods/")) {
        const match = String(url).match(/\/goods\/(\d+)/);
        if (!match || !pages[match[1]]) {
          throw new Error(`unexpected url: ${url}`);
        }
        return makeResponse({body: pages[match[1]]});
      }
      const parsed = new URL(String(url));
      const goodsId = parsed.searchParams.get("goods_id");
      const isMax = parsed.searchParams.get("order_type") === "1";
      if (goodsId === "3101" && !isMax) return makeResponse({body: makePaintwearRankPayload([0.0])});
      if (goodsId === "3101" && isMax) return makeResponse({body: makePaintwearRankPayload([0.08])});
      if (goodsId === "3102" && !isMax) return makeResponse({body: makePaintwearRankPayload([0.0])});
      if (goodsId === "3102" && isMax) return makeResponse({body: makePaintwearRankPayload([])});
      throw new Error(`unexpected url: ${url}`);
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  const result = await provider.fetchWearRangeByGoodsId("3101", {familyKey: "bayonet_doppler"});
  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 0.08,
    wear_range: 0.08
  });
  assert.equal(
    logger.entries.some((entry) => entry.level === "warn" && entry.message.includes("warn=rank_incomplete")),
    true
  );
}

async function test_provider_expands_main_range_when_complete_rank_is_wider() {
  const logger = createCapturingLogger();
  const relativeGoodsIds = ["3201", "3202"];
  const pages = {
    "3201": makeGoodsPageHtml({
      title: "★ Bayonet | Fade (Factory New)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0, 0.07]]
    }),
    "3202": makeGoodsPageHtml({
      title: "★ Bayonet | Fade (Minimal Wear)_CS2饰品交易_网易BUFF",
      relativeGoodsIds,
      filterChoices: [[0.07, 0.08]]
    })
  };
  const provider = createBuffSkinDetailProvider({
    logger,
    fetchImpl: async (url) => {
      if (String(url).includes("/goods/")) {
        const match = String(url).match(/\/goods\/(\d+)/);
        if (!match || !pages[match[1]]) {
          throw new Error(`unexpected url: ${url}`);
        }
        return makeResponse({body: pages[match[1]]});
      }
      const parsed = new URL(String(url));
      const isMax = parsed.searchParams.get("order_type") === "1";
      return makeResponse({
        body: makePaintwearRankPayload([isMax ? 0.1 : 0.0])
      });
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  const result = await provider.fetchWearRangeByGoodsId("3201", {familyKey: "bayonet_fade"});
  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 0.1,
    wear_range: 0.1
  });
  assert.equal(
    logger.entries.some((entry) => entry.level === "warn" && entry.message.includes("warn=range_expanded") && entry.message.includes("side=max")),
    true
  );
}

async function test_provider_warns_when_member_page_family_ids_mismatch() {
  const logger = createCapturingLogger();
  const seedRelativeGoodsIds = ["3301", "3302", "3303", "3304", "3305", "3306"];
  const pages = {
    "3301": makeGoodsPageHtml({
      title: "AK-47 | Test (Factory New)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: seedRelativeGoodsIds,
      filterChoices: [[0, 0.07]]
    }),
    "3302": makeGoodsPageHtml({
      title: "AK-47 | Test (Minimal Wear)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: [...seedRelativeGoodsIds, "3307"],
      filterChoices: [[0.07, 0.15]]
    }),
    "3303": makeGoodsPageHtml({
      title: "AK-47 | Test (Field-Tested)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: seedRelativeGoodsIds,
      filterChoices: [[0.15, 0.38]]
    }),
    "3304": makeGoodsPageHtml({
      title: "AK-47 | Test (Well-Worn)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: seedRelativeGoodsIds,
      filterChoices: [[0.38, 0.45]]
    }),
    "3305": makeGoodsPageHtml({
      title: "AK-47 | Test (Battle-Scarred)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: seedRelativeGoodsIds,
      filterChoices: [[0.45, 1]]
    }),
    "3306": makeGoodsPageHtml({
      title: "AK-47（StatTrak™） | Test (Field-Tested)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: seedRelativeGoodsIds,
      filterChoices: [[0.15, 0.38]]
    })
  };
  const provider = createBuffSkinDetailProvider({
    logger,
    fetchImpl: async (url) => {
      if (String(url).includes("/api/market/paintwear_rank")) {
        throw new Error(`unexpected url: ${url}`);
      }
      const match = String(url).match(/\/goods\/(\d+)/);
      if (!match || !pages[match[1]]) {
        throw new Error(`unexpected url: ${url}`);
      }
      return makeResponse({body: pages[match[1]]});
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  await provider.fetchWearRangeByGoodsId("3303", {familyKey: "ak_test"});
  assert.equal(
    logger.entries.some((entry) => entry.level === "warn" && entry.message.includes("warn=family_goods_mismatch") && entry.message.includes("page_goods_id=3302")),
    true
  );
}

async function test_provider_warns_when_same_track_family_exceeds_limit() {
  const logger = createCapturingLogger();
  const rawIds = ["3401", "3402", "3403", "3404", "3405", "3406"];
  const pages = {
    "3401": makeGoodsPageHtml({
      title: "M4A1-S | Test (Factory New)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: rawIds,
      filterChoices: [[0, 0.07]]
    }),
    "3402": makeGoodsPageHtml({
      title: "M4A1-S | Test (Minimal Wear)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: rawIds,
      filterChoices: [[0.07, 0.15]]
    }),
    "3403": makeGoodsPageHtml({
      title: "M4A1-S | Test (Field-Tested)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: rawIds,
      filterChoices: [[0.15, 0.38]]
    }),
    "3404": makeGoodsPageHtml({
      title: "M4A1-S | Test (Well-Worn)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: rawIds,
      filterChoices: [[0.38, 0.45]]
    }),
    "3405": makeGoodsPageHtml({
      title: "M4A1-S | Test (Battle-Scarred)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: rawIds,
      filterChoices: [[0.45, 1]]
    }),
    "3406": makeGoodsPageHtml({
      title: "M4A1-S | Test (Field-Tested 2)_CS2饰品交易_网易BUFF",
      relativeGoodsIds: rawIds,
      filterChoices: [[0.2, 0.3]]
    })
  };
  const provider = createBuffSkinDetailProvider({
    logger,
    fetchImpl: async (url) => {
      if (String(url).includes("/api/market/paintwear_rank")) {
        throw new Error(`unexpected url: ${url}`);
      }
      const match = String(url).match(/\/goods\/(\d+)/);
      if (!match || !pages[match[1]]) {
        throw new Error(`unexpected url: ${url}`);
      }
      return makeResponse({body: pages[match[1]]});
    },
    timeoutMs: 50,
    retryLimit: 0
  });

  const result = await provider.fetchWearRangeByGoodsId("3401", {familyKey: "m4a1s_test"});
  assert.deepEqual(result, {
    minfloat: 0,
    maxfloat: 1,
    wear_range: 1
  });
  assert.equal(
    logger.entries.some((entry) => entry.level === "warn" && entry.message.includes("warn=family_size_exceeded") && entry.message.includes("candidate_goods_ids=") && entry.message.includes("filtered_goods_ids=")),
    true
  );
}

async function test_provider_retries_once_on_retryable_failure() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return makeResponse({status: 502, body: {code: "ERR", msg: "bad gateway"}});
    }
    if (String(url).includes("csgo_goods_containers")) {
      return makeResponse({
        body: {
          code: "OK",
          data: {
            container_type: "weaponcase",
            containers: [{container: "gallery_case", name: "Gallery Case"}]
          }
        }
      });
    }
    return makeResponse({
      body: {
        code: "OK",
        data: {
          items: [
            {
              goods_id: "123",
              goods: {
                tags: {
                  rarity: {
                    localized_name: "隐秘"
                  }
                }
              }
            }
          ]
        }
      }
    });
  };
  const provider = createBuffSkinDetailProvider({fetchImpl, timeoutMs: 50});
  const result = await provider.fetchByGoodsId("123");
  assert.equal(result.collection, "Gallery Case");
  assert.equal(result.rarity, "隐秘");
  assert.equal(calls.length, 3);
}

async function test_provider_retries_on_429() {
  let phase = 0;
  const calls = [];
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async (url) => {
      calls.push(String(url));
      phase += 1;
      if (phase === 1) {
        return makeResponse({
          status: 429,
          headers: {
            "retry-after": "0"
          },
          body: {code: "Too Many Requests"}
        });
      }
      if (String(url).includes("csgo_goods_containers")) {
        return makeResponse({
          body: {
            code: "OK",
            data: {
              container_type: "weaponcase",
              containers: [{container: "gallery_case", name: "Gallery Case"}]
            }
          }
        });
      }
      return makeResponse({
        body: {
          code: "OK",
          data: {
            items: [
              {
                goods: {
                  goods_id: "888",
                  name: "AK-47 | Test",
                  tags: {
                    rarity: {
                      localized_name: "受限"
                    }
                  }
                },
                localized_name: "AK-47 | Test"
              }
            ]
          }
        }
      });
    },
    timeoutMs: 50,
    retryLimit: 2
  });

  const result = await provider.fetchByGoodsId("123", {expectedBaseName: "AK-47 | Test"});
  assert.equal(result.collection, "Gallery Case");
  assert.equal(result.rarity, "受限");
  assert.equal(calls.length, 3);
}

async function test_provider_rejects_when_containers_missing() {
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async () => makeResponse({
      body: {
        code: "OK",
        data: {containers: []}
      }
    }),
    timeoutMs: 50
  });
  await assert.rejects(() => provider.fetchByGoodsId("123"), /containers/i);
}

async function test_provider_rejects_when_target_not_found() {
  let phase = 0;
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async () => {
      phase += 1;
      if (phase === 1) {
        return makeResponse({
          body: {
            code: "OK",
            data: {
              container_type: "weaponcase",
              containers: [{container: "gallery_case", name: "Gallery Case"}]
            }
          }
        });
      }
      return makeResponse({
        body: {
          code: "OK",
          data: {
            items: []
          }
        }
      });
    },
    timeoutMs: 50
  });
  await assert.rejects(() => provider.fetchByGoodsId("123"), /not found/i);
}

async function test_provider_matches_by_expected_base_name() {
  let phase = 0;
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async () => {
      phase += 1;
      if (phase === 1) {
        return makeResponse({
          body: {
            code: "OK",
            data: {
              container_type: "weaponcase",
              containers: [{container: "chroma_2_case", name: "Chroma 2 Case"}]
            }
          }
        });
      }
      return makeResponse({
        body: {
          code: "OK",
          data: {
            items: [
              {
                localized_name: "M4A1-S | Hyper Beast",
                goods: {
                  goods_id: "35219",
                  name: "M4A1-S | Hyper Beast",
                  tags: {
                    rarity: {
                      localized_name: "Covert"
                    }
                  }
                }
              }
            ]
          }
        }
      });
    },
    timeoutMs: 50
  });

  const result = await provider.fetchByGoodsId("42998", {
    expectedBaseName: "M4A1-S | Hyper Beast"
  });
  assert.deepEqual(result, {
    collection: "Chroma 2 Case",
    rarity: "Covert",
    detail_source: "buff"
  });
}

async function test_provider_falls_back_to_goods_page_rarity_for_special_items() {
  let phase = 0;
  const provider = createBuffSkinDetailProvider({
    fetchImpl: async (url) => {
      phase += 1;
      if (phase === 1) {
        return makeResponse({
          body: {
            code: "OK",
            data: {
              container_type: "weaponcase",
              containers: [{container: "Chroma 2 Case", name: "Chroma 2 Case"}]
            }
          }
        });
      }
      if (phase === 2) {
        return makeResponse({
          body: {
            code: "OK",
            data: {
              has_unusual: true,
              items: [
                {
                  localized_name: "M4A1-S | Hyper Beast",
                  goods: {
                    goods_id: "35219",
                    name: "M4A1-S | Hyper Beast (Factory New)",
                    tags: {
                      rarity: {
                        localized_name: "Covert"
                      }
                    }
                  }
                }
              ]
            }
          }
        });
      }
      assert.equal(String(url).includes("/goods/42998"), true);
      return makeResponse({
        body: `
          <html>
            <body>
              <p><span><label>品质 |</label>隐秘</span><span><label>类别 |</label>★</span></p>
            </body>
          </html>
        `
      });
    },
    timeoutMs: 50
  });

  const result = await provider.fetchByGoodsId("42998", {
    expectedBaseName: "Karambit | Doppler"
  });
  assert.deepEqual(result, {
    collection: "Chroma 2 Case",
    rarity: "隐秘",
    detail_source: "buff_goods_page"
  });
}

async function test_provider_times_out() {
  const fetchImpl = (url, options = {}) => new Promise((resolve, reject) => {
    if (options.signal && typeof options.signal.addEventListener === "function") {
      options.signal.addEventListener("abort", () => {
        reject(new Error("aborted"));
      }, {once: true});
    }
  });
  const provider = createBuffSkinDetailProvider({fetchImpl, timeoutMs: 20});
  await assert.rejects(() => provider.fetchByGoodsId("123"), /timeout|aborted/i);
}

(async () => {
  await test_provider_success();
  await test_provider_fetches_goods_image_from_goods_page_first();
  await test_provider_rejects_when_goods_page_has_no_image_and_never_calls_goods_info();
  await test_provider_does_not_fallback_to_goods_info_when_goods_page_is_rate_limited();
  await test_provider_falls_back_to_paintwear_rank_when_goods_page_range_unavailable();
  await test_provider_reads_wear_range_from_filter_data_selling_html();
  await test_provider_filters_stattrak_mirror_before_aggregating_html_range();
  await test_provider_does_not_expand_candidate_set_from_member_pages();
  await test_provider_bypasses_rank_when_main_html_range_is_full();
  await test_provider_returns_main_range_and_warns_when_rank_incomplete();
  await test_provider_expands_main_range_when_complete_rank_is_wider();
  await test_provider_warns_when_member_page_family_ids_mismatch();
  await test_provider_warns_when_same_track_family_exceeds_limit();
  await test_provider_retries_once_on_retryable_failure();
  await test_provider_retries_on_429();
  await test_provider_rejects_when_containers_missing();
  await test_provider_rejects_when_target_not_found();
  await test_provider_matches_by_expected_base_name();
  await test_provider_falls_back_to_goods_page_rarity_for_special_items();
  await test_provider_times_out();
  console.log("buffSkinDetailProvider tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
