const {DatabaseSync} = require("node:sqlite");

const {asString} = require("../utils");
const {assignAlchemyTypes, splitCollectionNames} = require("./skinAlchemyRules");
const {buildSkinFamilyKey} = require("./skinFamilyKey");

function log(logger, level, message) {
  if (!logger || typeof logger[level] !== "function") {
    return;
  }
  logger[level]("skin_detail_enrichment", message);
}

function createSummary() {
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

function normalizeWearInfo(value) {
  const rawMinfloat = value && value.minfloat;
  const rawMaxfloat = value && value.maxfloat;
  const wearRangeRaw = value && value.wear_range;
  const minfloat = rawMinfloat === null || rawMinfloat === undefined || rawMinfloat === ""
    ? NaN
    : Number(rawMinfloat);
  const maxfloat = rawMaxfloat === null || rawMaxfloat === undefined || rawMaxfloat === ""
    ? NaN
    : Number(rawMaxfloat);
  const wear_range = Number.isFinite(Number(wearRangeRaw))
    ? Number(wearRangeRaw)
    : (Number.isFinite(minfloat) && Number.isFinite(maxfloat) ? maxfloat - minfloat : NaN);
  return {
    minfloat: Number.isFinite(minfloat) ? minfloat : null,
    maxfloat: Number.isFinite(maxfloat) ? maxfloat : null,
    wear_range: Number.isFinite(wear_range) ? wear_range : null
  };
}

function hasCompleteWearInfo(value) {
  const wearInfo = normalizeWearInfo(value);
  return wearInfo.minfloat !== null && wearInfo.maxfloat !== null && wearInfo.wear_range !== null;
}

function normalizeImageInfo(value) {
  return {
    goods_icon_url: asString(value && value.goods_icon_url).trim(),
    goods_original_icon_url: asString(value && value.goods_original_icon_url).trim(),
    goods_share_thumbnail_url: asString(value && value.goods_share_thumbnail_url).trim()
  };
}

function normalizeProviderImageInfo(value) {
  const imageInfo = normalizeImageInfo(value);
  const fallbackUrl = imageInfo.goods_original_icon_url
    || imageInfo.goods_icon_url
    || imageInfo.goods_share_thumbnail_url;
  if (!fallbackUrl) {
    return imageInfo;
  }
  return {
    goods_icon_url: imageInfo.goods_icon_url || fallbackUrl,
    goods_original_icon_url: imageInfo.goods_original_icon_url || fallbackUrl,
    goods_share_thumbnail_url: imageInfo.goods_share_thumbnail_url || fallbackUrl
  };
}

function hasAnyImageInfo(value) {
  const imageInfo = normalizeImageInfo(value);
  return Boolean(
    imageInfo.goods_icon_url ||
    imageInfo.goods_original_icon_url ||
    imageInfo.goods_share_thumbnail_url
  );
}

function hasCompleteImageInfo(value) {
  const imageInfo = normalizeImageInfo(value);
  return Boolean(
    imageInfo.goods_icon_url &&
    imageInfo.goods_original_icon_url &&
    imageInfo.goods_share_thumbnail_url
  );
}

function buildFamilyKeyFromRow(row) {
  if (Number(row && row.inventory_display_only) === 1) {
    return asString(row && row.markethashname).trim();
  }
  return buildSkinFamilyKey(
    asString(row && row.basemarkethashname).trim() ||
    asString(row && row.markethashname).trim()
  );
}

function skinHasColumn(db, columnName) {
  return db.prepare("PRAGMA table_info(skin)").all().some(
    (row) => asString(row && row.name).trim() === asString(columnName).trim()
  );
}

function buildInventoryDisplayOnlyFilterClause(db) {
  return skinHasColumn(db, "inventory_display_only")
    ? " AND COALESCE(inventory_display_only, 0) = 0"
    : "";
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.trunc(Number(ms) || 0)));
  });
}

function normalizeDelayMs(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return Math.max(0, Math.trunc(Number(fallback) || 0));
}

function normalizeTargetMarketHashNameSet(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const list = Array.isArray(value) || value instanceof Set
    ? Array.from(value)
    : [value];
  const targetSet = new Set();
  for (const item of list) {
    const normalized = asString(item).trim();
    if (normalized) {
      targetSet.add(normalized);
    }
  }
  return targetSet;
}

function mapWithConcurrency(items, concurrency, iteratee) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.trunc(Number(concurrency) || 0) || 1);
  let index = 0;
  async function worker() {
    while (index < list.length) {
      const currentIndex = index;
      index += 1;
      await iteratee(list[currentIndex], currentIndex);
    }
  }
  return Promise.all(Array.from({length: Math.min(limit, list.length || 1)}, () => worker()));
}

function summarizeError(err) {
  const text = asString(err && err.message ? err.message : err).trim();
  return text || "detail_enrichment_failed";
}

function buildFamilyImageContext(family) {
  const representativeRow = Array.isArray(family && family.rows) ? (family.rows[0] || {}) : {};
  return {
    familyKey: asString(family && family.familyKey).trim(),
    marketHashName: asString(representativeRow.markethashname).trim(),
    baseMarketHashName: asString(representativeRow.basemarkethashname).trim() || asString(family && family.familyKey).trim(),
    representativeGoodsId: asString(family && family.representativeGoodsId).trim()
  };
}

function containsCjkCharacters(value) {
  return /[\u3400-\u9fff]/.test(asString(value));
}

function looksLikeLegacyEnglishMetadata(value) {
  const text = asString(value).trim();
  if (!text) {
    return false;
  }
  return /[A-Za-z]/.test(text) && !containsCjkCharacters(text);
}

function isBuffBackedDetailSource(value) {
  const source = asString(value).trim();
  return source === "buff" || source === "buff_goods_page";
}

function needsDetailRefresh(row) {
  const status = asString(row && row.detail_status).trim();
  if (status === "pending") {
    return true;
  }
  if (status !== "ok") {
    return false;
  }
  if (isBuffBackedDetailSource(row && row.detail_source)) {
    return false;
  }
  return looksLikeLegacyEnglishMetadata(row && row.collection)
    || looksLikeLegacyEnglishMetadata(row && row.rarity);
}

function isRateLimitLikeError(err) {
  if (Math.trunc(Number(err && err.statusCode) || 0) === 429) {
    return true;
  }
  const text = asString(err && err.message ? err.message : err).toLowerCase();
  return /http=429|too many requests/.test(text);
}

function createRequestController({
  baseDelayMs = 0,
  sleepImpl = sleep,
  rateLimitBackoffMs = 0,
  rateLimitMaxDelayMs = 0,
  delayRelaxStepMs = 0,
  delayRelaxAfterSuccesses = 1,
  maxInFlight = 1,
  logger = null,
  logLabel = "request_throttle"
} = {}) {
  const minDelayMs = normalizeDelayMs(baseDelayMs);
  const backoffMs = normalizeDelayMs(rateLimitBackoffMs);
  const maxDelayMs = Math.max(
    minDelayMs,
    normalizeDelayMs(rateLimitMaxDelayMs, Math.max(minDelayMs, backoffMs))
  );
  const relaxStepMs = normalizeDelayMs(delayRelaxStepMs);
  const relaxAfter = Math.max(1, Math.trunc(Number(delayRelaxAfterSuccesses) || 0) || 1);
  const sleepFn = typeof sleepImpl === "function" ? sleepImpl : sleep;
  const maxParallel = Math.max(1, Math.trunc(Number(maxInFlight) || 0) || 1);
  let currentDelayMs = minDelayMs;
  let successStreak = 0;
  let hasStarted = false;
  let dispatchQueue = Promise.resolve();
  let inFlight = 0;
  const slotWaiters = [];

  function releaseSlot() {
    inFlight = Math.max(0, inFlight - 1);
    const next = slotWaiters.shift();
    if (typeof next === "function") {
      next();
    }
  }

  async function waitForSlot() {
    while (inFlight >= maxParallel) {
      await new Promise((resolve) => {
        slotWaiters.push(resolve);
      });
    }
  }

  function updateDelay(nextDelayMs, reason) {
    const normalized = Math.max(minDelayMs, normalizeDelayMs(nextDelayMs, currentDelayMs));
    if (normalized === currentDelayMs) {
      return;
    }
    currentDelayMs = normalized;
    log(logger, "info", `${asString(logLabel).trim() || "request_throttle"} reason=${reason} delay_ms=${currentDelayMs}`);
  }

  async function run(task) {
    const scheduled = dispatchQueue.then(async () => {
      await waitForSlot();
      if (hasStarted && currentDelayMs > 0) {
        await sleepFn(currentDelayMs);
      }
      hasStarted = true;
      inFlight += 1;
    });
    dispatchQueue = scheduled.catch(() => {});
    await scheduled;
    try {
      const result = await task();
      if (relaxStepMs > 0 && currentDelayMs > minDelayMs) {
        successStreak += 1;
        if (successStreak >= relaxAfter) {
          successStreak = 0;
          updateDelay(Math.max(minDelayMs, currentDelayMs - relaxStepMs), "relax");
        }
      }
      return result;
    } catch (error) {
      successStreak = 0;
      if (backoffMs > 0 && isRateLimitLikeError(error)) {
        const nextDelayMs = currentDelayMs > 0
          ? Math.min(maxDelayMs, currentDelayMs + backoffMs)
          : Math.min(maxDelayMs, backoffMs);
        updateDelay(nextDelayMs, "rate_limit");
      }
      throw error;
    } finally {
      releaseSlot();
    }
  }

  return {
    run
  };
}

function recalculateAlchemyTypesForCollections(db, affectedCollections, options = {}) {
  const targets = affectedCollections instanceof Set ? affectedCollections : new Set();
  if (!targets.size) {
    return 0;
  }
  const inventoryFilter = buildInventoryDisplayOnlyFilterClause(db);
  const rows = db.prepare(`
    SELECT id, collection, rarity, alchemy_type
    FROM skin
    WHERE TRIM(COALESCE(collection, '')) <> ''
      ${inventoryFilter}
  `).all().filter((row) => {
    const collections = splitCollectionNames(row.collection);
    return collections.some((collection) => targets.has(collection));
  });
  if (!rows.length) {
    return 0;
  }

  const recalculated = assignAlchemyTypes(rows, {rarityOrder: options.rarityOrder});
  const update = db.prepare("UPDATE skin SET alchemy_type = ? WHERE id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of recalculated) {
      update.run(
        asString(row.alchemy_type).trim() || "不能炼金",
        Number(row.id)
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return recalculated.length;
}

function createSkinDetailEnrichmentService({
  dbPath,
  provider,
  logger = null,
  concurrency = 2,
  detailBaseDelayMs = 0,
  detailSleepImpl = sleep,
  detailRateLimitBackoffMs = 1500,
  detailRateLimitMaxDelayMs = 15000,
  detailDelayRelaxStepMs = 200,
  detailDelayRelaxAfterSuccesses = 5,
  rarityOrder = [],
  imageBaseDelayMs = 0,
  imageSleepImpl = sleep,
  imageRateLimitBackoffMs = 1500,
  imageRateLimitMaxDelayMs = 15000,
  imageDelayRelaxStepMs = 250,
  imageDelayRelaxAfterSuccesses = 3,
  imageRequestMaxInFlight = 1
} = {}) {
  if (!asString(dbPath).trim()) {
    throw new Error("dbPath is required");
  }
  if (!provider || typeof provider.fetchByGoodsId !== "function") {
    throw new Error("provider.fetchByGoodsId is required");
  }

  function loadPendingFamilies(db) {
    const inventoryFilter = buildInventoryDisplayOnlyFilterClause(db);
    const rows = db.prepare(`
      SELECT id, markethashname, basemarkethashname, buffid, collection, rarity, detail_status, detail_source
      FROM skin
      WHERE TRIM(COALESCE(markethashname, '')) <> ''
        ${inventoryFilter}
      ORDER BY id
    `).all();
    const families = new Map();
    for (const row of rows) {
      const key = buildSkinFamilyKey(asString(row.basemarkethashname).trim() || asString(row.markethashname).trim());
      if (!key) {
        continue;
      }
      if (!families.has(key)) {
        families.set(key, []);
      }
      families.get(key).push(row);
    }
    return [...families.entries()]
      .filter(([, members]) => members.some((row) => needsDetailRefresh(row)))
      .map(([familyKey, members]) => ({
        familyKey,
        rows: members,
        representativeGoodsId: asString(
          (members.find((row) => asString(row && row.buffid).trim()) || {}).buffid
        ).trim()
      }));
  }

  function markFamilyFailed(db, family, errorText) {
    const ids = family.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      return 0;
    }
    const placeholders = ids.map(() => "?").join(",");
    const checkedAt = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE skin
      SET detail_status = 'failed',
          detail_error = ?,
          detail_checked_at = ?,
          detail_attempts = COALESCE(detail_attempts, 0) + 1
      WHERE id IN (${placeholders})
    `);
    stmt.run(errorText, checkedAt, ...ids);
    return ids.length;
  }

  function markFamilyOk(db, family, detail) {
    const ids = family.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      return 0;
    }
    const placeholders = ids.map(() => "?").join(",");
    const checkedAt = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE skin
      SET collection = ?,
          rarity = ?,
          detail_status = 'ok',
          detail_source = ?,
          detail_checked_at = ?,
          detail_error = '',
          detail_attempts = COALESCE(detail_attempts, 0) + 1
      WHERE id IN (${placeholders})
    `);
    stmt.run(
      asString(detail && detail.collection).trim(),
      asString(detail && detail.rarity).trim(),
      asString(detail && detail.detail_source).trim() || "buff",
      checkedAt,
      ...ids
    );
    return ids.length;
  }

  function loadPendingImageFamilies(db, options = {}) {
    const inventoryDisplayOnlySelect = skinHasColumn(db, "inventory_display_only")
      ? "COALESCE(inventory_display_only, 0) AS inventory_display_only,"
      : "0 AS inventory_display_only,";
    const rows = db.prepare(`
      SELECT id, markethashname, basemarkethashname, buffid, ${inventoryDisplayOnlySelect}
             goods_icon_url, goods_original_icon_url, goods_share_thumbnail_url
      FROM skin
      WHERE TRIM(COALESCE(markethashname, '')) <> ''
      ORDER BY id
    `).all();
    const families = new Map();
    for (const row of rows) {
      const familyKey = buildFamilyKeyFromRow(row);
      if (!familyKey) {
        continue;
      }
      if (!families.has(familyKey)) {
        families.set(familyKey, []);
      }
      families.get(familyKey).push(row);
    }
    const list = [...families.entries()].map(([familyKey, members]) => {
      const mergedImageInfo = normalizeImageInfo({
        goods_icon_url: members.map((row) => asString(row && row.goods_icon_url).trim()).find(Boolean) || "",
        goods_original_icon_url: members.map((row) => asString(row && row.goods_original_icon_url).trim()).find(Boolean) || "",
        goods_share_thumbnail_url: members.map((row) => asString(row && row.goods_share_thumbnail_url).trim()).find(Boolean) || ""
      });
      const pendingRows = members.filter((row) => !hasCompleteImageInfo(row));
      return {
        familyKey,
        rows: members,
        pendingRows,
        representativeGoodsId: asString(
          (members.find((row) => asString(row && row.buffid).trim()) || {}).buffid
        ).trim(),
        imageInfo: hasAnyImageInfo(mergedImageInfo) ? mergedImageInfo : null
      };
    }).filter((family) => family.pendingRows.length > 0);
    const targetMarketHashNameSet = normalizeTargetMarketHashNameSet(options.targetMarketHashNames);
    const filteredList = targetMarketHashNameSet === null
      ? list
      : list.filter((family) => family.rows.some(
        (row) => targetMarketHashNameSet.has(asString(row && row.markethashname).trim())
      ));
    const limitFamilies = Math.max(0, Math.trunc(Number(options.limitFamilies) || 0));
    if (limitFamilies > 0) {
      return filteredList.slice(0, limitFamilies);
    }
    return filteredList;
  }

  function loadPendingWearFamilies(db, options = {}) {
    const inventoryFilter = buildInventoryDisplayOnlyFilterClause(db);
    const refreshWearRanges = Boolean(options.refreshWearRanges);
    const rows = db.prepare(`
      SELECT id, markethashname, basemarkethashname, basename, name, buffid, c5id, wearlevel, minfloat, maxfloat, wear_range
      FROM skin
      WHERE TRIM(COALESCE(markethashname, '')) <> ''
        ${inventoryFilter}
      ORDER BY id
    `).all();
    const families = new Map();
    for (const row of rows) {
      const familyKey = buildFamilyKeyFromRow(row);
      if (!familyKey) {
        continue;
      }
      if (!families.has(familyKey)) {
        families.set(familyKey, []);
      }
      families.get(familyKey).push(row);
    }
    const list = [...families.entries()].map(([familyKey, members]) => {
      const mergedWearInfo = normalizeWearInfo({
        minfloat: members.map((row) => row.minfloat).find((value) => value !== null && value !== undefined),
        maxfloat: members.map((row) => row.maxfloat).find((value) => value !== null && value !== undefined),
        wear_range: members.map((row) => row.wear_range).find((value) => value !== null && value !== undefined)
      });
      const pendingRows = members.filter((row) => {
        const wearInfo = normalizeWearInfo(row);
        return refreshWearRanges || !hasCompleteWearInfo(wearInfo);
      });
      return {
        familyKey,
        rows: members,
        pendingRows,
        representativeGoodsId: asString(
          (members.find((row) => asString(row && row.buffid).trim()) || {}).buffid
        ).trim(),
        representativeBaseName: asString(
          (members.find((row) => asString(row && row.basename).trim()) || {}).basename
        ).trim(),
        representativeC5Id: asString(
          (members.find((row) => asString(row && row.c5id).trim()) || {}).c5id
        ).trim(),
        wearInfo: hasCompleteWearInfo(mergedWearInfo) ? mergedWearInfo : null
      };
    }).filter((family) => family.pendingRows.length > 0);
    const limitFamilies = Math.max(0, Math.trunc(Number(options.limitFamilies) || 0));
    if (limitFamilies > 0) {
      return list.slice(0, limitFamilies);
    }
    return list;
  }

  function markFamilyImagesOk(db, family, imageInfo) {
    const ids = family.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      return 0;
    }
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`
      UPDATE skin
      SET goods_icon_url = ?,
          goods_original_icon_url = ?,
          goods_share_thumbnail_url = ?
      WHERE id IN (${placeholders})
    `).run(
      asString(imageInfo && imageInfo.goods_icon_url).trim(),
      asString(imageInfo && imageInfo.goods_original_icon_url).trim(),
      asString(imageInfo && imageInfo.goods_share_thumbnail_url).trim(),
      ...ids
    );
    return family.pendingRows.length;
  }

  function markFamilyWearOk(db, family, wearInfo) {
    const ids = family.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      return 0;
    }
    const normalizedWearInfo = normalizeWearInfo(wearInfo);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`
      UPDATE skin
      SET minfloat = ?,
          maxfloat = ?,
          wear_range = ?
      WHERE id IN (${placeholders})
    `).run(
      normalizedWearInfo.minfloat,
      normalizedWearInfo.maxfloat,
      normalizedWearInfo.wear_range,
      ...ids
    );
    return family.pendingRows.length;
  }

  async function enrichPendingWear(summary, options = {}) {
    if (typeof provider.fetchWearRangeByGoodsId !== "function") {
      return summary;
    }

    const wearFamilies = [];
    let db = new DatabaseSync(dbPath);
    try {
      for (const family of loadPendingWearFamilies(db, options)) {
        wearFamilies.push(family);
        summary.wear_rows_pending += family.pendingRows.length;
      }
    } finally {
      db.close();
    }

    await mapWithConcurrency(wearFamilies, concurrency, async (family) => {
      const workerDb = new DatabaseSync(dbPath);
      try {
        let wearInfo = !options.refreshWearRanges && hasCompleteWearInfo(family.wearInfo) ? family.wearInfo : null;
        if (!wearInfo) {
          if (!family.representativeGoodsId && !family.representativeC5Id) {
            summary.wear_rows_failed += family.pendingRows.length;
            log(
              logger,
              "warn",
              `wear family=${family.familyKey} goods_id=- err=no_supported_platform_id`
            );
            return;
          }
          wearInfo = await provider.fetchWearRangeByGoodsId(family.representativeGoodsId, {
            familyKey: family.familyKey,
            basename: family.representativeBaseName,
            c5id: family.representativeC5Id,
            representativeC5Id: family.representativeC5Id,
            rows: family.rows
          });
        }
        summary.wear_rows_ok += markFamilyWearOk(workerDb, family, wearInfo);
      } catch (err) {
        summary.wear_rows_failed += family.pendingRows.length;
        log(
          logger,
          "warn",
          `wear family=${family.familyKey} goods_id=${family.representativeGoodsId || "-"} err=${summarizeError(err)}`
        );
      } finally {
        workerDb.close();
      }
    });

    db = new DatabaseSync(dbPath);
    try {
      const inventoryFilter = buildInventoryDisplayOnlyFilterClause(db);
      const wearRow = db.prepare(`
        SELECT COUNT(*) AS count
        FROM skin
        WHERE TRIM(COALESCE(markethashname, '')) <> ''
          ${inventoryFilter}
          AND (
            minfloat IS NULL
            OR maxfloat IS NULL
            OR wear_range IS NULL
          )
      `).get();
      summary.wear_rows_still_missing = Number(wearRow && wearRow.count || 0) || 0;
    } finally {
      db.close();
    }
    return summary;
  }

  async function enrichPendingImages(summary, options = {}) {
    if (typeof provider.fetchGoodsImage !== "function" && typeof provider.fetchGoodsImageByGoodsId !== "function") {
      return summary;
    }

    const imageFamilies = [];
    const delayMs = normalizeDelayMs(options.delayMs, imageBaseDelayMs);
    const imageRequestController = createRequestController({
      baseDelayMs: delayMs,
      sleepImpl: imageSleepImpl,
      rateLimitBackoffMs: imageRateLimitBackoffMs,
      rateLimitMaxDelayMs: imageRateLimitMaxDelayMs,
      delayRelaxStepMs: imageDelayRelaxStepMs,
      delayRelaxAfterSuccesses: imageDelayRelaxAfterSuccesses,
      maxInFlight: imageRequestMaxInFlight,
      logger,
      logLabel: "image_throttle"
    });
    let db = new DatabaseSync(dbPath);
    try {
      for (const family of loadPendingImageFamilies(db, options)) {
        imageFamilies.push(family);
        summary.image_rows_pending += family.pendingRows.length;
      }
    } finally {
      db.close();
    }

    await mapWithConcurrency(imageFamilies, concurrency, async (family) => {
      const workerDb = new DatabaseSync(dbPath);
      try {
        let imageInfo = hasCompleteImageInfo(family.imageInfo) ? family.imageInfo : null;
        if (!imageInfo) {
          const errors = [];
          if (typeof provider.fetchGoodsImage === "function") {
            try {
              const familyImageInfo = await imageRequestController.run(
                () => provider.fetchGoodsImage(buildFamilyImageContext(family))
              );
              const normalizedFamilyImageInfo = normalizeProviderImageInfo(familyImageInfo);
              if (hasCompleteImageInfo(normalizedFamilyImageInfo)) {
                imageInfo = normalizedFamilyImageInfo;
              }
            } catch (error) {
              errors.push(error);
            }
          }
          if (!imageInfo && typeof provider.fetchGoodsImageByGoodsId === "function") {
            if (!family.representativeGoodsId) {
              if (errors.length > 0) {
                throw errors[errors.length - 1];
              }
            } else {
              try {
                imageInfo = normalizeProviderImageInfo(await imageRequestController.run(
                  () => provider.fetchGoodsImageByGoodsId(family.representativeGoodsId)
                ));
              } catch (error) {
                errors.push(error);
              }
            }
          }
          if (!imageInfo && !family.representativeGoodsId) {
            summary.image_rows_failed += family.pendingRows.length;
            log(
              logger,
              "warn",
              `image family=${family.familyKey} goods_id=- err=no_supported_platform_id`
            );
            return;
          }
          if (!imageInfo) {
            throw errors[errors.length - 1] || new Error("image unavailable");
          }
        }
        summary.image_rows_ok += markFamilyImagesOk(workerDb, family, imageInfo);
      } catch (err) {
        summary.image_rows_failed += family.pendingRows.length;
        log(
          logger,
          "warn",
          `image family=${family.familyKey} goods_id=${family.representativeGoodsId || "-"} err=${summarizeError(err)}`
        );
      } finally {
        workerDb.close();
      }
    });

    db = new DatabaseSync(dbPath);
    try {
      if (normalizeTargetMarketHashNameSet(options.targetMarketHashNames) !== null) {
        summary.image_rows_still_missing = loadPendingImageFamilies(db, options).reduce(
          (total, family) => total + family.pendingRows.length,
          0
        );
      } else {
        const imageRow = db.prepare(`
          SELECT COUNT(*) AS count
          FROM skin
          WHERE TRIM(COALESCE(markethashname, '')) <> ''
            AND (
              TRIM(COALESCE(goods_icon_url, '')) = ''
              OR TRIM(COALESCE(goods_original_icon_url, '')) = ''
              OR TRIM(COALESCE(goods_share_thumbnail_url, '')) = ''
            )
        `).get();
        summary.image_rows_still_missing = Number(imageRow && imageRow.count || 0) || 0;
      }
    } finally {
      db.close();
    }
    return summary;
  }

  async function enrichMissingDetails(options = {}) {
    const summary = createSummary();
    const families = [];
    const affectedCollections = new Set();
    const detailRequestController = createRequestController({
      baseDelayMs: detailBaseDelayMs,
      sleepImpl: detailSleepImpl,
      rateLimitBackoffMs: detailRateLimitBackoffMs,
      rateLimitMaxDelayMs: detailRateLimitMaxDelayMs,
      delayRelaxStepMs: detailDelayRelaxStepMs,
      delayRelaxAfterSuccesses: detailDelayRelaxAfterSuccesses,
      logger,
      logLabel: "detail_throttle"
    });
    let db = new DatabaseSync(dbPath);
    try {
      for (const family of loadPendingFamilies(db)) {
        families.push(family);
      }
      summary.families_pending = families.length;
    } finally {
      db.close();
    }

    await mapWithConcurrency(families, concurrency, async (family) => {
      let workerDb = new DatabaseSync(dbPath);
      try {
        if (!family.representativeGoodsId) {
          const affected = markFamilyFailed(workerDb, family, "no_supported_platform_id");
          summary.rows_no_supported_platform += affected;
          summary.families_failed += 1;
          return;
        }
        const representative = family.rows[0] || {};
        const detail = await detailRequestController.run(() => provider.fetchByGoodsId(family.representativeGoodsId, {
          expectedBaseName: asString(representative.basemarkethashname).trim() ||
            asString(representative.markethashname).trim()
        }));
        const affected = markFamilyOk(workerDb, family, detail);
        for (const collection of splitCollectionNames(detail && detail.collection)) {
          affectedCollections.add(collection);
        }
        summary.families_ok += 1;
        summary.rows_filled += affected;
        log(logger, "info", `family=${family.familyKey} goods_id=${family.representativeGoodsId} rows=${affected} status=ok`);
      } catch (err) {
        const errorText = summarizeError(err);
        markFamilyFailed(workerDb, family, errorText);
        summary.families_failed += 1;
        log(logger, "warn", `family=${family.familyKey} goods_id=${family.representativeGoodsId || "-"} status=failed err=${errorText}`);
      } finally {
        workerDb.close();
      }
    });

    db = new DatabaseSync(dbPath);
    try {
      recalculateAlchemyTypesForCollections(db, affectedCollections, {rarityOrder});
      const inventoryFilter = buildInventoryDisplayOnlyFilterClause(db);
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM skin
        WHERE 1 = 1
          ${inventoryFilter}
          AND (
            TRIM(COALESCE(collection, '')) = ''
            OR TRIM(COALESCE(rarity, '')) = ''
          )
      `).get();
      summary.rows_still_missing = Number(row && row.count || 0) || 0;
    } finally {
      db.close();
    }

    await enrichPendingWear(summary, options);
    await enrichPendingImages(summary);

    return summary;
  }

  return {
    enrichMissingDetails,
    async enrichMissingWear(options = {}) {
      const summary = createSummary();
      await enrichPendingWear(summary, options);
      return summary;
    },
    async enrichMissingImages(options = {}) {
      const summary = createSummary();
      await enrichPendingImages(summary, options);
      return summary;
    }
  };
}

module.exports = {
  createSkinDetailEnrichmentService
};
