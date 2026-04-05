const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const options = {
    privateKey: path.resolve(process.cwd(), "tmp", "client_license_private.pem"),
    publicKey: path.resolve(process.cwd(), "tmp", "client_license_public.pem")
  };
  for (let i = 0; i < args.length; i += 1) {
    const item = String(args[i] || "").trim();
    if (item === "--private-key" && args[i + 1]) {
      options.privateKey = path.resolve(String(args[i + 1] || "").trim());
      i += 1;
      continue;
    }
    if (item === "--public-key" && args[i + 1]) {
      options.publicKey = path.resolve(String(args[i + 1] || "").trim());
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
  const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
  ensureDir(options.privateKey);
  ensureDir(options.publicKey);
  fs.writeFileSync(options.privateKey, privateKey.export({type: "pkcs8", format: "pem"}), "utf8");
  fs.writeFileSync(options.publicKey, publicKey.export({type: "spki", format: "pem"}), "utf8");
  console.log(`private key => ${options.privateKey}`);
  console.log(`public key => ${options.publicKey}`);
}

main();
