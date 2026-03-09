const {CS2Session} = require("../cs2Session");
const {asString} = require("../utils");

function createSessionPool({
  logger,
  idleMs = 5 * 60 * 1000,
  cleanupIntervalMs = 30 * 1000
} = {}) {
  const entries = new Map();
  let cleanupTimer = null;

  function getEntry(username) {
    const key = asString(username).trim();
    if (!key) {
      return null;
    }
    return entries.get(key) || null;
  }

  function setEntry(username, value) {
    const key = asString(username).trim();
    if (!key) {
      return;
    }
    entries.set(key, value);
  }

  function removeEntry(username) {
    const key = asString(username).trim();
    if (!key) {
      return;
    }
    entries.delete(key);
  }

  function disconnectEntry(username, reason = "") {
    const key = asString(username).trim();
    const entry = getEntry(key);
    if (!entry) {
      return;
    }
    if (logger) {
      logger.info("session_pool", `disconnect: account=${key}${reason ? ` reason=${reason}` : ""}`);
    }
    try {
      if (entry.session) {
        entry.session.disconnect();
      }
    } catch (_) {
      // ignore disconnect errors
    }
    removeEntry(key);
  }

  function touch(username) {
    const entry = getEntry(username);
    if (!entry) {
      return;
    }
    entry.lastUsed = Date.now();
    setEntry(username, entry);
  }

  function startCleanupLoop() {
    if (cleanupTimer) {
      return;
    }
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [username, entry] of entries.entries()) {
        if (entry.connectingPromise) {
          continue;
        }
        if (!entry.session || !entry.csgo) {
          entries.delete(username);
          continue;
        }
        if (now - (entry.lastUsed || 0) <= idleMs) {
          continue;
        }
        disconnectEntry(username, "idle_timeout");
      }
    }, cleanupIntervalMs);
    if (typeof cleanupTimer.unref === "function") {
      cleanupTimer.unref();
    }
  }

  async function acquire({
    username,
    password,
    refreshToken,
    tokenStore
  }) {
    const account = asString(username).trim();
    if (!account) {
      throw new Error("username required");
    }
    startCleanupLoop();

    const existing = getEntry(account);
    if (existing && existing.csgo && existing.session && !existing.connectingPromise) {
      touch(account);
      if (logger) {
        logger.info("session_pool", `reuse session: account=${account}`);
      }
      return {csgo: existing.csgo, reused: true};
    }

    if (existing && existing.connectingPromise) {
      if (logger) {
        logger.info("session_pool", `await connecting session: account=${account}`);
      }
      const shared = await existing.connectingPromise;
      touch(account);
      return {csgo: shared.csgo, reused: true};
    }

    const session = new CS2Session({logger, tokenStore});
    const connectingPromise = session
      .connect({
        username: account,
        password,
        refreshToken
      })
      .then(({steam, csgo}) => {
        const readyEntry = {
          session,
          steam,
          csgo,
          lastUsed: Date.now(),
          connectingPromise: null
        };
        setEntry(account, readyEntry);
        if (steam && typeof steam.on === "function") {
          steam.on("disconnected", () => {
            disconnectEntry(account, "steam_disconnected");
          });
          steam.on("error", () => {
            disconnectEntry(account, "steam_error");
          });
        }
        if (logger) {
          logger.info("session_pool", `new session connected: account=${account}`);
        }
        return readyEntry;
      })
      .catch((err) => {
        disconnectEntry(account, "connect_failed");
        throw err;
      });

    setEntry(account, {
      session: null,
      steam: null,
      csgo: null,
      lastUsed: Date.now(),
      connectingPromise
    });

    const ready = await connectingPromise;
    return {csgo: ready.csgo, reused: false};
  }

  function invalidate(username, reason = "") {
    disconnectEntry(username, reason || "invalidated");
  }

  function shutdown() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    for (const username of entries.keys()) {
      disconnectEntry(username, "shutdown");
    }
    entries.clear();
  }

  return {
    acquire,
    touch,
    invalidate,
    shutdown
  };
}

module.exports = {
  createSessionPool
};
