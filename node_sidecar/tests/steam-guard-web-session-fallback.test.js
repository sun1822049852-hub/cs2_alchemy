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
    TokenStore: overrides.TokenStore,
    logger: overrides.logger || {
      warn() {}
    }
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

async function test_malformed_mafile_json_falls_back_to_token_store_refresh_token() {
  const calls = [];
  const warnings = [];
  const resolveWebSessionForAccount = loadResolveWebSessionForAccount({
    parseMaFile() {
      throw new Error("maFile JSON 解析失败: Unexpected token s in JSON at position 1");
    },
    async refreshWebCookie() {
      calls.push({refreshMaFile: true});
      throw new Error("should_not_refresh_mafile");
    },
    async refreshWebCookieFromToken(refreshToken, steamId64) {
      calls.push({refreshToken, steamId64});
      return {
        cookieString: "sessionid=token",
        steamId64
      };
    },
    TokenStore: class FakeTokenStore {
      get(username) {
        calls.push({tokenLookup: username});
        return "refresh_from_store";
      }
    },
    logger: {
      warn(scope, text) {
        warnings.push({scope, text});
      }
    }
  });

  const result = await resolveWebSessionForAccount({
    username: "demo",
    steam_id64: "76561198000000002",
    mafile_content: "{secret_raw_content"
  });

  assert.equal(result.hasMaFile, false);
  assert.equal(result.maData, null);
  assert.equal(result.webSession.steamId64, "76561198000000002");
  assert.deepEqual(calls, [
    {tokenLookup: "demo"},
    {refreshToken: "refresh_from_store", steamId64: "76561198000000002"}
  ]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].scope, "web_session");
  assert.match(warnings[0].text, /mafile parse skipped/);
  assert.doesNotMatch(warnings[0].text, /secret_raw_content/);
  assert.doesNotMatch(warnings[0].text, /refresh_from_store/);
}

async function test_mafile_missing_shared_secret_falls_back_to_token_store_refresh_token() {
  const calls = [];
  const resolveWebSessionForAccount = loadResolveWebSessionForAccount({
    parseMaFile() {
      throw new Error("maFile 缺少 shared_secret");
    },
    async refreshWebCookie() {
      calls.push({refreshMaFile: true});
      throw new Error("should_not_refresh_mafile");
    },
    async refreshWebCookieFromToken(refreshToken, steamId64) {
      calls.push({refreshToken, steamId64});
      return {
        cookieString: "sessionid=token",
        steamId64
      };
    },
    TokenStore: class FakeTokenStore {
      get(username) {
        calls.push({tokenLookup: username});
        return "refresh_2";
      }
    }
  });

  const result = await resolveWebSessionForAccount({
    username: "demo",
    steam_id64: "76561198000000003",
    mafile_content: JSON.stringify({
      identity_secret: "xyz",
      Session: {
        SteamID: "76561198000000003"
      }
    })
  });

  assert.equal(result.hasMaFile, false);
  assert.equal(result.webSession.steamId64, "76561198000000003");
  assert.deepEqual(calls, [
    {tokenLookup: "demo"},
    {refreshToken: "refresh_2", steamId64: "76561198000000003"}
  ]);
}

async function main() {
  await test_malformed_mafile_json_falls_back_to_token_store_refresh_token();
  await test_mafile_missing_shared_secret_falls_back_to_token_store_refresh_token();
  await test_incomplete_mafile_falls_back_to_token_store_refresh_token();
  console.log("steam-guard-web-session-fallback tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
