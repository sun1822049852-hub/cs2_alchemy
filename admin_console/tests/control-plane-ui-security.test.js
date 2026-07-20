const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");
const INDEX_SOURCE = fs.readFileSync(path.resolve(__dirname, "../ui/index.html"), "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

async function test_api_uses_cookie_session_and_csrf_for_mutations() {
  assert.equal(APP_SOURCE.includes("localStorage"), false, "管理员凭据不得存入 localStorage");
  assert.equal(APP_SOURCE.includes("Authorization"), false, "管理员 UI 不应继续发送 Bearer token");

  const requests = [];
  const context = {
    state: {csrfToken: "csrf-test"},
    fetch: async (url, options) => {
      requests.push({url, options});
      return {
        ok: true,
        headers: {get: () => "application/json"},
        json: async () => ({ok: true})
      };
    },
    Error,
    JSON,
    Object,
    String
  };
  vm.runInNewContext([
    extractBlock("function isMutationMethod(", "function getHeaders("),
    extractBlock("function getHeaders(", "async function api("),
    extractBlock("async function api(", "function selectedUser(")
  ].join("\n"), context, {filename: APP_PATH});

  await context.api("/api/admin/orders", {method: "GET"});
  await context.api("/api/admin/products", {method: "POST", body: "{}"});

  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.headers["X-CSRF-Token"], undefined);
  assert.equal(requests[1].options.credentials, "same-origin");
  assert.equal(requests[1].options.headers["X-CSRF-Token"], "csrf-test");
}

function test_dynamic_data_is_rendered_through_text_nodes() {
  assert.equal(APP_SOURCE.includes(".innerHTML ="), false, "动态后台数据不得通过 innerHTML 渲染");
  assert.equal(APP_SOURCE.includes("textContent"), true);
  assert.equal(APP_SOURCE.includes("createTextNode"), true);
}

function test_existing_admin_login_does_not_apply_new_password_constraints() {
  const loginPassword = INDEX_SOURCE.match(/<input id="loginPassword"[^>]*>/)?.[0] || "";
  const bootstrapPassword = INDEX_SOURCE.match(/<input id="bootstrapPassword"[^>]*>/)?.[0] || "";
  assert.ok(loginPassword, "missing login password input");
  assert.doesNotMatch(loginPassword, /\bminlength=/i);
  assert.doesNotMatch(loginPassword, /\bmaxlength=/i);
  assert.match(bootstrapPassword, /\bminlength="12"/i);
  assert.match(bootstrapPassword, /\bmaxlength="128"/i);
}

async function main() {
  await test_api_uses_cookie_session_and_csrf_for_mutations();
  test_dynamic_data_is_rendered_through_text_nodes();
  test_existing_admin_login_does_not_apply_new_password_constraints();
  console.log("control-plane-ui-security tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
