const fs = require("fs");
const path = require("path");

const {PATHS} = require("../constants");
const {fillMissingWearBounds} = require("../skinMetaStore");

function createSnapshotRowsLoader({limit = 6} = {}) {
  const cacheLimit = Math.max(1, Math.trunc(Number(limit) || 0) || 6);
  const snapshotRowsCache = new Map();

  function trimCache() {
    while (snapshotRowsCache.size > cacheLimit) {
      const oldestKey = snapshotRowsCache.keys().next().value;
      if (!oldestKey) break;
      snapshotRowsCache.delete(oldestKey);
    }
  }

  function snapshotRowsCacheStamp(stat) {
    const size = Number(stat && stat.size || 0);
    const mtimeMs = Number(stat && stat.mtimeMs || 0);
    return `${size}:${mtimeMs}`;
  }

  function resolveDbPath(dbPath) {
    const target = dbPath || PATHS.SKIN_DB_FILE;
    return target ? path.resolve(target) : "";
  }

  function buildDbStamp(dbPath) {
    const target = resolveDbPath(dbPath);
    if (!target || !fs.existsSync(target)) {
      return `${target}:missing`;
    }
    return `${target}:${snapshotRowsCacheStamp(fs.statSync(target))}`;
  }

  function touchSnapshotRowsCache(fullPath, stamp, rows) {
    snapshotRowsCache.delete(fullPath);
    snapshotRowsCache.set(fullPath, {stamp, rows});
    trimCache();
    return rows;
  }

  function loadSnapshotRows(snapshotPath, {dbPath} = {}) {
    const fullPath = path.resolve(snapshotPath);
    const resolvedDbPath = resolveDbPath(dbPath);
    const cacheKey = `${fullPath}::${resolvedDbPath}`;
    const stat = fs.statSync(fullPath);
    const stamp = `${snapshotRowsCacheStamp(stat)}|${buildDbStamp(dbPath)}`;
    const cached = snapshotRowsCache.get(cacheKey);
    if (cached && cached.stamp === stamp && Array.isArray(cached.rows)) {
      return touchSnapshotRowsCache(cacheKey, cached.stamp, cached.rows);
    }
    const text = fs.readFileSync(fullPath, "utf8");
    const obj = JSON.parse(text);
    const rows = Array.isArray(obj.items) ? obj.items : [];
    return touchSnapshotRowsCache(cacheKey, stamp, fillMissingWearBounds(rows, {dbPath}));
  }

  async function loadSnapshotRowsAsync(snapshotPath, {dbPath} = {}) {
    const fullPath = path.resolve(snapshotPath);
    const resolvedDbPath = resolveDbPath(dbPath);
    const cacheKey = `${fullPath}::${resolvedDbPath}`;
    const stat = await fs.promises.stat(fullPath);
    const stamp = `${snapshotRowsCacheStamp(stat)}|${buildDbStamp(dbPath)}`;
    const cached = snapshotRowsCache.get(cacheKey);
    if (cached && cached.stamp === stamp && Array.isArray(cached.rows)) {
      return touchSnapshotRowsCache(cacheKey, cached.stamp, cached.rows);
    }
    const text = await fs.promises.readFile(fullPath, "utf8");
    const obj = JSON.parse(text);
    const rows = Array.isArray(obj.items) ? obj.items : [];
    return touchSnapshotRowsCache(cacheKey, stamp, fillMissingWearBounds(rows, {dbPath}));
  }

  return {
    loadSnapshotRows,
    loadSnapshotRowsAsync
  };
}

module.exports = {
  createSnapshotRowsLoader
};
