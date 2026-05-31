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

function createHeaders(contentType) {
  return {
    get(name) {
      return String(name || "").toLowerCase() === "content-type" ? contentType : "";
    }
  };
}

function createJsonResponse({status, data, contentType = "application/json"}) {
  let readerTouched = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeaders(contentType),
    body: {
      getReader() {
        readerTouched = true;
        throw new Error("stream reader should not be opened before auth/content-type checks");
      }
    },
    async json() {
      return data;
    },
    async text() {
      return JSON.stringify(data);
    },
    get readerTouched() {
      return readerTouched;
    }
  };
}

function createStreamResponse({status = 200, contentType = "text/event-stream; charset=utf-8"} = {}) {
  let readerTouched = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: createHeaders(contentType),
    body: {
      getReader() {
        readerTouched = true;
        return {
          async read() {
            return {done: true, value: undefined};
          }
        };
      }
    },
    async json() {
      throw new Error("stream success should not parse JSON");
    },
    async text() {
      throw new Error("stream success should not parse text");
    },
    get readerTouched() {
      return readerTouched;
    }
  };
}

function loadRawFetchHelpers({fetchImpl, onAuthFailure} = {}) {
  const source = extractBlock("const CLIENT_PERMISSION_LABELS = {", "async function api(");
  const context = {
    fetch: fetchImpl,
    window: {
      __cs2AlchemyHandleApiLicenseFailure: onAuthFailure
    },
    console,
    state: {
      clientLicense: {
        authenticated: true,
        code: "",
        permissions: []
      }
    }
  };
  vm.runInNewContext(
    `${source}\nthis.fetchAuthAwareRaw = fetchAuthAwareRaw;`,
    context,
    {filename: APP_PATH}
  );
  return context;
}

async function test_stream_like_401_json_triggers_auth_recovery_without_opening_reader() {
  let authFailureCount = 0;
  const response = createJsonResponse({
    status: 401,
    data: {
      ok: false,
      reason: "license_expired",
      message: "登录已失效，请重新登录"
    }
  });
  const context = loadRawFetchHelpers({
    fetchImpl: async () => response,
    onAuthFailure(err) {
      authFailureCount += 1;
      assert.equal(err.status, 401);
      assert.equal(err.data.reason, "license_expired");
    }
  });

  await assert.rejects(
    () => context.fetchAuthAwareRaw("/api/market/batch-sell", {}, {
      operation: "批量上架",
      expectedContentTypes: ["text/event-stream"]
    }),
    (err) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /登录已失效/);
      return true;
    }
  );
  assert.equal(authFailureCount, 1);
  assert.equal(response.readerTouched, false);
}

async function test_stream_like_403_json_surfaces_permission_denial_without_auth_recovery() {
  let authFailureCount = 0;
  const response = createJsonResponse({
    status: 403,
    data: {
      ok: false,
      reason: "permission_denied",
      message: "当前登录用户无权执行该操作"
    }
  });
  const context = loadRawFetchHelpers({
    fetchImpl: async () => response,
    onAuthFailure() {
      authFailureCount += 1;
    }
  });

  await assert.rejects(
    () => context.fetchAuthAwareRaw("/api/accounts/send-trade-offer", {}, {
      operation: "发送交易报价",
      expectedContentTypes: ["text/event-stream"]
    }),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.data.reason, "permission_denied");
      assert.match(err.message, /无权/);
      return true;
    }
  );
  assert.equal(authFailureCount, 0);
  assert.equal(response.readerTouched, false);
}

async function test_stream_like_success_rejects_json_content_type_before_reader() {
  const response = createJsonResponse({
    status: 200,
    data: {ok: true, message: "not a stream"}
  });
  const context = loadRawFetchHelpers({
    fetchImpl: async () => response
  });

  await assert.rejects(
    () => context.fetchAuthAwareRaw("/api/market/batch-sell", {}, {
      operation: "批量上架",
      expectedContentTypes: ["text/event-stream"]
    }),
    /返回格式不正确/
  );
  assert.equal(response.readerTouched, false);
}

async function test_stream_like_success_keeps_reader_available_for_sse_path() {
  const response = createStreamResponse();
  const context = loadRawFetchHelpers({
    fetchImpl: async () => response
  });

  const returned = await context.fetchAuthAwareRaw("/api/market/batch-sell", {}, {
    operation: "批量上架",
    expectedContentTypes: ["text/event-stream"]
  });
  assert.equal(returned, response);
  assert.equal(response.readerTouched, false);

  await returned.body.getReader().read();
  assert.equal(response.readerTouched, true);
}

function assertAppUsesAuthAwareFetchForTargetCallSites() {
  const requiredSnippets = [
    'fetchAuthAwareRaw("/api/market/batch-sell"',
    'fetchAuthAwareRaw("/api/accounts/send-trade-offer"',
    'api("/api/market/confirmations"',
    'api("/api/market/confirm-listings"',
    'fetchAuthAwareRaw("/api/accounts/check-bans"',
    'fetchAuthAwareRaw("/api/accounts/refresh-trade-url"'
  ];
  for (const snippet of requiredSnippets) {
    assert.ok(APP_SOURCE.includes(snippet), `missing auth-aware target call site: ${snippet}`);
  }
}

async function main() {
  await test_stream_like_401_json_triggers_auth_recovery_without_opening_reader();
  await test_stream_like_403_json_surfaces_permission_denial_without_auth_recovery();
  await test_stream_like_success_rejects_json_content_type_before_reader();
  await test_stream_like_success_keeps_reader_available_for_sse_path();
  assertAppUsesAuthAwareFetchForTargetCallSites();
  console.log("raw-fetch-auth-handling tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
