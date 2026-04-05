const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {FEATURE_CODES} = require("../shared/licensePolicy");
const {resolveDeviceId} = require("../node_sidecar/src/deviceIdentity");
const {getLicenseConfig} = require("../node_sidecar/src/licenseConfig");
const {createSignedLicenseBundle} = require("../node_sidecar/src/licenseBundleIssuer");

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const config = getLicenseConfig();
  const options = {
    privateKeyFile: "",
    outFile: path.resolve(process.cwd(), "tmp", "client_license_bundle.json"),
    username: "member_a",
    userId: "user_1",
    membershipPlan: "pro",
    ttlMinutes: 15,
    deviceId: resolveDeviceId(config.machineIdFile),
    permissions: Object.values(FEATURE_CODES),
    featureFlags: {
      simulation_enabled: true
    }
  };
  for (let i = 0; i < args.length; i += 1) {
    const item = String(args[i] || "").trim();
    if (item === "--private-key" && args[i + 1]) {
      options.privateKeyFile = path.resolve(String(args[i + 1] || "").trim());
      i += 1;
      continue;
    }
    if (item === "--out" && args[i + 1]) {
      options.outFile = path.resolve(String(args[i + 1] || "").trim());
      i += 1;
      continue;
    }
    if (item === "--username" && args[i + 1]) {
      options.username = String(args[i + 1] || "").trim() || options.username;
      i += 1;
      continue;
    }
    if (item === "--user-id" && args[i + 1]) {
      options.userId = String(args[i + 1] || "").trim() || options.userId;
      i += 1;
      continue;
    }
    if (item === "--plan" && args[i + 1]) {
      options.membershipPlan = String(args[i + 1] || "").trim() || options.membershipPlan;
      i += 1;
      continue;
    }
    if (item === "--ttl-minutes" && args[i + 1]) {
      const minutes = Number(args[i + 1]);
      if (Number.isFinite(minutes) && minutes > 0) {
        options.ttlMinutes = Math.trunc(minutes);
      }
      i += 1;
      continue;
    }
    if (item === "--device-id" && args[i + 1]) {
      options.deviceId = String(args[i + 1] || "").trim() || options.deviceId;
      i += 1;
      continue;
    }
    if (item === "--permissions" && args[i + 1]) {
      options.permissions = String(args[i + 1] || "")
        .split(",")
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      i += 1;
    }
  }
  return options;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.privateKeyFile) {
    console.error("缺少 --private-key 参数");
    process.exit(1);
  }
  if (!fs.existsSync(options.privateKeyFile)) {
    console.error(`private key not found: ${options.privateKeyFile}`);
    process.exit(1);
  }
  const now = new Date();
  const exp = new Date(now.getTime() + options.ttlMinutes * 60 * 1000);
  const privateKeyPem = fs.readFileSync(options.privateKeyFile, "utf8");
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const bundle = createSignedLicenseBundle({
    privateKey,
    snapshot: {
      sub: options.userId,
      username: options.username,
      device_id: options.deviceId,
      membership_plan: options.membershipPlan,
      permissions: options.permissions,
      feature_flags: options.featureFlags,
      policy_version: 1,
      jti: `local_${Date.now()}`,
      iat: now.toISOString(),
      exp: exp.toISOString()
    },
    source: "manual"
  });
  ensureDir(options.outFile);
  fs.writeFileSync(options.outFile, JSON.stringify(bundle, null, 2), "utf8");
  console.log(`license bundle => ${options.outFile}`);
}

main();
