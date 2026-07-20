function createLicenseScheduler({
  store,
  enforcer,
  refreshFn = null,
  refreshThresholdMs = 5 * 60 * 1000,
  refreshIntervalMs = 5 * 60 * 1000,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (!store || typeof store.read !== "function") {
    throw new Error("store is required");
  }
  if (!enforcer || typeof enforcer.evaluateBundle !== "function") {
    throw new Error("enforcer is required");
  }

  let timer = null;
  let generation = 0;
  let refreshPromise = null;
  let refreshGeneration = -1;
  let currentState = enforcer.evaluateBundle(store.read(), {now: now()});

  function bundleVersion(bundle) {
    const value = bundle && typeof bundle === "object" ? bundle : {};
    const snapshot = value.snapshot && typeof value.snapshot === "object" ? value.snapshot : {};
    return JSON.stringify([
      String(value.signature || ""),
      String(value.refresh_credential || ""),
      String(snapshot.jti || "")
    ]);
  }

  function evaluateCurrent() {
    currentState = enforcer.evaluateBundle(store.read(), {now: now()});
    return currentState;
  }

  function cachedCurrentState() {
    if (!currentState || !currentState.ok) {
      return currentState;
    }
    const nowValue = now();
    const nowMs = typeof nowValue === "number" ? nowValue : Date.parse(nowValue);
    const expiresInMs = Date.parse(currentState.expiresAt) - nowMs;
    if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
      currentState = {
        ...currentState,
        ok: false,
        code: "license_expired",
        message: "客户端授权已过期",
        authenticated: false,
        user: null,
        permissions: [],
        featureFlags: {},
        expiresInMs: Number.isFinite(expiresInMs) ? expiresInMs : 0
      };
      return currentState;
    }
    currentState = {...currentState, expiresInMs};
    return currentState;
  }

  async function maybeRefresh(state) {
    if (typeof refreshFn !== "function") {
      return state;
    }
    if (!state || !state.snapshot || state.expiresInMs > Math.max(0, Number(refreshThresholdMs) || 0)) {
      return state;
    }
    if (refreshPromise && refreshGeneration === generation) {
      return refreshPromise;
    }
    const startedGeneration = generation;
    const startedVersion = bundleVersion(store.read());
    const task = (async () => {
      try {
        const nextBundle = await refreshFn(state);
        if (nextBundle && typeof nextBundle === "object"
          && generation === startedGeneration
          && bundleVersion(store.read()) === startedVersion) {
          store.saveBundle(nextBundle);
        }
      } catch (_) {
        // The last signed snapshot remains usable only until its local expiry check fails.
      }
      return evaluateCurrent();
    })();
    const tracked = task.finally(() => {
      if (refreshPromise === tracked) {
        refreshPromise = null;
        refreshGeneration = -1;
      }
    });
    refreshPromise = tracked;
    refreshGeneration = startedGeneration;
    return tracked;
  }

  return {
    start() {
      if (timer) {
        return;
      }
      timer = setIntervalFn(() => {
        void this.tick();
      }, Math.max(1000, Number(refreshIntervalMs) || 1000));
    },
    stop() {
      if (timer) {
        clearIntervalFn(timer);
        timer = null;
      }
    },
    getState() {
      return cachedCurrentState();
    },
    readBundle() {
      return store.read();
    },
    async tick() {
      const state = evaluateCurrent();
      return maybeRefresh(state);
    },
    importBundle(bundle) {
      generation += 1;
      store.saveBundle(bundle);
      return evaluateCurrent();
    },
    clear() {
      generation += 1;
      store.clear();
      return evaluateCurrent();
    }
  };
}

module.exports = {
  createLicenseScheduler
};
