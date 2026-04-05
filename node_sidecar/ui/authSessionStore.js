(function bootstrapAuthSessionStore(globalScope) {
  function normalizeMode(value) {
    const mode = String(value || "").trim();
    if (mode === "guest" || mode === "authenticated") {
      return mode;
    }
    return "booting";
  }

  function normalizeProvider(value) {
    const provider = String(value || "").trim();
    if (provider === "mock" || provider === "remote" || provider === "bundle") {
      return provider;
    }
    return "none";
  }

  function buildSession(payload) {
    const value = payload && typeof payload === "object" ? payload : {};
    const user = value.user && typeof value.user === "object" ? value.user : null;
    if (!user) {
      return null;
    }
    return {
      username: String(user.username || "").trim(),
      display_name: String(user.display_name || user.username || "").trim(),
      expires_at: String(value.expires_at || "").trim(),
      last_login_at: String(value.last_login_at || "").trim(),
      status: value.authenticated ? "active" : "guest"
    };
  }

  function createAuthSessionStore() {
    const store = {
      mode: "booting",
      session: null,
      authProvider: "none",
      lastFailureReason: "",
      setFromClientAuthState(payload) {
        const value = payload && typeof payload === "object" ? payload : {};
        this.authProvider = normalizeProvider(value.auth_provider);
        if (value.authenticated) {
          this.mode = "authenticated";
          this.session = buildSession(value);
          this.lastFailureReason = "";
          return this.getSnapshot();
        }
        this.mode = "guest";
        this.session = null;
        this.lastFailureReason = String(value.code || value.reason || "").trim();
        return this.getSnapshot();
      },
      setGuest(reason = "") {
        this.mode = "guest";
        this.session = null;
        this.lastFailureReason = String(reason || "").trim();
        return this.getSnapshot();
      },
      setAuthenticated(payload) {
        this.mode = "authenticated";
        this.session = buildSession(payload);
        this.authProvider = normalizeProvider(payload && payload.auth_provider || this.authProvider);
        this.lastFailureReason = "";
        return this.getSnapshot();
      },
      getSnapshot() {
        return {
          mode: normalizeMode(this.mode),
          session: this.session ? {...this.session} : null,
          authProvider: normalizeProvider(this.authProvider),
          lastFailureReason: String(this.lastFailureReason || "").trim()
        };
      }
    };
    return store;
  }

  globalScope.createAuthSessionStore = createAuthSessionStore;
  if (!globalScope.cs2AlchemyAuthSessionStore) {
    globalScope.cs2AlchemyAuthSessionStore = createAuthSessionStore();
  }
})(typeof window !== "undefined" ? window : globalThis);
