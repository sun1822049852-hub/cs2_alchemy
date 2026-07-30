const {EventEmitter} = require("events");
const {asString} = require("../utils");

function parseFetchTimeMs(text) {
  const value = asString(text).trim();
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function createRefreshRuntime({
  logger,
  refreshInventoryFn,
  accountStoreFactory,
  uiStateStoreFactory,
  resolveRefreshTarget,
  buildRefreshPayload,
  runPostRefreshTask = null,
  heartbeatStaleMs = 30 * 60 * 1000,
  heartbeatCheckMs = 60 * 1000,
  sseKeepaliveMs = 25 * 1000
}) {
  const connectedAccounts = new Set();
  const refreshLocks = new Map();
  const postRefreshStates = new Map();
  const eventBus = new EventEmitter();
  const sseClients = new Map();

  let nextSseClientId = 1;
  let heartbeatTimer = null;
  let sseKeepaliveTimer = null;
  let heartbeatRunning = false;
  let started = false;

  function writeSseEvent(res, event, payload) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload || {})}\n\n`);
  }

  function addSseClient(res, username) {
    const id = nextSseClientId;
    nextSseClientId += 1;
    const filterUsername = asString(username).trim();
    sseClients.set(id, {res, username: filterUsername});
    writeSseEvent(res, "connected", {ok: true, username: filterUsername || ""});
    if (logger) {
      logger.info("sse", `client connected: id=${id} username=${filterUsername || "<all>"}`);
    }
    return id;
  }

  function removeSseClient(clientId) {
    if (!sseClients.has(clientId)) {
      return;
    }
    sseClients.delete(clientId);
    if (logger) {
      logger.info("sse", `client disconnected: id=${clientId}`);
    }
  }

  function broadcastSse(event, payload) {
    const username = asString(payload && (payload.username || payload.account) ? payload.username || payload.account : "").trim();
    for (const [clientId, client] of sseClients.entries()) {
      if (client.username && username && client.username !== username) {
        continue;
      }
      try {
        writeSseEvent(client.res, event, payload);
      } catch (_) {
        removeSseClient(clientId);
      }
    }
  }

  function startSseKeepaliveLoop() {
    if (sseKeepaliveTimer) {
      return;
    }
    sseKeepaliveTimer = setInterval(() => {
      for (const [clientId, client] of sseClients.entries()) {
        try {
          client.res.write(": ping\n\n");
        } catch (_) {
          removeSseClient(clientId);
        }
      }
    }, sseKeepaliveMs);
    if (typeof sseKeepaliveTimer.unref === "function") {
      sseKeepaliveTimer.unref();
    }
  }

  function resolveAccount(username) {
    const key = asString(username).trim();
    if (key) {
      return key;
    }
    if (typeof resolveRefreshTarget === "function") {
      return asString(resolveRefreshTarget("")).trim();
    }
    const store = accountStoreFactory();
    const active = store.getActive();
    return active ? asString(active.username).trim() : "";
  }

  function buildRefreshAuthError({account, reason, message, authState}) {
    const err = new Error(message);
    err.code = reason;
    err.reason = reason;
    err.status = 409;
    err.auth_state = authState;
    err.account = account;
    return err;
  }

  function emitCustomSse(event, payload) {
    broadcastSse(asString(event).trim() || "message", payload || {});
  }

  async function drainPostRefreshQueue(account, state) {
    if (!state || state.running || typeof runPostRefreshTask !== "function") {
      return;
    }
    state.running = true;
    try {
      while (state.pending) {
        const current = state.pending;
        state.pending = null;
        try {
          await runPostRefreshTask({
            username: account,
            source: asString(current && current.source).trim(),
            result: current && current.result ? current.result : null,
            payload: current && current.payload ? current.payload : null,
            emitSse: emitCustomSse
          });
        } catch (err) {
          const message = asString(err && err.message ? err.message : err).trim() || "post_refresh_failed";
          if (logger) {
            logger.warn(
              "ui_server",
              `post-refresh failed: account=${account} source=${asString(current && current.source).trim() || "-"} err=${message}`
            );
          }
          eventBus.emit("inventory_post_refresh_failed", {
            username: account,
            source: asString(current && current.source).trim(),
            message
          });
        }
      }
    } finally {
      state.running = false;
      if (!state.pending) {
        postRefreshStates.delete(account);
      }
    }
  }

  function queuePostRefreshTask(task) {
    if (typeof runPostRefreshTask !== "function") {
      return;
    }
    const account = asString(task && task.username).trim();
    if (!account) {
      return;
    }
    let state = postRefreshStates.get(account);
    if (!state) {
      state = {running: false, pending: null};
      postRefreshStates.set(account, state);
    }
    state.pending = task;
    drainPostRefreshQueue(account, state).catch((err) => {
      const message = asString(err && err.message ? err.message : err).trim() || "post_refresh_queue_failed";
      if (logger) {
        logger.warn("ui_server", `post-refresh queue failed: account=${account} err=${message}`);
      }
      eventBus.emit("inventory_post_refresh_failed", {
        username: account,
        source: asString(task && task.source).trim(),
        message
      });
    });
  }

  async function runRefreshJob({
    username,
    password,
    includeHidden = true,
    source = "manual"
  }) {
    const account = resolveAccount(username);
    if (!account) {
      throw new Error("account not found: (active)");
    }
    try {
      const uiState = uiStateStoreFactory();
      const accountCache = uiState && typeof uiState.getAccount === "function" ? uiState.getAccount(account) : null;
      const persistedAuthState = asString(accountCache && accountCache.auth_state || "").trim();
      const persistedAuthReason = asString(accountCache && accountCache.auth_reason || "").trim();
      const accountStore = accountStoreFactory();
      const accountProjection = accountStore && typeof accountStore.get === "function"
        ? accountStore.get(account)
        : null;
      const hasSteamGuard = Boolean(accountProjection && accountProjection.has_steam_guard);
      if (persistedAuthState === "auth_invalid" && !hasSteamGuard) {
        throw buildRefreshAuthError({
          account,
          reason: persistedAuthReason || "login_key_invalid",
          message: "当前账号登录已失效，请重新登录",
          authState: "auth_invalid"
        });
      }
    } catch (err) {
      if (asString(err && err.reason || "").trim()) {
        throw err;
      }
    }
    if (refreshLocks.has(account)) {
      if (logger) {
        logger.info("ui_server", `refresh join in-flight: source=${source} account=${account}`);
      }
      return refreshLocks.get(account);
    }

    const task = (async () => {
      if (logger) {
        logger.info("ui_server", `refresh start: source=${source} account=${account}`);
      }
      try {
        const result = await refreshInventoryFn({
          username: account,
          password,
          includeHidden,
          dumpRaw: false,
          logger,
          onConnectionProgress: async (payload = {}) => {
            eventBus.emit("steam_app_license_status", {
              username: account,
              source,
              ...payload
            });
          },
          onConnectionReady: async (payload = {}) => {
            eventBus.emit("inventory_connection_ready", {
              username: account,
              source,
              connected: true,
              ...payload
            });
          }
        });
        try {
          const uiState = uiStateStoreFactory();
          if (uiState && typeof uiState.clearAccountAuthState === "function") {
            uiState.clearAccountAuthState(account);
          }
        } catch (_) {
          // ignore auth-state clear errors
        }
        connectedAccounts.add(account);
        const payload = await buildRefreshPayload(result);
        eventBus.emit("inventory_refreshed", {
          username: account,
          fetch_time: payload.fetch_time,
          rows: payload.rows.length,
          source,
          connected: true
        });
        queuePostRefreshTask({
          username: account,
          source,
          result,
          payload
        });
        if (logger) {
          logger.info("ui_server", `refresh success: source=${source} account=${account} rows=${payload.rows.length}`);
        }
        return payload;
      } catch (err) {
        connectedAccounts.delete(account);
        eventBus.emit("inventory_refresh_failed", {
          username: account,
          source,
          connected: false,
          message: asString(err && err.message ? err.message : err),
          reason: asString(err && (err.reason || err.code) || "").trim(),
          auth_state: asString(err && err.auth_state || "").trim(),
          relogin_required: ["login_key_missing", "login_key_invalid"].includes(
            asString(err && (err.reason || err.code) || "").trim()
          )
        });
        throw err;
      }
    })().finally(() => {
      refreshLocks.delete(account);
    });

    refreshLocks.set(account, task);
    return task;
  }

  async function runHeartbeatTick() {
    if (heartbeatRunning) {
      return;
    }
    heartbeatRunning = true;
    try {
      const targets = [...connectedAccounts];
      if (!targets.length) {
        return;
      }

      const accountStore = accountStoreFactory();
      const active = accountStore.getActive();
      const activeUsername = active ? asString(active.username).trim() : "";
      if (activeUsername) {
        const idx = targets.indexOf(activeUsername);
        if (idx > 0) {
          targets.splice(idx, 1);
          targets.unshift(activeUsername);
        }
      }
      const uiState = uiStateStoreFactory();
      const now = Date.now();
      if (logger && targets.length > 1) {
        logger.info("heartbeat", `refresh queue (serial): ${targets.join(" -> ")}`);
      }
      for (const username of targets) {
        const account = accountStore.get(username);
        if (!account) {
          connectedAccounts.delete(username);
          continue;
        }
        const cache = uiState.getAccount(username);
        const fetchMs = parseFetchTimeMs(cache ? cache.fetch_time : "");
        if (fetchMs > 0 && now - fetchMs < heartbeatStaleMs) {
          continue;
        }
        if (logger) {
          logger.info("heartbeat", `trigger refresh: account=${username}`);
        }
        try {
          await runRefreshJob({
            username,
            includeHidden: true,
            source: "heartbeat"
          });
        } catch (err) {
          if (logger) {
            logger.warn(
              "heartbeat",
              `refresh failed: account=${username} err=${asString(err && err.message ? err.message : err)}`
            );
          }
        }
      }
    } finally {
      heartbeatRunning = false;
    }
  }

  function startHeartbeatLoop() {
    if (heartbeatTimer) {
      return;
    }
    heartbeatTimer = setInterval(() => {
      runHeartbeatTick().catch((err) => {
        if (logger) {
          logger.warn("heartbeat", `tick failed: ${asString(err && err.message ? err.message : err)}`);
        }
      });
    }, heartbeatCheckMs);
    if (typeof heartbeatTimer.unref === "function") {
      heartbeatTimer.unref();
    }
    if (logger) {
      logger.info(
        "heartbeat",
        `started: check_interval_sec=${Math.floor(heartbeatCheckMs / 1000)} stale_after_min=${Math.floor(
          heartbeatStaleMs / 60000
        )}`
      );
    }
  }

  function handleSseRequest(req, res, username) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    const clientId = addSseClient(res, username);
    const onClose = () => removeSseClient(clientId);
    req.on("close", onClose);
    req.on("aborted", onClose);
  }

  function start() {
    if (started) {
      return;
    }
    started = true;
    startHeartbeatLoop();
    startSseKeepaliveLoop();
    eventBus.on("inventory_connection_ready", (payload) => broadcastSse("inventory_connection_ready", payload));
    eventBus.on("steam_app_license_status", (payload) => broadcastSse("steam_app_license_status", payload));
    eventBus.on("inventory_refreshed", (payload) => broadcastSse("inventory_refreshed", payload));
    eventBus.on("inventory_refresh_failed", (payload) => broadcastSse("inventory_refresh_failed", payload));
    eventBus.on("inventory_post_refresh_failed", (payload) => broadcastSse("inventory_post_refresh_failed", payload));
  }

  function emitSse(event, payload) {
    broadcastSse(asString(event).trim() || "message", payload || {});
  }

  return {
    start,
    handleSseRequest,
    emitSse,
    runRefreshJob,
    isConnected(username) {
      return connectedAccounts.has(asString(username).trim());
    },
    removeAccount(username) {
      connectedAccounts.delete(asString(username).trim());
    }
  };
}

module.exports = {
  createRefreshRuntime
};
