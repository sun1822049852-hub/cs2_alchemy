const path = require("node:path");

const {asString} = require("../node_sidecar/src/utils");
const {createSkinDetailEnrichmentService} = require("../node_sidecar/src/services/skinDetailEnrichmentService");
const {createSteamFirstSkinDetailProvider} = require("../node_sidecar/src/services/steamFirstSkinDetailProvider");

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

function buildCliOptions(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const rootDir = path.resolve(__dirname, "..");
  const options = {
    dbPath: path.join(rootDir, "csgo_skins.db"),
    concurrency: 6,
    noRateLimit: false,
    imageQps: 0,
    imageRequestMaxInFlight: 1,
    imageBaseDelayMs: 250,
    imageRateLimitBackoffMs: 1200,
    imageRateLimitMaxDelayMs: 10000,
    imageDelayRelaxStepMs: 100,
    imageDelayRelaxAfterSuccesses: 4
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

async function enrichMissingImages(options = {}) {
  const provider = options.provider || createSteamFirstSkinDetailProvider({
    logger: options.logger || null,
    steamImageOptions: options.steamImageOptions || {}
  });
  const throttleOptions = resolveImageThrottleOptions(options);
  const service = createSkinDetailEnrichmentService({
    dbPath: options.dbPath,
    provider,
    concurrency: toPositiveInt(options.concurrency, 6),
    ...throttleOptions
  });
  return service.enrichMissingImages(options);
}

async function main(argv = process.argv.slice(2)) {
  const options = buildCliOptions(argv);
  console.log(JSON.stringify({
    started_at: new Date().toISOString(),
    mode: "images_only",
    ...options
  }, null, 2));
  const result = await enrichMissingImages(options);
  console.log(JSON.stringify({
    finished_at: new Date().toISOString(),
    result
  }, null, 2));
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  buildCliOptions,
  resolveImageThrottleOptions,
  enrichMissingImages,
  main
};
