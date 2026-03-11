const fs = require("fs");
const path = require("path");
const http = require("http");
const {URL} = require("url");
const {AccountStore} = require("./accountStore");
const {TokenStore} = require("./tokenStore");
const {UiStateStore} = require("./uiStateStore");
const {loginAndSaveToken} = require("./authService");
const {refreshInventory} = require("./refreshWorkflow");
const {createRefreshRuntime} = require("./services/refreshRuntime");
const {createSessionPool} = require("./services/sessionPool");
const {createComponentOpsService} = require("./services/componentOpsService");
const {DedupLogger} = require("./logger");
const {asString, toInt, nowString} = require("./utils");
const {PATHS} = require("./constants");

const UI_DIR = path.resolve(__dirname, "..", "ui");
const logger = new DedupLogger({windowMs: 800});
const sessionPool = createSessionPool({logger});
const componentOpsService = createComponentOpsService({sessionPool, logger});
let shutdownHooksInstalled = false;
let runtimeBootstrapped = false;

function ensureRuntimeBootstrapped() {
  if (runtimeBootstrapped) {
    return;
  }
  runtimeBootstrapped = true;
  refreshRuntime.start();
  if (!shutdownHooksInstalled) {
    shutdownHooksInstalled = true;
    const shutdown = () => {
      sessionPool.shutdown();
    };
    process.once("exit", shutdown);
    process.once("SIGINT", () => {
      shutdown();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      shutdown();
      process.exit(0);
    });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error(`invalid json body: ${err.message}`));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function guessContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function safeUiPath(urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const abs = path.resolve(UI_DIR, `.${rel}`);
  if (!abs.startsWith(UI_DIR)) {
    return null;
  }
  return abs;
}

function listProcessedSnapshots() {
  if (!fs.existsSync(PATHS.PROCESSED_DIR)) {
    return [];
  }
  return fs
    .readdirSync(PATHS.PROCESSED_DIR)
    .filter((x) => /^inventory_processed_\d{8}_\d{6}\.json$/i.test(x))
    .map((name) => {
      const full = path.join(PATHS.PROCESSED_DIR, name);
      const stat = fs.statSync(full);
      return {name, full, mtime: stat.mtimeMs};
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function loadSnapshotRows(snapshotPath) {
  const text = fs.readFileSync(snapshotPath, "utf8");
  const obj = JSON.parse(text);
  return Array.isArray(obj.items) ? obj.items : [];
}

function loadSnapshotSafe(snapshotPath) {
  const full = asString(snapshotPath).trim();
  if (!full || !fs.existsSync(full)) {
    return {snapshot: null, rows: []};
  }
  return {
    snapshot: {
      path: full,
      name: path.basename(full)
    },
    rows: loadSnapshotRows(full)
  };
}

function resolveRefreshTarget(username) {
  const key = asString(username).trim();
  if (key) {
    return key;
  }
  const store = new AccountStore();
  const active = store.getActive();
  return active ? asString(active.username).trim() : "";
}

function buildRefreshPayload(result) {
  const rows = loadSnapshotRows(result.snapshot_path);
  const component = buildComponentSummary(rows);
  const fetchTime = nowString();
  try {
    const uiState = new UiStateStore();
    uiState.setAccountSnapshot(result.account, result.snapshot_path, fetchTime);
    uiState.setLastSelected(result.account);
  } catch (_) {
    // ignore cache save errors
  }
  return {
    result,
    fetch_time: fetchTime,
    rows,
    component
  };
}

const refreshRuntime = createRefreshRuntime({
  logger,
  refreshInventoryFn: (args) => refreshInventory({...args, sessionPool}),
  accountStoreFactory: () => new AccountStore(),
  uiStateStoreFactory: () => new UiStateStore(),
  resolveRefreshTarget,
  buildRefreshPayload,
  heartbeatStaleMs: 30 * 60 * 1000,
  heartbeatCheckMs: 60 * 1000,
  sseKeepaliveMs: 25 * 1000
});

function buildComponentSummary(rows) {
  const summaryMap = {};
  const itemMap = {};
  for (const row of rows) {
    const cid = asString(row.casket_id || "").trim();
    if (cid) {
      if (!itemMap[cid]) {
        itemMap[cid] = [];
      }
      itemMap[cid].push(row);
    }
  }
  for (const row of rows) {
    if (toInt(row.def_index, 0) !== 1201) {
      continue;
    }
    const id = asString(row.asset_id || "").trim();
    if (!id) {
      continue;
    }
    const expected = toInt(row.casket_contained_item_count, 0);
    const loaded = (itemMap[id] || []).length;
    summaryMap[id] = {
      component_id: id,
      name: asString(row.alchemy_name || row.name || `Component ${id}`),
      expected_count: expected,
      loaded_count: loaded
    };
  }
  return {summary_map: summaryMap, item_map: itemMap};
}

async function handleApi(req, res, urlObj) {
  const pathname = urlObj.pathname;
  if (pathname === "/api/events" && req.method === "GET") {
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    refreshRuntime.handleSseRequest(req, res, username);
    return true;
  }

  if (pathname === "/api/health" && req.method === "GET") {
    writeJson(res, 200, {ok: true});
    return true;
  }

  if (pathname === "/api/accounts" && req.method === "GET") {
    const store = new AccountStore();
    const uiState = new UiStateStore();
    writeJson(res, 200, {
      accounts: store.list(),
      active: store.getActive(),
      last_selected_username: uiState.getLastSelected()
    });
    return true;
  }

  if (pathname === "/api/ui-state" && req.method === "GET") {
    const uiState = new UiStateStore();
    writeJson(res, 200, {
      ok: true,
      last_selected_username: uiState.getLastSelected()
    });
    return true;
  }

  if (pathname === "/api/ui-state/last-selected" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const uiState = new UiStateStore();
    uiState.setLastSelected(username);
    writeJson(res, 200, {ok: true, last_selected_username: uiState.getLastSelected()});
    return true;
  }

  if (pathname === "/api/accounts/active" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const store = new AccountStore();
    if (!store.setActive(username)) {
      writeJson(res, 400, {ok: false, message: `account not found: ${username}`});
      return true;
    }
    const uiState = new UiStateStore();
    uiState.setLastSelected(username);
    writeJson(res, 200, {ok: true, active: store.getActive()});
    return true;
  }

  if (pathname === "/api/accounts/login-save" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const password = asString(body.password).trim();
    const totp = asString(body.totp).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!password) {
      writeJson(res, 400, {ok: false, message: "password is required"});
      return true;
    }
    if (!totp) {
      writeJson(res, 400, {ok: false, message: "totp is required"});
      return true;
    }

    try {
      const tokenStore = new TokenStore();
      const result = await loginAndSaveToken({
        username,
        password,
        twoFactorCode: totp,
        tokenStore,
        logger
      });

      const accountStore = new AccountStore();
      const existed = accountStore.get(username);
      accountStore.upsert({
        username,
        password,
        remark: asString(body.remark).trim() || (existed ? existed.remark : username)
      });

      const uiState = new UiStateStore();
      uiState.setLastSelected(username);
      writeJson(res, 200, {
        ok: true,
        message: "登录成功，已获取并保存 token",
        result: {
          username: result.username,
          token_saved: Boolean(result.refresh_token)
        },
        active: accountStore.getActive(),
        accounts: accountStore.list()
      });
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/accounts/upsert" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const password = asString(body.password).trim();
    const remark = asString(body.remark || username).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    if (!password) {
      writeJson(res, 400, {ok: false, message: "password is required"});
      return true;
    }

    const store = new AccountStore();
    store.upsert({username, password, remark: remark || username});
    const uiState = new UiStateStore();
    uiState.setLastSelected(username);
    writeJson(res, 200, {
      ok: true,
      active: store.getActive(),
      accounts: store.list()
    });
    return true;
  }

  if (pathname === "/api/accounts/delete" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    const store = new AccountStore();
    if (!store.remove(username)) {
      writeJson(res, 404, {ok: false, message: `account not found: ${username}`});
      return true;
    }
    refreshRuntime.removeAccount(username);
    sessionPool.invalidate(username, "account_deleted");

    // 删除账号时同步清理本地 refresh_token，避免残留冲突。
    try {
      const tokenStore = new TokenStore();
      tokenStore.remove(username);
    } catch (_) {
      // ignore token cleanup errors
    }
    try {
      const uiState = new UiStateStore();
      uiState.removeAccount(username);
    } catch (_) {
      // ignore ui state cleanup errors
    }

    writeJson(res, 200, {
      ok: true,
      active: store.getActive(),
      accounts: store.list()
    });
    return true;
  }

  if (pathname === "/api/refresh" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const password = asString(body.password).trim();
    logger.info("ui_server", `refresh request: account=${username || "<active>"}`);
    try {
      const payload = await refreshRuntime.runRefreshJob({
        username,
        password,
        includeHidden: asString(body.include_hidden || "true") !== "false",
        source: "manual"
      });
      writeJson(res, 200, {
        ok: true,
        result: payload.result,
        fetch_time: payload.fetch_time,
        rows: payload.rows,
        component: payload.component
      });
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/component/deposit" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const componentId = asString(body.component_id).trim();
    if (!username || !refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    try {
      const payload = await componentOpsService.runMove({
        action: "deposit",
        username,
        password: asString(body.password).trim(),
        componentId,
        itemIds: body.item_ids
      });
      writeJson(res, 200, payload);
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/component/deposit-candidates" && req.method === "GET") {
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    const componentId = asString(urlObj.searchParams.get("component_id") || "").trim();
    if (!username || !refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    try {
      const payload = await componentOpsService.listDepositCandidates({
        username,
        componentId
      });
      writeJson(res, 200, payload);
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/component/withdraw" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const componentId = asString(body.component_id).trim();
    if (!username || !refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    try {
      const payload = await componentOpsService.runMove({
        action: "withdraw",
        username,
        password: asString(body.password).trim(),
        componentId,
        itemIds: body.item_ids
      });
      writeJson(res, 200, payload);
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/snapshot/latest" && req.method === "GET") {
    const snapshots = listProcessedSnapshots();
    if (!snapshots.length) {
      writeJson(res, 200, {ok: true, snapshot: null, rows: [], component: {summary_map: {}, item_map: {}}});
      return true;
    }
    const snap = snapshots[0];
    try {
      const rows = loadSnapshotRows(snap.full);
      const component = buildComponentSummary(rows);
      writeJson(res, 200, {
        ok: true,
        snapshot: {
          path: snap.full,
          name: snap.name
        },
        rows,
        component
      });
    } catch (err) {
      writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err)});
    }
    return true;
  }

  if (pathname === "/api/snapshot/account" && req.method === "GET") {
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    const uiState = new UiStateStore();
    const accountCache = uiState.getAccount(username);
    if (!accountCache || !accountCache.snapshot_path) {
      writeJson(res, 200, {
        ok: true,
        snapshot: null,
        rows: [],
        component: {summary_map: {}, item_map: {}},
        fetch_time: ""
      });
      return true;
    }
    const loaded = loadSnapshotSafe(accountCache.snapshot_path);
    if (!loaded.snapshot) {
      writeJson(res, 200, {
        ok: true,
        snapshot: null,
        rows: [],
        component: {summary_map: {}, item_map: {}},
        fetch_time: asString(accountCache.fetch_time || "")
      });
      return true;
    }
    const component = buildComponentSummary(loaded.rows);
    writeJson(res, 200, {
      ok: true,
      snapshot: loaded.snapshot,
      rows: loaded.rows,
      component,
      fetch_time: asString(accountCache.fetch_time || "")
    });
    return true;
  }

  if (pathname === "/api/snapshot/account/meta" && req.method === "GET") {
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    const uiState = new UiStateStore();
    const accountCache = uiState.getAccount(username);
    const snapshotPath = asString(accountCache && accountCache.snapshot_path ? accountCache.snapshot_path : "").trim();
    writeJson(res, 200, {
      ok: true,
      username,
      has_snapshot: Boolean(snapshotPath && fs.existsSync(snapshotPath)),
      fetch_time: asString(accountCache && accountCache.fetch_time ? accountCache.fetch_time : "").trim(),
      connected: refreshRuntime.isConnected(username)
    });
    return true;
  }

  return false;
}

function createServer() {
  ensureRuntimeBootstrapped();
  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url, "http://127.0.0.1");
      if (urlObj.pathname.startsWith("/api/")) {
        const hit = await handleApi(req, res, urlObj);
        if (!hit) {
          writeJson(res, 404, {ok: false, message: "not found"});
        }
        return;
      }

      const filePath = safeUiPath(urlObj.pathname);
      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404, {"Content-Type": "text/plain; charset=utf-8"});
        res.end("404");
        return;
      }
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {"Content-Type": guessContentType(filePath)});
      res.end(buf);
    } catch (err) {
      writeJson(res, 500, {ok: false, message: asString(err && err.message ? err.message : err)});
    }
  });
  server.once("close", () => {
    sessionPool.shutdown();
  });
  return server;
}

function parsePort(argv) {
  const idx = argv.indexOf("--port");
  if (idx >= 0 && idx + 1 < argv.length) {
    return Math.max(1, toInt(argv[idx + 1], 8787));
  }
  return 8787;
}

function start() {
  const port = parsePort(process.argv);
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    logger.info("ui_server", `listening on http://127.0.0.1:${port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  start,
  createServer
};

