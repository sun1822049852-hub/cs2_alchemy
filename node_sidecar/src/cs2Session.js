const readline = require("readline");
const SteamUser = require("steam-user");
const GlobalOffensive = require("globaloffensive");
const {withTimeout, asString} = require("./utils");

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
      if (this.tokenStore) {
        this.tokenStore.set(username, token);
      }
      if (this.logger) {
        this.logger.info("auth", `refresh token updated for ${username}`);
      }
    });

    steam.on("steamGuard", async (domain, callback) => {
      guardAnswered = true;
      const code = await promptLine(`Enter Steam Guard code${domain ? ` (${domain})` : ""}: `);
      callback(code);
    });

    if (this.logger) {
      this.logger.info("auth", "connecting steam + cs2 gc...");
    }

    const waitConnected = withTimeout(
      new Promise((resolve, reject) => {
        steam.once("error", (err) => reject(err));
        steam.once("loggedOn", () => {
          if (this.logger) {
            this.logger.info("auth", "steam logged on");
          }
          steam.setPersona(SteamUser.EPersonaState.Online);
          steam.gamesPlayed([730]);
        });
        csgo.on("connectedToGC", () => {
          if (gcStarted) {
            return;
          }
          gcStarted = true;
          if (this.logger) {
            this.logger.info("auth", "cs2 gc connected");
          }
          resolve();
        });
        csgo.on("error", (err) => reject(err));
      }),
      timeoutMs,
      "connect timeout"
    );

    const details = {};
    const rt = asString(refreshToken || "").trim();
    if (rt) {
      details.refreshToken = rt;
      if (this.logger) {
        this.logger.info("auth", "login using refresh_token");
      }
    } else {
      details.accountName = asString(username).trim();
      details.password = asString(password).trim();
      if (!details.password) {
        throw new Error("password required when no refresh_token");
      }
      if (this.logger) {
        this.logger.info("auth", "login using password");
      }
    }

    steam.logOn(details);
    await waitConnected;
    if (guardAnswered && this.logger) {
      this.logger.info("auth", "steam guard flow completed");
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
