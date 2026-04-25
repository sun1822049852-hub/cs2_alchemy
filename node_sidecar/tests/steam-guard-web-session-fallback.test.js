const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {asString} = require("../src/utils");

const UI_SERVER_PATH = path.resolve(__dirname, "../src/uiServer.js");
const UI_SERVER_SOURCE = fs.readFileSync(UI_SERVER_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = UI_SERVER_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = UI_SERVER_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return UI_SERVER_SOURCE.slice(start, end);
}

function loadResolveWebSessionForAccount(overrides = {}) {
  const source = extractBlock(
    "async function resolveWebSessionForAccount(account) {",
    "function getLicenseRuntime("
  );
  const context = {
    asString,
    parseMaFile: overrides.parseMaFile,
    refreshWebCookie: overrides.refreshWebCookie,
    refreshWebCookieFromToken: overrides.refreshWebCookieFromToken,
    TokenStore: overrides.TokenStore
  };
  vm.runInNewContext(`${source}\nthis.resolveWebSessionForAccount = resolveWebSessionForAccount;`, context, {
    filename: UI_SERVER_PATH
  });
  return context.resolveWebSessionForAccount;
}

async function test_incomplete_mafile_falls_back_to_token_store_refresh_token() {
  const calls = [];
  const resolveWebSessionForAccount = loadResolveWebSessionForAccount({
    parseMaFile() {
      return {
        sharedSecret: "abc",
        steamId64: "",
        raw: {
          Session: {}
        }
      };
    },
    async refreshWebCookie() {
      throw new Error("broken_mafile");
    },
    async refreshWebCookieFromToken(refreshToken, steamId64) {
      calls.push({refreshToken, steamId64});
      return {
        cookieString: "sessionid=test",
        steamId64
      };
    },
    TokenStore: class FakeTokenStore {
      get(username) {
        calls.push({tokenLookup: username});
        return "refresh_1";
      }
    }
  });

  const result = await resolveWebSessionForAccount({
    username: "demo",
    steam_id64: "76561198000000001",
    mafile_content: JSON.stringify({
      shared_secret: "abc",
      identity_secret: "xyz",
      Session: {}
    })
  });

  assert.equal(result.hasMaFile, true);
  assert.equal(result.webSession.steamId64, "76561198000000001");
  assert.deepEqual(calls, [
    {tokenLookup: "demo"},
    {refreshToken: "refresh_1", steamId64: "76561198000000001"}
  ]);
}

async function main() {
  await test_incomplete_mafile_falls_back_to_token_store_refresh_token();
  console.log("steam-guard-web-session-fallback tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
