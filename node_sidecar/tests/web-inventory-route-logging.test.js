const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const {configureRuntimePaths} = require("../src/constants");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-web-inventory-log-"));
}

function loadUiServerWithStubs({inventoryServiceExports, maFileParserExports, steamWebSessionExports}) {
  const uiServerPath = path.resolve(__dirname, "../src/uiServer.js");
  const inventoryServicePath = path.resolve(__dirname, "../src/inventoryService.js");
  const maFileParserPath = path.resolve(__dirname, "../src/maFileParser.js");
  const steamWebSessionPath = path.resolve(__dirname, "../src/steamWebSession.js");
  const originalUiServer = require.cache[uiServerPath];
  const originalInventoryService = require.cache[inventoryServicePath];
  const originalMaFileParser = require.cache[maFileParserPath];
  const originalSteamWebSession = require.cache[steamWebSessionPath];

  delete require.cache[uiServerPath];
  require.cache[inventoryServicePath] = {
    id: inventoryServicePath,
    filename: inventoryServicePath,
    loaded: true,
    exports: inventoryServiceExports
  };
  require.cache[maFileParserPath] = {
    id: maFileParserPath,
    filename: maFileParserPath,
    loaded: true,
    exports: maFileParserExports
  };
  require.cache[steamWebSessionPath] = {
    id: steamWebSessionPath,
    filename: steamWebSessionPath,
    loaded: true,
    exports: steamWebSessionExports
  };

  return {
    module: require(uiServerPath),
    restore() {
      delete require.cache[uiServerPath];
      if (originalUiServer) {
        require.cache[uiServerPath] = originalUiServer;
      }

      if (originalInventoryService) {
        require.cache[inventoryServicePath] = originalInventoryService;
      } else {
        delete require.cache[inventoryServicePath];
      }

      if (originalMaFileParser) {
        require.cache[maFileParserPath] = originalMaFileParser;
      } else {
        delete require.cache[maFileParserPath];
      }

      if (originalSteamWebSession) {
        require.cache[steamWebSessionPath] = originalSteamWebSession;
      } else {
        delete require.cache[steamWebSessionPath];
      }
    }
  };
}

async function requestJson(baseUrl, route) {
  const url = new URL(route, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {method: "GET"}, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode || 0,
          body: raw ? JSON.parse(raw) : {}
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function test_single_inventory_route_logs_trace_lines_to_cmd() {
  const tempDir = makeTempDir();
  configureRuntimePaths({
    projectRoot: tempDir,
    userDataDir: tempDir,
    isPackaged: false
  });

  const captured = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => captured.push(args.join(" "));
  console.error = (...args) => captured.push(args.join(" "));

  const uiServerStub = loadUiServerWithStubs({
    inventoryServiceExports: {
      async fetchFullInventory({onTrace, onPage}) {
        if (typeof onTrace === "function") {
          onTrace({
            phase: "request",
            pageIndex: 0,
            url: "https://steamcommunity.com/inventory/76561198000000000/730/2?l=schinese&count=200",
            startAssetId: "",
            cookieSummary: "sessionid=abcdef12...; steamLoginSecure=yes; length=88"
          });
          onTrace({
            phase: "response",
            pageIndex: 0,
            statusCode: 200,
            assetCount: 1,
            descriptionCount: 1,
            moreItems: 0,
            lastAssetId: "",
            bodySnippet: "{\"assets\":[{\"assetid\":\"asset_1\"}]}"
          });
        }
        if (typeof onPage === "function") {
          onPage(0, [{assetid: "asset_1"}], 1);
        }
        return [{assetid: "asset_1"}];
      }
    },
    maFileParserExports: {
      parseMaFile() {
        return {
          steamId64: "76561198000000000",
          refreshToken: "refresh_token",
          accessToken: "access_token",
          sharedSecret: "shared_secret",
          identitySecret: "identity_secret",
          raw: {}
        };
      },
      generateTotp() {
        return "12345";
      }
    },
    steamWebSessionExports: {
      async refreshWebCookie() {
        return {
          steamId64: "76561198000000000",
          cookieString: "sessionid=abcdef1234567890abcdef12; steamLoginSecure=fake_cookie",
          sessionid: "abcdef1234567890abcdef12",
          steamLoginSecure: "fake_cookie",
          isFallbackCookie: false
        };
      },
      async refreshWebCookieFromToken() {
        throw new Error("not used in this test");
      }
    }
  });

  let server = null;
  try {
    const {createServer} = uiServerStub.module;
    server = createServer({
      licenseRuntimeFactory: () => ({
        getState() {
          return {
            ok: true,
            user: {
              username: "viewer_a",
              membership_plan: "pro"
            },
            permissions: [
              "accounts.read",
              "accounts.write",
              "inventory.read",
              "inventory.refresh"
            ]
          };
        },
        stop() {}
      }),
      licenseConfigFactory: () => ({
        authMode: "debug_bundle"
      }),
      accountStoreFactory: () => ({
        get(username) {
          if (String(username || "").trim() !== "countsteam01") {
            return null;
          }
          return {
            username: "countsteam01",
            mafile_content: "{\"stub\":true}"
          };
        }
      })
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const response = await requestJson(`http://127.0.0.1:${address.port}`, "/api/accounts/countsteam01/inventory");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.item_count, 1);

    const logOutput = captured.filter((line) => line.includes("web_inventory_fetch")).join("\n");
    assert.match(logOutput, /account=countsteam01 mode=single step=start/);
    assert.match(logOutput, /account=countsteam01 mode=single step=session/);
    assert.match(logOutput, /account=countsteam01 mode=single phase=request page=1/);
    assert.match(logOutput, /account=countsteam01 mode=single phase=response page=1 status=200/);
    assert.match(logOutput, /account=countsteam01 mode=single phase=page page=1 page_count=1 total=1/);
    assert.match(logOutput, /account=countsteam01 mode=single step=done items=1/);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    uiServerStub.restore();
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

async function main() {
  await test_single_inventory_route_logs_trace_lines_to_cmd();
  console.log("web-inventory-route-logging tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
