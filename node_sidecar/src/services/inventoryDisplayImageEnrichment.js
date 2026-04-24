const fs = require("node:fs");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");

const {asString} = require("../utils");
const {createSkinDetailEnrichmentService} = require("./skinDetailEnrichmentService");
const {createSteamFirstSkinDetailProvider} = require("./steamFirstSkinDetailProvider");

function toPositiveInt(value, fallback) {
  const parsed = Math.trunc(Number(value));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function toNonNegativeInt(value, fallback) {
  const parsed = Math.trunc(Number(value));
  if (Number.isFinite(parsed) && parsed >= 0) {
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
  const sidecarRootDir = path.resolve(__dirname, "..", "..");
  const projectRootDir = path.resolve(sidecarRootDir, "..");
  const options = {
    dbPath: path.join(projectRootDir, "csgo_skins.db"),
    concurrency: 6,
    noRateLimit: false,
    imageQps: 0,
    imageRequestMaxInFlight: 1,
    imageBaseDelayMs: 250,
    imageRateLimitBackoffMs: 1200,
    imageRateLimitMaxDelayMs: 10000,
    imageDelayRelaxStepMs: 100,
    imageDelayRelaxAfterSuccesses: 4,
    processedDir: path.join(projectRootDir, "logs", "processed_inventory"),
    snapshotPath: ""
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = asString(args[i]).trim();
    const next = asString(args[i + 1]).trim();
    if (arg === "--no-rate-limit") {
      options.noRateLimit = true;
      continue;
    }
    if (arg === "--db" && next) {
      options.dbPath = next;
      i += 1;
      continue;
    }
    if (arg === "--concurrency" && next) {
      options.concurrency = toPositiveInt(next, options.concurrency);
      i += 1;
      continue;
    }
    if (arg === "--image-qps" && next) {
      options.imageQps = toNonNegativeInt(next, options.imageQps);
      i += 1;
      continue;
    }
    if (arg === "--image-max-in-flight" && next) {
      options.imageRequestMaxInFlight = toPositiveInt(next, options.imageRequestMaxInFlight);
      i += 1;
      continue;
    }
    if (arg === "--image-base-delay-ms" && next) {
      options.imageBaseDelayMs = toNonNegativeInt(next, options.imageBaseDelayMs);
      i += 1;
      continue;
    }
    if (arg === "--image-rate-limit-backoff-ms" && next) {
      options.imageRateLimitBackoffMs = toPositiveInt(next, options.imageRateLimitBackoffMs);
      i += 1;
      continue;
    }
    if (arg === "--image-rate-limit-max-delay-ms" && next) {
      options.imageRateLimitMaxDelayMs = toPositiveInt(next, options.imageRateLimitMaxDelayMs);
      i += 1;
      continue;
    }
    if (arg === "--image-delay-relax-step-ms" && next) {
      options.imageDelayRelaxStepMs = toPositiveInt(next, options.imageDelayRelaxStepMs);
      i += 1;
      continue;
    }
    if (arg === "--image-delay-relax-after-successes" && next) {
      options.imageDelayRelaxAfterSuccesses = toPositiveInt(next, options.imageDelayRelaxAfterSuccesses);
      i += 1;
      continue;
    }
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

function resolveImageThrottleOptions(options = {}) {
  const concurrency = toPositiveInt(options.concurrency, 6);
  const imageRequestMaxInFlight = toPositiveInt(
    options.imageRequestMaxInFlight,
    Math.max(1, concurrency)
  );
  if (options.noRateLimit) {
    return {
      imageBaseDelayMs: 0,
      imageRateLimitBackoffMs: 0,
      imageRateLimitMaxDelayMs: 0,
      imageDelayRelaxStepMs: 0,
      imageDelayRelaxAfterSuccesses: 1,
      imageRequestMaxInFlight
    };
  }
  const imageQps = toNonNegativeInt(options.imageQps, 0);
  return {
    imageBaseDelayMs: imageQps > 0
      ? Math.max(0, Math.ceil(1000 / imageQps))
      : toNonNegativeInt(options.imageBaseDelayMs, 250),
    imageRateLimitBackoffMs: toNonNegativeInt(options.imageRateLimitBackoffMs, 1200),
    imageRateLimitMaxDelayMs: toNonNegativeInt(options.imageRateLimitMaxDelayMs, 10000),
    imageDelayRelaxStepMs: toNonNegativeInt(options.imageDelayRelaxStepMs, 100),
    imageDelayRelaxAfterSuccesses: toPositiveInt(options.imageDelayRelaxAfterSuccesses, 4),
    imageRequestMaxInFlight
  };
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

module.exports = {
  buildCliOptions,
  resolveImageThrottleOptions,
  listProcessedSnapshots,
  resolveSnapshotPath,
  loadSnapshotMarketHashNames,
  selectTargetMarketHashNames,
  enrichInventoryDisplayOnlyImages,
  main
};
