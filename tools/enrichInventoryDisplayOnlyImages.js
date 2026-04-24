const runtimeModule = require("../node_sidecar/src/services/inventoryDisplayImageEnrichment");

const {
  buildCliOptions,
  resolveImageThrottleOptions,
  listProcessedSnapshots,
  resolveSnapshotPath,
  loadSnapshotMarketHashNames,
  selectTargetMarketHashNames,
  enrichInventoryDisplayOnlyImages,
  main
} = runtimeModule;

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
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
