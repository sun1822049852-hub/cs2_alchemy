const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const {FEATURE_CODES} = require("../../shared/licensePolicy");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "steam-session") {
    return {
      LoginSession: class FakeLoginSession {},
      EAuthSessionGuardType: {
        Unknown: 0,
        None: 1,
        EmailCode: 2,
        DeviceCode: 3,
        DeviceConfirmation: 4,
        EmailConfirmation: 5,
        MachineToken: 6,
        LegacyMachineAuth: 7
      },
      EAuthTokenPlatformType: {
        SteamClient: 0
      }
    };
  }
  if (request === "steam-user") {
    return class FakeSteamUser {};
  }
  if (request === "globaloffensive") {
    return class FakeGlobalOffensive {};
  }
  return originalLoad(request, parent, isMain);
};

const {createServer} = require("../src/uiServer");
Module._load = originalLoad;

function createReadyLicenseRuntime() {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: "user_test",
      username: "member_test",
      membership_plan: "pro"
    },
    permissions: Object.values(FEATURE_CODES),
    featureFlags: {},
    expiresAt: "2099-01-01T00:15:00.000Z",
    expiresInMs: 86400000
  };
  return {
    getState() {
      return state;
    },
    stop() {},
    importBundle() {
      return state;
    },
    clear() {
      return state;
    }
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address);
    });
    server.on("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function requestJson({port, method = "POST", path, body}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode,
          body: raw ? JSON.parse(raw) : {}
        });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function testPredictOutcomeRouteReturnsSuccessPayload() {
  const calls = [];
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    craftOutcomePredictor: {
      predict(payload) {
        calls.push(payload);
        return {
          ok: true,
          invalid_reason: "",
          outcomes: [{base_name: "AK-47 | Ice Coaled", probability: 0.3}]
        };
      }
    }
  });
  try {
    const address = await listen(server);
    const payload = {
      required_count: 10,
      target_relative_wear: 0.42,
      input_rarity: "军规级",
      stattrak: false,
      groups: [{collection: "Fracture Case", count: 3}]
    };
    const response = await requestJson({
      port: address.port,
      path: "/api/craft/predict-outcomes",
      body: payload
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.outcomes.length, 1);
    assert.deepEqual(calls, [payload]);
  } finally {
    await closeServer(server);
  }
}

async function testPredictOutcomeRouteReturnsInvalidReasonWithBadRequest() {
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    craftOutcomePredictor: {
      predict() {
        return {
          ok: false,
          invalid_reason: "collection_outcomes_missing",
          message: "配方无效",
          outcomes: []
        };
      }
    }
  });
  try {
    const address = await listen(server);
    const response = await requestJson({
      port: address.port,
      path: "/api/craft/predict-outcomes",
      body: {
        required_count: 10,
        target_relative_wear: 0.1,
        input_rarity: "军规级",
        stattrak: false,
        groups: [{collection: "Missing Case", count: 1}]
      }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.invalid_reason, "collection_outcomes_missing");
  } finally {
    await closeServer(server);
  }
}

async function testPredictOutcomeRouteAllowsMissingTargetWearForLiveEditor() {
  const calls = [];
  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime(),
    craftOutcomePredictor: {
      predict(payload) {
        calls.push(payload);
        return {
          ok: true,
          invalid_reason: "",
          target_relative_wear: null,
          outcomes: [{base_name: "AK-47 | Ice Coaled", probability: 0.3}]
        };
      }
    }
  });
  try {
    const address = await listen(server);
    const payload = {
      required_count: 10,
      input_rarity: "军规级",
      stattrak: false,
      groups: [{collection: "Fracture Case", count: 3}]
    };
    const response = await requestJson({
      port: address.port,
      path: "/api/craft/predict-outcomes",
      body: payload
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.target_relative_wear, null);
    assert.deepEqual(calls, [payload]);
  } finally {
    await closeServer(server);
  }
}

async function main() {
  await testPredictOutcomeRouteReturnsSuccessPayload();
  await testPredictOutcomeRouteReturnsInvalidReasonWithBadRequest();
  await testPredictOutcomeRouteAllowsMissingTargetWearForLiveEditor();
  console.log("craft-outcome-predictor route tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
