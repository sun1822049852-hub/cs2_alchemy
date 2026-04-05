const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const {asString} = require("./utils");

function resolveDeviceId(machineIdFile) {
  const filePath = asString(machineIdFile).trim();
  try {
    if (filePath && fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath);
      if (raw && raw.length) {
        return `machine_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
      }
    }
  } catch (_) {
    // fallback below
  }
  const host = `${os.hostname()}|${os.platform()}|${os.arch()}`;
  return `host_${crypto.createHash("sha256").update(host).digest("hex").slice(0, 32)}`;
}

module.exports = {
  resolveDeviceId
};
