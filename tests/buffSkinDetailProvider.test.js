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
