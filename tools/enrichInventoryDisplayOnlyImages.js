const fs = require("node:fs");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {asString} = require("../node_sidecar/src/utils");
const {createSkinDetailEnrichmentService} = require("../node_sidecar/src/services/skinDetailEnrichmentService");
const {createSteamFirstSkinDetailProvider} = require("../node_sidecar/src/services/steamFirstSkinDetailProvider");
const {
  buildCliOptions: buildBaseCliOptions,
  resolveImageThrottleOptions
} = require("./enrichMissingImages");

function toPositiveInt(value, fallback) {
  const parsed = Math.trunc(Number(value));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function createEmptyImageSummary() {
  return {
    families_pending: 0,
    families_ok: 0,
    families_failed: 0,
    rows_filled: 0,
    rows_still_missing: 0,
    rows_no_supported_platform: 0,
    wear_rows_pending: 0,
    wear_rows_ok: 0,
    wear_rows_failed: 0,
    wear_rows_still_missing: 0,
    image_rows_pending: 0,
    image_rows_ok: 0,
    image_rows_failed: 0,
    image_rows_still_missing: 0
  };
}

function buildCliOptions(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const rootDir = path.resolve(__dirname, "..");
  const options = {
    ...buildBaseCliOptions(args),
    processedDir: path.join(rootDir, "logs", "processed_inventory"),
    snapshotPath: ""
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = asString(args[i]).trim();
    const next = asString(args[i + 1]).trim();
    if (arg === "--snapshot" && next) {
      options.snapshotPath = next;
      i += 1;
      continue;
    }
    if (arg === "--processed-dir" && next) {
      options.processedDir = next;
      i += 1;
    }
  }

  return options;
}

function listProcessedSnapshots(processedDir) {
  const fullDir = path.resolve(processedDir);
  if (!fs.existsSync(fullDir)) {
    return [];
  }
  return fs.readdirSync(fullDir)
    .filter((name) => /^inventory_processed_\d{8}_\d{6}\.json$/i.test(name))
    .map((name) => {
      const full = path.join(fullDir, name);
      const stat = fs.statSync(full);
      return {name, full, mtimeMs: Number(stat && stat.mtimeMs || 0)};
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resolveSnapshotPath(options = {}) {
  const snapshotPath = asString(options.snapshotPath).trim();
  if (snapshotPath) {
    return path.resolve(snapshotPath);
  }
  const latest = listProcessedSnapshots(options.processedDir)[0];
  if (latest && latest.full) {
    return latest.full;
  }
  const err = new Error("processed inventory snapshot not found");
  err.code = "snapshot_missing";
  throw err;
}

function loadSnapshotMarketHashNames(snapshotPath) {
  const text = fs.readFileSync(path.resolve(snapshotPath), "utf8");
  const payload = JSON.parse(text);
  const targetNames = [];
  const seen = new Set();
  for (const item of Array.isArray(payload && payload.items) ? payload.items : []) {
    const marketHashName = asString(
      item && (item.market_hash_name || item.marketHashName || item.name)
    ).trim();
    if (!marketHashName || seen.has(marketHashName)) {
      continue;
    }
    seen.add(marketHashName);
    targetNames.push(marketHashName);
  }
  return targetNames;
}

function skinHasColumn(db, columnName) {
  return db.prepare("PRAGMA table_info(skin)").all().some(
    (row) => asString(row && row.name).trim() === asString(columnName).trim()
  );
}

function selectTargetMarketHashNames({dbPath, marketHashNames}) {
  const orderedNames = Array.isArray(marketHashNames) ? marketHashNames : [];
  const snapshotNameSet = new Set(
    orderedNames
      .map((name) => asString(name).trim())
      .filter(Boolean)
  );
  if (!snapshotNameSet.size) {
    return [];
  }

  const db = new DatabaseSync(dbPath, {open: true, readOnly: true});
  try {
    if (!skinHasColumn(db, "inventory_display_only")) {
      return [];
    }
    const rows = db.prepare(`
      SELECT markethashname
      FROM skin
      WHERE COALESCE(inventory_display_only, 0) = 1
        AND TRIM(COALESCE(markethashname, '')) <> ''
        AND (
          TRIM(COALESCE(goods_icon_url, '')) = ''
          OR TRIM(COALESCE(goods_original_icon_url, '')) = ''
          OR TRIM(COALESCE(goods_share_thumbnail_url, '')) = ''
        )
      ORDER BY id
    `).all();
    const eligible = new Set(
      rows
        .map((row) => asString(row && row.markethashname).trim())
        .filter(Boolean)
    );
    return orderedNames.filter((name, index) => {
      const normalized = asString(name).trim();
      return normalized
        && snapshotNameSet.has(normalized)
        && orderedNames.findIndex((value) => asString(value).trim() === normalized) === index
        && eligible.has(normalized);
    });
  } finally {
    db.close();
  }
}

function createService(options = {}) {
  const provider = createSteamFirstSkinDetailProvider();
  const throttleOptions = resolveImageThrottleOptions(options);
  return createSkinDetailEnrichmentService({
    dbPath: options.dbPath,
    provider,
    concurrency: toPositiveInt(options.concurrency, 6),
    ...throttleOptions
  });
}

async function enrichInventoryDisplayOnlyImages(options = {}, deps = {}) {
  const snapshotPath = resolveSnapshotPath(options);
  const snapshotMarketHashNames = loadSnapshotMarketHashNames(snapshotPath);
  const targetMarketHashNames = selectTargetMarketHashNames({
    dbPath: options.dbPath,
    marketHashNames: snapshotMarketHashNames
  });

  if (!targetMarketHashNames.length) {
    return {
      snapshotPath,
      snapshotMarketHashNames,
      targetMarketHashNames,
      result: createEmptyImageSummary()
    };
  }

  const service = (deps && typeof deps.createService === "function"
    ? deps.createService
    : createService
  )(options);

  return {
    snapshotPath,
    snapshotMarketHashNames,
    targetMarketHashNames,
    result: await service.enrichMissingImages({
      targetMarketHashNames
    })
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = buildCliOptions(argv);
  console.log(JSON.stringify({
    started_at: new Date().toISOString(),
    mode: "inventory_display_only_images",
    dbPath: options.dbPath,
    processedDir: options.processedDir,
    snapshotPath: options.snapshotPath || null,
    concurrency: options.concurrency,
    imageQps: options.imageQps,
    imageRequestMaxInFlight: options.imageRequestMaxInFlight,
    noRateLimit: options.noRateLimit
  }, null, 2));

  const outcome = await enrichInventoryDisplayOnlyImages(options);
  console.log(JSON.stringify({
    finished_at: new Date().toISOString(),
    snapshot_path: outcome.snapshotPath,
    snapshot_market_hash_names_count: outcome.snapshotMarketHashNames.length,
    target_market_hash_names_count: outcome.targetMarketHashNames.length,
    target_market_hash_names_sample: outcome.targetMarketHashNames.slice(0, 20),
    result: outcome.result
  }, null, 2));
  return outcome;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  buildCliOptions,
  listProcessedSnapshots,
  resolveSnapshotPath,
  loadSnapshotMarketHashNames,
  selectTargetMarketHashNames,
  enrichInventoryDisplayOnlyImages,
  main
};
