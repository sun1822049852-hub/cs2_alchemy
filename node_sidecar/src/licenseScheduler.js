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
  let currentState = enforcer.evaluateBundle(store.read(), {now: now()});

  function evaluateCurrent() {
    currentState = enforcer.evaluateBundle(store.read(), {now: now()});
    return currentState;
  }

  async function maybeRefresh(state) {
    if (typeof refreshFn !== "function") {
      return state;
    }
    if (!state || !state.snapshot || state.expiresInMs > Math.max(0, Number(refreshThresholdMs) || 0)) {
      return state;
    }
    const nextBundle = await refreshFn(state);
    if (nextBundle && typeof nextBundle === "object") {
      store.saveBundle(nextBundle);
    }
    return evaluateCurrent();
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
      return currentState;
    },
    async tick() {
      const state = evaluateCurrent();
      return maybeRefresh(state);
    },
    importBundle(bundle) {
      store.saveBundle(bundle);
      return evaluateCurrent();
    },
    clear() {
      store.clear();
      return evaluateCurrent();
    }
  };
}

module.exports = {
  createLicenseScheduler
};
