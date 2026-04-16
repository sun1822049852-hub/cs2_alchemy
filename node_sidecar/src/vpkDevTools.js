const fs = require("node:fs");
const path = require("node:path");

function resolveVpkClass(explicitClass) {
  if (explicitClass) {
    return explicitClass;
  }
  // Lazy-load the dependency so unit tests can inject a fake class.
  return require("@lowly1337/vpk");
}

function createArchive(filePath, {VPKClass} = {}) {
  const ResolvedVpkClass = resolveVpkClass(VPKClass);
  const archive = new ResolvedVpkClass(filePath);
  if (typeof archive.isValid === "function" && !archive.isValid()) {
    throw new Error(`invalid VPK file: ${filePath}`);
  }
  if (typeof archive.load !== "function") {
    throw new Error("VPK loader missing load()");
  }
  archive.load();
  return archive;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  return null;
}

function requireEntryBuffer(filePath, entryPath, {VPKClass} = {}) {
  const archive = createArchive(filePath, {VPKClass});
  const payload = archive.getFile(entryPath);
  const buffer = toBuffer(payload);
  if (!buffer) {
    throw new Error(`VPK entry not found: ${entryPath}`);
  }
  return buffer;
}

function normalizeLimit(limit) {
  if (limit == null || limit === "") {
    return 0;
  }
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`limit must be >= 0, got ${limit}`);
  }
  return parsed;
}

function listVpkEntries(filePath, {pattern = "", limit = 0, VPKClass} = {}) {
  const archive = createArchive(filePath, {VPKClass});
  const normalizedPattern = String(pattern || "").trim().toLowerCase();
  const normalizedLimit = normalizeLimit(limit);
  let entries = Array.isArray(archive.files) ? archive.files.slice() : [];
  entries.sort((left, right) => left.localeCompare(right));
  if (normalizedPattern) {
    entries = entries.filter((entry) => String(entry || "").toLowerCase().includes(normalizedPattern));
  }
  if (normalizedLimit > 0) {
    entries = entries.slice(0, normalizedLimit);
  }
  return entries;
}

function readVpkEntry(filePath, entryPath, {encoding = "utf8", VPKClass} = {}) {
  const buffer = requireEntryBuffer(filePath, entryPath, {VPKClass});
  return encoding === "buffer" ? buffer : buffer.toString(encoding);
}

function extractVpkEntry(filePath, entryPath, outputPath, {VPKClass, fsImpl = fs} = {}) {
  const buffer = requireEntryBuffer(filePath, entryPath, {VPKClass});
  fsImpl.mkdirSync(path.dirname(outputPath), {recursive: true});
  fsImpl.writeFileSync(outputPath, buffer);
  return {
    output_path: outputPath,
    bytes: buffer.length
  };
}

function parseCliArgs(argv) {
  const out = {_positional: []};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!String(token).startsWith("--")) {
      out._positional.push(String(token));
      continue;
    }
    const key = String(token).slice(2);
    const next = argv[index + 1];
    if (next == null || String(next).startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = String(next);
    index += 1;
  }
  return out;
}

function buildHelpText() {
  return [
    "Usage:",
    "  node src/vpkDevCli.js list --file <pak01_dir.vpk> [--pattern <text>] [--limit <n>]",
    "  node src/vpkDevCli.js cat --file <pak01_dir.vpk> --entry <entry> [--encoding utf8|hex|base64]",
    "  node src/vpkDevCli.js extract --file <pak01_dir.vpk> --entry <entry> --output <path>",
    "",
    "Examples:",
    "  npm run vpk:list -- --file \"D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\pak01_dir.vpk\" --pattern xpshop",
    "  npm run vpk:cat -- --file \"D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\pak01_dir.vpk\" --entry \"panorama/layout/xpshop.vxml_c\" --encoding hex",
    "  npm run vpk:extract -- --file \"D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\pak01_dir.vpk\" --entry \"panorama/scripts/xpshop.vts_c\" --output \".\\tmp\\xpshop.vts_c\""
  ].join("\n");
}

function requireOption(args, key) {
  const value = String(args[key] || "").trim();
  if (!value) {
    throw new Error(`--${key} required`);
  }
  return value;
}

function runVpkDevCommand(argv, {stdout = process.stdout, stderr = process.stderr, VPKClass} = {}) {
  try {
    const args = parseCliArgs(Array.isArray(argv) ? argv : []);
    const command = String(args._positional[0] || "").trim().toLowerCase();
    if (!command || command === "help" || command === "--help") {
      stdout.write(`${buildHelpText()}\n`);
      return 0;
    }

    if (command === "list") {
      const filePath = requireOption(args, "file");
      const entries = listVpkEntries(filePath, {
        pattern: args.pattern,
        limit: args.limit,
        VPKClass
      });
      stdout.write(`${entries.join("\n")}${entries.length ? "\n" : ""}`);
      return 0;
    }

    if (command === "cat") {
      const filePath = requireOption(args, "file");
      const entryPath = requireOption(args, "entry");
      const encoding = String(args.encoding || "utf8").trim().toLowerCase() || "utf8";
      const content = readVpkEntry(filePath, entryPath, {
        encoding,
        VPKClass
      });
      stdout.write(content);
      if (encoding !== "buffer" && !String(content).endsWith("\n")) {
        stdout.write("\n");
      }
      return 0;
    }

    if (command === "extract") {
      const filePath = requireOption(args, "file");
      const entryPath = requireOption(args, "entry");
      const outputPath = requireOption(args, "output");
      const result = extractVpkEntry(filePath, entryPath, outputPath, {VPKClass});
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    throw new Error(`unknown command: ${command}`);
  } catch (err) {
    stderr.write(`failed: ${err && err.message ? err.message : err}\n`);
    return 1;
  }
}

module.exports = {
  listVpkEntries,
  readVpkEntry,
  extractVpkEntry,
  runVpkDevCommand
};
