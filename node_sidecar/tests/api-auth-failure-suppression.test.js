const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadApiFn({fetchImpl, onAuthFailure} = {}) {
  const source = extractBlock("async function api(", "async function requestLicenseJson(");
  const context = {
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    AbortController,
    Error,
    window: {
      __cs2AlchemyHandleApiLicenseFailure: onAuthFailure
    }
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

async function test_api_triggers_global_auth_failure_by_default() {
  let failureCount = 0;
  const context = loadApiFn({
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async json() {
        return {
          ok: false,
          reason: "license_required",
          message: "请先导入有效的客户端授权"
        };
      }
    }),
    onAuthFailure() {
      failureCount += 1;
    }
  });

  await assert.rejects(() => context.api("/api/test"));
  assert.equal(failureCount, 1);
}

async function test_api_can_suppress_global_auth_failure_for_background_requests() {
  let failureCount = 0;
  const context = loadApiFn({
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async json() {
        return {
          ok: false,
          reason: "license_required",
          message: "请先导入有效的客户端授权"
        };
      }
    }),
    onAuthFailure() {
      failureCount += 1;
    }
  });

  await assert.rejects(() => context.api("/api/test", {suppressAuthFailure: true}));
  assert.equal(failureCount, 0);
}

async function main() {
  await test_api_triggers_global_auth_failure_by_default();
  await test_api_can_suppress_global_auth_failure_for_background_requests();
  console.log("api-auth-failure-suppression tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
