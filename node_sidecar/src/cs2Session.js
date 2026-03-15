const readline = require("readline");
const SteamUser = require("steam-user");
const GlobalOffensive = require("globaloffensive");
const {withTimeout, asString} = require("./utils");
const {probeCmReachability} = require("./networkPrecheck");

function normalizeMetaValue(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return asString(JSON.stringify(value)).trim();
    } catch (_) {
      return asString(value).trim();
    }
  }
  return asString(value).trim();
}

function formatError(err) {
  const message = asString(err && err.message ? err.message : err).trim() || "unknown_error";
  const code = asString(err && (err.eresult || err.code || "")).trim();
  return code ? `${message} code=${code}` : message;
}

function formatLoggedOnMeta(details) {
  if (!details || typeof details !== "object") {
    return "";
  }
  const parts = [];
  const publicIp = normalizeMetaValue(details.public_ip != null ? details.public_ip : details.ip_public);
  const cellId = normalizeMetaValue(details.cell_id != null ? details.cell_id : details.cellID);
  const steamId = normalizeMetaValue(details.client_supplied_steamid || details.steamid || "");
  if (cellId) {
    parts.push(`cell_id=${cellId}`);
  }
  if (publicIp) {
    parts.push(`public_ip=${publicIp}`);
  }
  if (steamId) {
    parts.push(`steamid=${steamId}`);
  }
  if (!parts.length) {
    const keys = Object.keys(details);
    if (keys.length) {
      parts.push(`logon_fields=${keys.length}`);
    }
  }
  return parts.join(" ");
}

function promptLine(question) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(asString(answer).trim());
    });
  });
}

class CS2Session {
  constructor({logger, tokenStore}) {
    this.logger = logger;
    this.tokenStore = tokenStore;
    this.steam = null;
    this.csgo = null;
  }

  async connect({username, password, refreshToken, timeoutMs = 90000}) {
    if (!username) {
      throw new Error("username required");
    }
    const accountName = asString(username).trim();
    const startedAt = Date.now();
    const timeout = Math.max(1, Number(timeoutMs) || 90000);
    const steam = new SteamUser({
      autoRelogin: false,
      renewRefreshTokens: true
    });
    const csgo = new GlobalOffensive(steam);

    this.steam = steam;
    this.csgo = csgo;

    let guardAnswered = false;
    let gcStarted = false;

    steam.on("refreshToken", (token) => {
      const tokenValue = asString(token).trim();
      if (this.tokenStore) {
        this.tokenStore.set(accountName, tokenValue);
      }
      if (this.logger) {
        this.logger.info("auth", `refresh token updated: account=${accountName} token_len=${tokenValue.length}`);
      }
    });

    steam.on("steamGuard", async (domain, callback) => {
      guardAnswered = true;
      if (this.logger) {
        const guardFrom = asString(domain).trim();
        this.logger.info(
          "auth",
          `steam guard required: account=${accountName}${guardFrom ? ` domain=${guardFrom}` : " domain=<mobile_or_unknown>"}`
        );
      }
      const code = await promptLine(`Enter Steam Guard code${domain ? ` (${domain})` : ""}: `);
      callback(code);
      if (this.logger) {
        this.logger.info("auth", `steam guard code submitted: account=${accountName}`);
      }
    });

    const waitConnected = withTimeout(
      new Promise((resolve, reject) => {
        steam.once("error", (err) => {
          reject(new Error(`steam error: ${formatError(err)}`));
        });
        steam.once("disconnected", (eresult, msg) => {
          const reason = asString(msg).trim();
          const code = asString(eresult).trim();
          reject(new Error(`steam disconnected${code ? ` code=${code}` : ""}${reason ? ` reason=${reason}` : ""}`));
        });
        steam.once("loggedOn", (details) => {
          if (this.logger) {
            const elapsed = Date.now() - startedAt;
            const meta = formatLoggedOnMeta(details);
            this.logger.info(
              "auth",
              `steam logged on: account=${accountName} elapsed_ms=${elapsed}${meta ? ` ${meta}` : ""}`
            );
          }
          steam.setPersona(SteamUser.EPersonaState.Online);
          steam.gamesPlayed([730]);
          if (this.logger) {
            this.logger.info("auth", `steam gamesPlayed set: account=${accountName} app=730`);
          }
        });
        csgo.once("connectedToGC", () => {
          if (gcStarted) {
            return;
          }
          gcStarted = true;
          if (this.logger) {
            const elapsed = Date.now() - startedAt;
            this.logger.info("auth", `cs2 gc connected: account=${accountName} elapsed_ms=${elapsed}`);
          }
          resolve();
        });
        csgo.once("error", (err) => {
          reject(new Error(`cs2 gc error: ${formatError(err)}`));
        });
        csgo.on("disconnectedFromGC", () => {
          if (this.logger) {
            this.logger.warn("auth", `cs2 gc disconnected: account=${accountName}`);
          }
        });
      }),
      timeout,
      "connect timeout"
    );

    const details = {};
    const rt = asString(refreshToken || "").trim();
    const loginMode = rt ? "refresh_token" : "password";
    if (this.logger) {
      this.logger.info("auth", `steamgc login start: account=${accountName} mode=${loginMode} timeout_ms=${timeout}`);
    }

    try {
      const probe = await probeCmReachability({
        logger: this.logger,
        force: false
      });
      if (this.logger) {
        this.logger.info(
          "auth",
          `steamgc precheck: account=${accountName} reachable=${probe.reachable}/${probe.total}${probe.fastest ? ` fastest=${probe.fastest}` : ""}`
        );
        if (!probe.reachable) {
          this.logger.warn(
            "auth",
            `steamgc precheck warning: account=${accountName} no_cm_reachable=true, login may timeout`
          );
        }
      }
    } catch (err) {
      if (this.logger) {
        this.logger.warn(
          "auth",
          `steamgc precheck skipped: account=${accountName} error=${formatError(err)}`
        );
      }
    }

    if (rt) {
      details.refreshToken = rt;
      if (this.logger) {
        this.logger.info("auth", `login using refresh_token: account=${accountName}`);
      }
    } else {
      details.accountName = accountName;
      details.password = asString(password).trim();
      if (!details.password) {
        throw new Error("password required when no refresh_token");
      }
      if (this.logger) {
        this.logger.info("auth", `login using password: account=${accountName}`);
      }
    }

    if (this.logger) {
      this.logger.info("auth", `steam logOn request sent: account=${accountName} mode=${loginMode}`);
    }
    steam.logOn(details);
    try {
      await waitConnected;
    } catch (err) {
      if (this.logger) {
        this.logger.warn(
          "auth",
          `steamgc login failed: account=${accountName} elapsed_ms=${Date.now() - startedAt} error=${formatError(err)}`
        );
      }
      throw err;
    }
    if (guardAnswered && this.logger) {
      this.logger.info("auth", `steam guard flow completed: account=${accountName}`);
    }
    if (this.logger) {
      this.logger.info("auth", `steamgc login ready: account=${accountName} elapsed_ms=${Date.now() - startedAt}`);
    }
    return {steam, csgo};
  }

  disconnect() {
    const steam = this.steam;
    this.steam = null;
    this.csgo = null;
    if (!steam) {
      return;
    }
    try {
      steam.logOff();
    } catch (_) {}
  }
}

module.exports = {
  CS2Session
};
