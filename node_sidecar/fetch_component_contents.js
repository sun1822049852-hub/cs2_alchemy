const fs = require("fs");
const path = require("path");
const readline = require("readline");
const SteamUser = require("steam-user");
const GlobalOffensive = require("globaloffensive");

const STORAGE_UNIT_DEF_INDEX = 1201;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) {
      continue;
    }
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function promptLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

function tryLoadSavedRefreshToken(accountName) {
  try {
    const file = path.resolve(__dirname, "..", "login_keys.json");
    if (!fs.existsSync(file)) {
      return "";
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const token = data && data[accountName] ? String(data[accountName]) : "";
    return token.trim();
  } catch (_) {
    return "";
  }
}

function findStorageUnits(inventory) {
  const ids = new Set();
  const rows = [];
  for (const item of inventory || []) {
    const id = String(item.id || "").trim();
    if (!id || ids.has(id)) {
      continue;
    }
    const defIndex = Number(item.def_index || 0);
    const expected = Number(item.casket_contained_item_count || 0);
    const isStorageByDef = defIndex === STORAGE_UNIT_DEF_INDEX;
    const isStorageByCount = Number.isFinite(expected) && expected >= 0 && Object.prototype.hasOwnProperty.call(item, "casket_contained_item_count");
    if (!isStorageByDef && !isStorageByCount) {
      continue;
    }
    ids.add(id);
    rows.push({
      component_id: id,
      name: item.custom_name || item.name || `Storage Unit ${id}`,
      expected_count: expected,
      def_index: defIndex
    });
  }
  return rows;
}

function pickItem(item) {
  return {
    id: String(item.id || ""),
    casket_id: String(item.casket_id || ""),
    def_index: Number(item.def_index || 0),
    quality: Number(item.quality || 0),
    rarity: Number(item.rarity || 0),
    paint_index: Number(item.paint_index || 0),
    paint_seed: Number(item.paint_seed || 0),
    paint_wear: Number(item.paint_wear || 0),
    sticker_slot: Number(item.sticker_slot || 0),
    custom_name: item.custom_name || "",
    name: item.name || "",
    type: item.type || ""
  };
}

function getCasketContents(csgo, casketId) {
  return new Promise((resolve) => {
    csgo.getCasketContents(casketId, (err, items) => {
      if (err) {
        resolve({ error: String(err.message || err), items: [] });
        return;
      }
      resolve({ error: "", items: (items || []).map(pickItem) });
    });
  });
}

async function run() {
  const args = parseArgs(process.argv);
  const accountName = args.account || process.env.STEAM_USERNAME || "";
  if (!accountName) {
    throw new Error("missing account name, pass --account or STEAM_USERNAME");
  }

  const explicitRefreshToken = args["refresh-token"] || process.env.STEAM_REFRESH_TOKEN || "";
  const savedRefreshToken = tryLoadSavedRefreshToken(accountName);
  const refreshToken = String(explicitRefreshToken || savedRefreshToken || "").trim();
  let password = "";
  if (!refreshToken) {
    password = args.password || process.env.STEAM_PASSWORD || (await promptLine("Enter Steam password: "));
    if (!password) {
      throw new Error("missing password");
    }
  }

  const outputDir = path.resolve(args.outputDir || path.join(__dirname, "..", "logs", "component_contents"));
  fs.mkdirSync(outputDir, { recursive: true });

  const steam = new SteamUser({
    autoRelogin: false,
    renewRefreshTokens: true
  });
  const csgo = new GlobalOffensive(steam);

  const state = {
    finished: false,
    account_name: accountName,
    started_at: new Date().toISOString(),
    components: [],
    errors: []
  };
  let gcLoadStarted = false;

  const finish = (code) => {
    if (state.finished) {
      return;
    }
    state.finished = true;
    state.ended_at = new Date().toISOString();
    const loaded = state.components.reduce((a, x) => a + Number(x.loaded_count || 0), 0);
    const expected = state.components.reduce((a, x) => a + Number(x.expected_count || 0), 0);
    state.summary = {
      components: state.components.length,
      loaded_items: loaded,
      expected_items: expected
    };
    const outputFile = path.join(outputDir, `component_contents_${accountName}_${nowStamp()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(state, null, 2), "utf8");
    console.log(`[sidecar] done: components=${state.summary.components} loaded=${loaded} expected=${expected}`);
    console.log(`[sidecar] output: ${outputFile}`);
    try {
      steam.logOff();
    } catch (_) {}
    setTimeout(() => process.exit(code), 300);
  };

  steam.on("error", (err) => {
    console.error(`[sidecar] steam error: ${err && err.message ? err.message : err}`);
    state.errors.push(`steam error: ${err && err.message ? err.message : String(err)}`);
    finish(1);
  });

  csgo.on("error", (err) => {
    console.error(`[sidecar] csgo error: ${err && err.message ? err.message : err}`);
    state.errors.push(`csgo error: ${err && err.message ? err.message : String(err)}`);
    finish(1);
  });

  steam.on("steamGuard", async (domain, callback) => {
    if (refreshToken) {
      callback("");
      return;
    }
    const code = await promptLine(`Enter Steam Guard code${domain ? ` (${domain})` : ""}: `);
    callback(code);
  });

  steam.on("refreshToken", (token) => {
    const tokenFile = path.join(outputDir, `refresh_token_${accountName}.txt`);
    try {
      fs.writeFileSync(tokenFile, String(token || ""), "utf8");
      console.log(`[sidecar] refresh token saved: ${tokenFile}`);
    } catch (err) {
      console.warn(`[sidecar] refresh token save failed: ${err && err.message ? err.message : err}`);
    }
  });

  steam.on("loggedOn", () => {
    console.log("[sidecar] steam logged on");
    steam.setPersona(SteamUser.EPersonaState.Online);
    steam.gamesPlayed([730]);
  });

  csgo.on("connectedToGC", async () => {
    if (gcLoadStarted) {
      return;
    }
    gcLoadStarted = true;
    console.log("[sidecar] connected to GC");
    const components = findStorageUnits(csgo.inventory || []);
    console.log(`[sidecar] found components: ${components.length}`);

    for (const component of components) {
      const casketId = component.component_id;
      console.log(`[sidecar] loading component: ${casketId}`);
      const result = await getCasketContents(csgo, casketId);
      state.components.push({
        ...component,
        loaded_count: result.items.length,
        error: result.error,
        items: result.items
      });
      if (result.error) {
        console.warn(`[sidecar] component load failed: ${casketId} err=${result.error}`);
      } else {
        console.log(`[sidecar] component loaded: ${casketId} items=${result.items.length}`);
      }
    }

    finish(0);
  });

  console.log(`[sidecar] logging in (${refreshToken ? "refresh_token" : "password"})...`);
  const loginDetails = {};
  if (refreshToken) {
    loginDetails.refreshToken = refreshToken;
  } else {
    loginDetails.accountName = accountName;
    loginDetails.password = password;
  }
  steam.logOn(loginDetails);
}

run().catch((err) => {
  console.error(`[sidecar] fatal: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
