const assert = require("node:assert/strict");

const {
  buildCliOptions,
  resolveImageThrottleOptions
} = require("../tools/enrichMissingImages");

function test_build_cli_options_accepts_no_rate_limit_flag() {
  const options = buildCliOptions([
    "--db", "C:\\temp\\skins.db",
    "--concurrency", "100",
    "--image-max-in-flight", "100",
    "--no-rate-limit"
  ]);

  assert.equal(options.dbPath, "C:\\temp\\skins.db");
  assert.equal(options.concurrency, 100);
  assert.equal(options.imageRequestMaxInFlight, 100);
  assert.equal(options.noRateLimit, true);
}

function test_resolve_image_throttle_options_disables_all_local_rate_limits() {
  const throttle = resolveImageThrottleOptions({
    concurrency: 100,
    imageRequestMaxInFlight: 100,
    imageQps: 60,
    imageBaseDelayMs: 250,
    imageRateLimitBackoffMs: 1200,
    imageRateLimitMaxDelayMs: 10000,
    imageDelayRelaxStepMs: 100,
    imageDelayRelaxAfterSuccesses: 4,
    noRateLimit: true
  });

  assert.deepEqual(throttle, {
    imageBaseDelayMs: 0,
    imageRateLimitBackoffMs: 0,
    imageRateLimitMaxDelayMs: 0,
    imageDelayRelaxStepMs: 0,
    imageDelayRelaxAfterSuccesses: 1,
    imageRequestMaxInFlight: 100
  });
}

test_build_cli_options_accepts_no_rate_limit_flag();
test_resolve_image_throttle_options_disables_all_local_rate_limits();

console.log("enrichMissingImagesTool tests passed");
