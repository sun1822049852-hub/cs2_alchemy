const fs = require("fs");
const path = require("path");
const http = require("http");
const {URL} = require("url");
const {execSync} = require("child_process");
const {AccountStore} = require("./accountStore");
const {TokenStore} = require("./tokenStore");
const {UiStateStore} = require("./uiStateStore");
const {loginAndSaveToken} = require("./authService");
const {refreshInventory} = require("./refreshWorkflow");
const {createRefreshRuntime} = require("./services/refreshRuntime");
const {createSessionPool} = require("./services/sessionPool");
const {createComponentOpsService} = require("./services/componentOpsService");
const {createComponentTaskQueue} = require("./services/componentTaskQueue");
const {createCraftService} = require("./services/craftService");
const {DedupLogger} = require("./logger");
const {asString, toInt, nowString} = require("./utils");
const {PATHS, STORAGE_UNIT_DEF_INDEX, STORAGE_UNIT_CAPACITY} = require("./constants");

const UI_DIR = path.resolve(__dirname, "..", "ui");
const logger = new DedupLogger({windowMs: 800});
const sessionPool = createSessionPool({logger});
const componentOpsService = createComponentOpsService({sessionPool, logger});
const craftService = createCraftService({sessionPool, logger});
let shutdownHooksInstalled = false;
let runtimeBootstrapped = false;

function logEncodingEnvironment() {
  const locale = asString(process.env.LC_ALL || process.env.LANG || process.env.LC_CTYPE || "").trim();
  let codePage = "";
  if (process.platform === "win32") {
    try {
      const out = execSync("chcp", {stdio: ["ignore", "pipe", "ignore"]}).toString("utf8");
      const m = out.match(/:\s*(\d+)/);
      codePage = m ? m[1] : "";
    } catch (_) {
      codePage = "";
    }
  }
  const localeUtf8 = /utf-?8/i.test(locale);
  const cpUtf8 = !codePage || codePage === "65001";
  if (localeUtf8 || cpUtf8) {
    logger.info("encoding", `encoding check passed: locale=${locale || "-"} codepage=${codePage || "-"}`);
  } else {
    logger.warn(
      "encoding",
      `encoding check failed: locale=${locale || "-"} codepage=${codePage || "-"}, 建议使用 UTF-8（Windows 可执行 chcp 65001）`
    );
  }
}

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
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".ico")) return "image/x-icon";
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

async function loadSnapshotRowsAsync(snapshotPath) {
  const text = await fs.promises.readFile(snapshotPath, "utf8");
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

async function loadSnapshotSafeAsync(snapshotPath) {
  const full = asString(snapshotPath).trim();
  if (!full || !fs.existsSync(full)) {
    return {snapshot: null, rows: []};
  }
  return {
    snapshot: {
      path: full,
      name: path.basename(full)
    },
    rows: await loadSnapshotRowsAsync(full)
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

const componentTaskQueue = createComponentTaskQueue({
  logger,
  onStateChanged: (snapshot) => {
    refreshRuntime.emitSse("component_task_queue", snapshot);
  }
});

async function enqueueComponentMoveJob({
  action,
  username,
  password,
  componentId,
  itemIds
}) {
  const actionKey = asString(action).trim() === "withdraw" ? "withdraw" : "deposit";
  const account = asString(username).trim();
  const componentKey = asString(componentId).trim();
  const ids = Array.isArray(itemIds) ? itemIds : [];
  const queued = componentTaskQueue.enqueue({
    username: account,
    action: actionKey,
    componentId: componentKey,
    itemIds: ids,
    execute: async ({job_id}) => {
      try {
        const payload = await componentOpsService.runMove({
          action: actionKey,
          username: account,
          password: asString(password).trim(),
          componentId: componentKey,
          itemIds: ids,
          onProgress: (progress) => {
            refreshRuntime.emitSse("component_move_progress", {
              username: account,
              job_id,
              ...progress
            });
          }
        });
        refreshRuntime.emitSse("component_move_done", {
          username: account,
          job_id,
          action: actionKey,
          component_id: componentKey,
          requested: toInt(payload && payload.op ? payload.op.requested : 0, 0),
          success: Array.isArray(payload && payload.op ? payload.op.success_ids : [])
            ? payload.op.success_ids.length
            : 0,
          failed: Array.isArray(payload && payload.op ? payload.op.failed : [])
            ? payload.op.failed.length
            : 0,
          first_failed_item_id: Array.isArray(payload && payload.op ? payload.op.failed : []) && payload.op.failed[0]
            ? asString(payload.op.failed[0].item_id || "").trim()
            : "",
          first_failed_reason: Array.isArray(payload && payload.op ? payload.op.failed : []) && payload.op.failed[0]
            ? asString(payload.op.failed[0].reason || "").trim()
            : "",
          message: asString(payload && payload.message ? payload.message : "").trim(),
          snapshot_path: asString(payload && payload.snapshot_path ? payload.snapshot_path : "").trim(),
          fetch_time: asString(payload && payload.fetch_time ? payload.fetch_time : "").trim()
        });
        return payload;
      } catch (err) {
        refreshRuntime.emitSse("component_move_failed", {
          username: account,
          job_id,
          action: actionKey,
          component_id: componentKey,
          message: asString(err && err.message ? err.message : err)
        });
        throw err;
      }
    }
  });
  return queued;
}

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
    if (toInt(row.def_index, 0) !== STORAGE_UNIT_DEF_INDEX) {
      continue;
    }
    const id = asString(row.asset_id || "").trim();
    if (!id) {
      continue;
    }
    const expected = toInt(row.casket_contained_item_count, 0);
    const loaded = Math.max((itemMap[id] || []).length, expected);
    summaryMap[id] = {
      component_id: id,
      name: asString(row.alchemy_name || row.name || `Component ${id}`),
      expected_count: Math.max(STORAGE_UNIT_CAPACITY, expected),
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

    const store = new AccountStore();
    const existed = store.get(username);
    const existedPassword = asString(existed && existed.password ? existed.password : "").trim();
    const finalPassword = password || existedPassword;
    if (!existed && !finalPassword) {
      writeJson(res, 400, {ok: false, message: "password is required"});
      return true;
    }
    const finalRemark = remark || asString(existed && existed.remark ? existed.remark : username).trim() || username;
    store.upsert({username, password: finalPassword, remark: finalRemark});
    const uiState = new UiStateStore();
    uiState.setLastSelected(username);
    writeJson(res, 200, {
      ok: true,
      active: store.getActive(),
      accounts: store.list()
    });
    return true;
  }

  if (pathname === "/api/accounts/remark" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    const remark = asString(body.remark).trim();
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }

    const store = new AccountStore();
    const ok = store.updateRemark(username, remark || username);
    if (!ok) {
      writeJson(res, 404, {ok: false, message: `account not found: ${username}`});
      return true;
    }

    logger.info("ui_server", `account remark updated: account=${username}`);
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
    componentTaskQueue.cancelByUsername(username);

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

  if (pathname === "/api/session/disconnect" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim() || resolveRefreshTarget("");
    if (!username) {
      writeJson(res, 400, {ok: false, message: "username is required"});
      return true;
    }
    const queueSnapshot = componentTaskQueue.getSnapshot(username);
    if (queueSnapshot.running && asString(queueSnapshot.running.username).trim() === username) {
      writeJson(res, 409, {ok: false, message: "该账号有任务正在执行，请稍后再断开"});
      return true;
    }
    const cancelledCount = componentTaskQueue.cancelByUsername(username);
    sessionPool.invalidate(username, "manual_disconnect");
    refreshRuntime.removeAccount(username);
    writeJson(res, 200, {
      ok: true,
      username,
      cancelled_tasks: cancelledCount,
      connected: false
    });
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
      const queued = await enqueueComponentMoveJob({
        action: "deposit",
        username,
        password: body.password,
        componentId,
        itemIds: body.item_ids
      });
      writeJson(res, 202, {
        ok: true,
        queued: true,
        message: `任务已加入队列：${queued.job.job_id}`,
        job: queued.job,
        queue: queued.snapshot
      });
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
    const includeExcluded = asString(urlObj.searchParams.get("include_excluded") || "").trim() === "1";
    if (!username || !refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    try {
      const payload = await componentOpsService.listDepositCandidates({
        username,
        componentId,
        includeExcluded
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
      const queued = await enqueueComponentMoveJob({
        action: "withdraw",
        username,
        password: body.password,
        componentId,
        itemIds: body.item_ids
      });
      writeJson(res, 202, {
        ok: true,
        queued: true,
        message: `任务已加入队列：${queued.job.job_id}`,
        job: queued.job,
        queue: queued.snapshot
      });
    } catch (err) {
      writeJson(res, 500, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/craft/tradeup" && req.method === "POST") {
    const body = await readJsonBody(req);
    const username = asString(body.username).trim();
    if (!username || !refreshRuntime.isConnected(username)) {
      writeJson(res, 409, {ok: false, message: "当前账号未连接，请先连接并刷新库存"});
      return true;
    }
    try {
      const allowCoolingRaw = body.allow_cooling;
      const allowCoolingText = asString(allowCoolingRaw).trim().toLowerCase();
      const allowCooling = allowCoolingRaw === true || allowCoolingRaw === 1 || allowCoolingText === "1" || allowCoolingText === "true";
      const hasRecipes = Array.isArray(body.recipes) && body.recipes.length > 0;
      const payload = hasRecipes
        ? await craftService.runTradeUpBatch({
          username,
          password: body.password,
          recipes: body.recipes,
          allowCooling
        })
        : await craftService.runTradeUp({
          username,
          password: body.password,
          itemIds: body.item_ids,
          allowCooling
        });
      writeJson(res, 200, {
        ok: true,
        ...payload,
        component: buildComponentSummary(payload.rows || [])
      });
    } catch (err) {
      if (err && err.craft_payload) {
        const payload = err.craft_payload;
        writeJson(res, 409, {
          ok: false,
          ...payload,
          component: buildComponentSummary(payload.rows || []),
          message: asString(err && err.message ? err.message : err)
        });
        return true;
      }
      const status = err && err.code === "bad_request" ? 400 : 500;
      writeJson(res, status, {
        ok: false,
        message: asString(err && err.message ? err.message : err)
      });
    }
    return true;
  }

  if (pathname === "/api/component/tasks" && req.method === "GET") {
    const username = asString(urlObj.searchParams.get("username") || "").trim();
    writeJson(res, 200, {
      ok: true,
      ...componentTaskQueue.getSnapshot(username)
    });
    return true;
  }

  if (pathname === "/api/component/tasks/cancel" && req.method === "POST") {
    const body = await readJsonBody(req);
    const jobId = asString(body.job_id).trim();
    const result = componentTaskQueue.cancel(jobId);
    if (!result.ok) {
      const status = result.code === "running" ? 409 : (result.code === "invalid_job_id" ? 400 : 404);
      writeJson(res, status, {
        ok: false,
        message: result.message
      });
      return true;
    }
    writeJson(res, 200, {
      ok: true,
      message: "任务已取消",
      job: result.job,
      queue: componentTaskQueue.getSnapshot("")
    });
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
        fetch_time: "",
        connected: refreshRuntime.isConnected(username)
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
        fetch_time: asString(accountCache.fetch_time || ""),
        connected: refreshRuntime.isConnected(username)
      });
      return true;
    }
    const component = buildComponentSummary(loaded.rows);
    writeJson(res, 200, {
      ok: true,
      snapshot: loaded.snapshot,
      rows: loaded.rows,
      component,
      fetch_time: asString(accountCache.fetch_time || ""),
      connected: refreshRuntime.isConnected(username)
    });
    return true;
  }

  if (pathname === "/api/snapshot/accounts" && req.method === "GET") {
    const csv = asString(urlObj.searchParams.get("usernames") || "").trim();
    let usernames = csv
      .split(",")
      .map((x) => asString(x).trim())
      .filter(Boolean);
    if (!usernames.length) {
      const store = new AccountStore();
      usernames = store
        .list()
        .map((x) => asString(x.username).trim())
        .filter(Boolean);
    }
    usernames = [...new Set(usernames)];
    if (!usernames.length) {
      writeJson(res, 200, {ok: true, snapshots: []});
      return true;
    }

    const uiState = new UiStateStore();
    const snapshots = await Promise.all(
      usernames.map(async (username) => {
        const accountCache = uiState.getAccount(username);
        const snapshotPath = asString(accountCache && accountCache.snapshot_path ? accountCache.snapshot_path : "").trim();
        const fetchTime = asString(accountCache && accountCache.fetch_time ? accountCache.fetch_time : "").trim();
        if (!snapshotPath) {
          return {
            username,
            snapshot: null,
            rows: [],
            component: {summary_map: {}, item_map: {}},
            fetch_time: fetchTime,
            connected: refreshRuntime.isConnected(username)
          };
        }
        try {
          const loaded = await loadSnapshotSafeAsync(snapshotPath);
          if (!loaded.snapshot) {
            return {
              username,
              snapshot: null,
              rows: [],
              component: {summary_map: {}, item_map: {}},
              fetch_time: fetchTime,
              connected: refreshRuntime.isConnected(username)
            };
          }
          const component = buildComponentSummary(loaded.rows);
          return {
            username,
            snapshot: loaded.snapshot,
            rows: loaded.rows,
            component,
            fetch_time: fetchTime,
            connected: refreshRuntime.isConnected(username)
          };
        } catch (err) {
          return {
            username,
            snapshot: null,
            rows: [],
            component: {summary_map: {}, item_map: {}},
            fetch_time: fetchTime,
            connected: refreshRuntime.isConnected(username),
            error: asString(err && err.message ? err.message : err)
          };
        }
      })
    );

    writeJson(res, 200, {
      ok: true,
      snapshots
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
  logEncodingEnvironment();
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





