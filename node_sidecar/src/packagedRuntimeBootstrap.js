const fs = require("node:fs");
const path = require("node:path");
const {PATHS} = require("./constants");
const {readJson, ensureDirFor} = require("./jsonStore");

function normalizePath(value) {
  return path.resolve(String(value || "").trim() || ".");
}

function buildSeedDescriptors({
  rootDir = PATHS.ROOT_DIR,
  writableRoot = PATHS.WRITABLE_ROOT
} = {}) {
  const sourceRoot = normalizePath(rootDir);
  const targetRoot = normalizePath(writableRoot);
  return [
    {
      name: "client_config.json",
      sourcePath: path.join(sourceRoot, "client_config.json"),
      targetPath: path.join(targetRoot, "client_config.json")
    },
    {
      name: "schema_cache.json",
      sourcePath: path.join(sourceRoot, "schema_cache.json"),
      targetPath: path.join(targetRoot, "schema_cache.json")
    },
    {
      name: "csgo_skins.db",
      sourcePath: path.join(sourceRoot, "csgo_skins.db"),
      targetPath: path.join(targetRoot, "csgo_skins.db")
    }
  ];
}

function resolvePackagedDefaultControlPlaneBaseUrl({
  rootDir = PATHS.ROOT_DIR
} = {}) {
  const configPath = path.join(normalizePath(rootDir), "client_config.json");
  const fileConfig = readJson(configPath, {});
  if (!fileConfig || typeof fileConfig !== "object" || Array.isArray(fileConfig)) {
    return "";
  }
  return String(
    fileConfig.controlPlaneBaseUrl
    || fileConfig.control_plane_base_url
    || ""
  ).trim();
}

function ensurePackagedRuntimeFiles({
  isPackaged = false,
  rootDir = PATHS.ROOT_DIR,
  writableRoot = PATHS.WRITABLE_ROOT
} = {}) {
  if (!isPackaged) {
    return [];
  }
  const seeded = [];
  for (const item of buildSeedDescriptors({rootDir, writableRoot})) {
    if (!fs.existsSync(item.sourcePath) || fs.existsSync(item.targetPath)) {
      continue;
    }
    ensureDirFor(item.targetPath);
    fs.copyFileSync(item.sourcePath, item.targetPath);
    seeded.push(item);
  }
  return seeded;
}

module.exports = {
  buildSeedDescriptors,
  resolvePackagedDefaultControlPlaneBaseUrl,
  ensurePackagedRuntimeFiles
};
