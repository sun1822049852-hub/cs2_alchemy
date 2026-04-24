const path = require("path");
const fs = require("fs");
const { encryptSecret, decryptSecret } = require("./secretStore");

const KEY_FILE = path.join(__dirname, "..", "data", "steam_api_key.enc");

function getSteamApiKey() {
  try {
    if (!fs.existsSync(KEY_FILE)) return "";
    const raw = fs.readFileSync(KEY_FILE, "utf8").trim();
    return decryptSecret(raw);
  } catch (_) {
    return "";
  }
}

function setSteamApiKey(key) {
  const dir = path.dirname(KEY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const encrypted = encryptSecret(String(key || "").trim());
  fs.writeFileSync(KEY_FILE, encrypted, "utf8");
}

module.exports = { getSteamApiKey, setSteamApiKey };
