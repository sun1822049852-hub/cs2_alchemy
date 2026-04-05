(function bootstrapWorkspaceAccessGuard(globalScope) {
  function createWorkspaceAccessGuard({getMode = () => "booting", onUnauthorized = () => {}} = {}) {
    return {
      requireAuth({action = "", reason = "", view = "", run = null} = {}) {
        if (String(getMode() || "").trim() === "guest") {
          onUnauthorized({action, reason, view});
          return false;
        }
        if (typeof run === "function") {
          return run();
        }
        return true;
      }
    };
  }

  globalScope.createWorkspaceAccessGuard = createWorkspaceAccessGuard;
})(typeof window !== "undefined" ? window : globalThis);
