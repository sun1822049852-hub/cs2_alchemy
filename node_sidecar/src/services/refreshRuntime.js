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
  heartbeatStaleMs = 30 * 60 * 1000,
  heartbeatCheckMs = 60 * 1000,
  sseKeepaliveMs = 25 * 1000
}) {
  const connectedAccounts = new Set();
  const refreshLocks = new Map();
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
          logger
        });
        connectedAccounts.add(account);
        const payload = await buildRefreshPayload(result);
        eventBus.emit("inventory_refreshed", {
          username: account,
          fetch_time: payload.fetch_time,
          rows: payload.rows.length,
          source,
          connected: true
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
          message: asString(err && err.message ? err.message : err)
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
    eventBus.on("inventory_refreshed", (payload) => broadcastSse("inventory_refreshed", payload));
    eventBus.on("inventory_refresh_failed", (payload) => broadcastSse("inventory_refresh_failed", payload));
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
