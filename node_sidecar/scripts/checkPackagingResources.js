const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const options = {
    projectRoot: path.resolve(__dirname, "..", "..")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project-root" && index + 1 < argv.length) {
      options.projectRoot = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return options;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function requireFile(projectRoot, relativePath, {minBytes = 1} = {}) {
  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing packaging resource: ${relativePath}`);
  }
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) {
    throw new Error(`Packaging resource is not a file: ${relativePath}`);
  }
  if (stat.size < minBytes) {
    throw new Error(`Packaging resource is too small: ${relativePath}`);
  }
  return fullPath;
}

function requireJsonObject(projectRoot, relativePath) {
  const fullPath = requireFile(projectRoot, relativePath);
  let parsed;
  try {
    parsed = JSON.parse(readText(fullPath));
  } catch (err) {
    throw new Error(`Packaging resource is not valid JSON: ${relativePath}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Packaging JSON resource must be an object: ${relativePath}`);
  }
  return parsed;
}

function hasDependency(packageJson, sectionName, packageName) {
  return Boolean(packageJson && packageJson[sectionName] && packageJson[sectionName][packageName]);
}

function requireTextIncludes(projectRoot, relativePath, pattern, message) {
  const fullPath = requireFile(projectRoot, relativePath);
  const text = readText(fullPath);
  if (!pattern.test(text)) {
    throw new Error(`${message}: ${relativePath}`);
  }
  return text;
}

function checkElectronBuilderConfig(projectRoot) {
  const configText = requireTextIncludes(
    projectRoot,
    "node_sidecar/electron-builder.yml",
    /from:\s*build\/schema_cache\.seed\.json[\s\S]*to:\s*schema_cache\.json/,
    "electron-builder.yml must package the tracked schema seed"
  );
  if (/from:\s*\.\.\/schema_cache\.json[\s\S]*to:\s*schema_cache\.json/.test(configText)) {
    throw new Error("electron-builder.yml must not package the ignored root schema_cache.json runtime file");
  }
  if (/from:\s*\.\.\/keys\s*[\r\n]+\s*to:\s*keys/.test(configText)) {
    throw new Error("electron-builder.yml must not package the entire keys directory");
  }
  if (!/from:\s*\.\.\/keys\/client_license_public\.pem[\s\S]*to:\s*keys\/client_license_public\.pem/.test(configText)) {
    throw new Error("electron-builder.yml must package only keys/client_license_public.pem");
  }
  if (/from:\s*\.\.\/csgo_skins\.db[\s\S]*to:\s*csgo_skins\.db/.test(configText)) {
    throw new Error("electron-builder.yml must not package the root runtime csgo_skins.db");
  }
  for (const relativePath of ["src/vpkDevTools.js", "src/vpkDevCli.js"]) {
    const pattern = new RegExp(`-\\s*["']?!${relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?`);
    if (!pattern.test(configText)) {
      throw new Error("electron-builder.yml must exclude VPK development source files from formal packages");
    }
  }
}

function checkPackageDependencies(projectRoot) {
  const packageJson = requireJsonObject(projectRoot, "node_sidecar/package.json");
  if (hasDependency(packageJson, "dependencies", "@lowly1337/vpk")) {
    throw new Error("VPK development tooling must not be a production dependency");
  }
  if (!hasDependency(packageJson, "devDependencies", "@lowly1337/vpk")) {
    throw new Error("VPK development tooling must remain available as a devDependency");
  }
}

function checkPackagingResources({projectRoot}) {
  const clientConfig = requireJsonObject(projectRoot, "node_sidecar/build/client_config.release.json");
  if (!String(clientConfig.control_plane_base_url || clientConfig.controlPlaneBaseUrl || "").trim()) {
    throw new Error("Release client config must define control_plane_base_url");
  }

  const schema = requireJsonObject(projectRoot, "node_sidecar/build/schema_cache.seed.json");
  for (const key of ["weapons", "paints", "item_defs"]) {
    if (!schema[key] || typeof schema[key] !== "object" || Array.isArray(schema[key])) {
      throw new Error(`schema_cache.seed.json must include object field: ${key}`);
    }
  }

  const seedDb = requireFile(projectRoot, "node_sidecar/build/csgo_skins.seed.db", {minBytes: 1024});
  const header = fs.readFileSync(seedDb).subarray(0, 16).toString("utf8");
  if (header !== "SQLite format 3\u0000") {
    throw new Error("csgo_skins.seed.db must be a SQLite database seed");
  }

  requireFile(projectRoot, "node_sidecar/build/icon.ico", {minBytes: 1024});
  requireFile(projectRoot, "shared/licensePolicy.js");
  requireFile(projectRoot, "shared/featureCodes.js");
  requireFile(projectRoot, "shared/craftPermitPolicy.js");
  requireTextIncludes(
    projectRoot,
    "keys/client_license_public.pem",
    /-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/,
    "License public key must be a PEM public key"
  );
  checkPackageDependencies(projectRoot);
  checkElectronBuilderConfig(projectRoot);
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    checkPackagingResources(options);
    console.log("Packaging resources OK");
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  checkPackagingResources
};
