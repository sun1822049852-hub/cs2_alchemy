const fs = require("fs");
const path = require("path");

const {PATHS, STORAGE_UNIT_DEF_INDEX} = require("../constants");
const {ensureDirFor, writeJson} = require("../jsonStore");
const {asString, nowStamp, nowString} = require("../utils");

function resolveArtifactPaths() {
  const dir = path.join(PATHS.LOG_DIR, "web_inventory_fetch");
  return {
    dir,
    historyFile: path.join(dir, "web_inventory_fetches.jsonl"),
    latestStubFile: path.join(dir, "web_inventory_stub_latest.json")
  };
}

function countComponentItems(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((count, row) => (
    asString(row && row.casket_id).trim() ? count + 1 : count
  ), 0);
}

function countStorageUnits(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((count, row) => (
    Number(row && row.def_index || 0) === STORAGE_UNIT_DEF_INDEX ? count + 1 : count
  ), 0);
}

function sanitizeRow(row) {
  return {
    asset_id: asString(row && (row.asset_id || row.assetid || row.item_id || row.id)).trim(),
    def_index: Number(row && row.def_index || 0),
    casket_id: asString(row && row.casket_id).trim(),
    market_hash_name: asString(row && row.market_hash_name).trim(),
    name: asString(row && row.name).trim(),
    goods_original_icon_url: asString(row && row.goods_original_icon_url).trim(),
    goods_icon_url: asString(row && row.goods_icon_url).trim(),
    goods_share_thumbnail_url: asString(row && row.goods_share_thumbnail_url).trim(),
    tradable_after: row && row.tradable_after != null ? row.tradable_after : "",
    hidden_reason: asString(row && row.hidden_reason).trim(),
    is_craftable: row && row.is_craftable === true
  };
}

function buildComponentSummarySample(component, limit = 6) {
  const summaryMap = component && component.summary_map && typeof component.summary_map === "object"
    ? component.summary_map
    : {};
  return Object.entries(summaryMap)
    .slice(0, Math.max(1, Number(limit) || 6))
    .map(([componentId, summary]) => ({
      component_id: asString(componentId).trim(),
      name: asString(summary && summary.name).trim(),
      item_count: Number(summary && summary.item_count || 0),
      loaded_count: Number(summary && summary.loaded_count || 0)
    }));
}

function buildComponentItemPreview(component, limitComponents = 4, limitItems = 4) {
  const itemMap = component && component.item_map && typeof component.item_map === "object"
    ? component.item_map
    : {};
  return Object.entries(itemMap)
    .slice(0, Math.max(1, Number(limitComponents) || 4))
    .map(([componentId, rows]) => ({
      component_id: asString(componentId).trim(),
      sample_asset_ids: (Array.isArray(rows) ? rows : [])
        .slice(0, Math.max(1, Number(limitItems) || 4))
        .map((row) => asString(row && (row.asset_id || row.assetid || row.item_id || row.id)).trim())
        .filter(Boolean)
    }));
}

function saveWebInventoryFetchArtifact({
  username,
  source = "",
  route = "",
  snapshot = null,
  rows = [],
  component = null,
  fetchTime = "",
  connected = false,
  authState = "normal",
  authReason = ""
} = {}) {
  const artifactPaths = resolveArtifactPaths();
  const stamp = nowStamp();
  const stubPath = path.join(artifactPaths.dir, `web_inventory_stub_${stamp}.json`);
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeComponent = component || {summary_map: {}, item_map: {}};
  const componentItemCount = countComponentItems(safeRows);
  const storageUnitCount = countStorageUnits(safeRows);
  const payload = {
    format: "web_inventory_fetch_stub_v1",
    generated_at: nowString(),
    username: asString(username).trim(),
    source: asString(source).trim(),
    route: asString(route).trim(),
    snapshot: snapshot && typeof snapshot === "object"
      ? {
          path: asString(snapshot.path).trim(),
          name: asString(snapshot.name).trim()
        }
      : null,
    fetch_time: asString(fetchTime).trim(),
    connected: connected === true,
    auth_state: asString(authState).trim() || "normal",
    auth_reason: asString(authReason).trim(),
    counts: {
      row_count: safeRows.length,
      component_item_count: componentItemCount,
      main_item_count: Math.max(0, safeRows.length - componentItemCount - storageUnitCount),
      storage_unit_count: storageUnitCount,
      component_count: Object.keys(safeComponent.summary_map || {}).length
    },
    sample_rows: safeRows.slice(0, 12).map(sanitizeRow),
    component_summary_sample: buildComponentSummarySample(safeComponent),
    component_item_preview: buildComponentItemPreview(safeComponent)
  };
  const logEntry = {
    generated_at: payload.generated_at,
    username: payload.username,
    source: payload.source,
    route: payload.route,
    snapshot_path: payload.snapshot && payload.snapshot.path ? payload.snapshot.path : "",
    fetch_time: payload.fetch_time,
    row_count: payload.counts.row_count,
    component_item_count: payload.counts.component_item_count,
    main_item_count: payload.counts.main_item_count,
    storage_unit_count: payload.counts.storage_unit_count,
    stub_path: stubPath
  };

  ensureDirFor(stubPath);
  writeJson(stubPath, payload);
  writeJson(artifactPaths.latestStubFile, payload);
  ensureDirFor(artifactPaths.historyFile);
  fs.appendFileSync(artifactPaths.historyFile, `${JSON.stringify(logEntry)}\n`, "utf8");

  return {
    stubPath,
    latestStubPath: artifactPaths.latestStubFile,
    logPath: artifactPaths.historyFile
  };
}

module.exports = {
  saveWebInventoryFetchArtifact
};
