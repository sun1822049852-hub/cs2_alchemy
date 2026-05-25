const {asString} = require("../utils");
const {
  normalizeCollectionKey,
  normalizeRarityRank,
  rarityLabelFromRank
} = require("./skinAlchemyRules");
const {resolveCraftAssistTargetStepSpec} = require("./craftAssistFloat32Step");
const {outputWearFromRelativeFloat32} = require("./wearFloat32Math");

const ALLOWED_REQUIRED_COUNTS = new Set([5, 10]);
const FLOAT_PRECISION = 12;

function roundNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number(numeric.toFixed(FLOAT_PRECISION));
}

function invalidResult({
  invalid_reason = "invalid_request",
  message = "请求无效",
  required_count = 0,
  current_count = 0
} = {}) {
  return {
    ok: false,
    invalid_reason,
    message,
    required_count,
    current_count,
    outcomes: []
  };
}

function predictedWearLevel(value) {
  if (!Number.isFinite(Number(value))) {
    return "";
  }
  const numeric = Number(value);
  if (numeric < 0.07) return "Factory New";
  if (numeric < 0.15) return "Minimal Wear";
  if (numeric < 0.38) return "Field-Tested";
  if (numeric < 0.45) return "Well-Worn";
  return "Battle-Scarred";
}

function normalizeWearApproachMode(value) {
  return String(value || "").trim() === "infinite" ? "infinite" : "below";
}

function resolvePredictionTargetRelativeWear(targetRelativeWear, approachMode) {
  return resolveCraftAssistTargetStepSpec({
    inputStep: Math.fround(targetRelativeWear),
    inputRaw: targetRelativeWear,
    approachMode: normalizeWearApproachMode(approachMode)
  }).targetStep;
}

function normalizeGroups(groups) {
  const merged = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const collectionKey = normalizeCollectionKey(group && group.collection);
    const count = Math.trunc(Number(group && group.count));
    if (!collectionKey || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    merged.set(collectionKey, (merged.get(collectionKey) || 0) + count);
  }
  return [...merged.entries()].map(([collection_key, count]) => ({collection_key, count}));
}

function hasWearBounds(candidate) {
  return candidate
    && candidate.minfloat != null
    && candidate.maxfloat != null
    && candidate.wear_range != null
    && Number.isFinite(Number(candidate.minfloat))
    && Number.isFinite(Number(candidate.maxfloat))
    && Number.isFinite(Number(candidate.wear_range));
}

function createCraftOutcomePredictor({catalog, rarityOrder = []} = {}) {
  if (!catalog || typeof catalog.getSnapshot !== "function") {
    throw new Error("catalog.getSnapshot is required");
  }
  return {
    predict(payload = {}) {
      const requiredCount = Math.trunc(Number(payload && payload.required_count));
      const normalizedGroups = normalizeGroups(payload && payload.groups);
      const currentCount = normalizedGroups.reduce((sum, group) => sum + group.count, 0);
      if (!ALLOWED_REQUIRED_COUNTS.has(requiredCount)) {
        return invalidResult({
          invalid_reason: "invalid_required_count",
          message: "配方无效：required_count 非法",
          required_count: requiredCount,
          current_count: currentCount
        });
      }
      const targetRelativeWear = Number(payload && payload.target_relative_wear);
      if (!Number.isFinite(targetRelativeWear) || targetRelativeWear < 0 || targetRelativeWear > 1) {
        return invalidResult({
          invalid_reason: "invalid_target_relative_wear",
          message: "配方无效：目标相对磨损非法",
          required_count: requiredCount,
          current_count: currentCount
        });
      }
      let quantizedRelativeWear = null;
      try {
        quantizedRelativeWear = resolvePredictionTargetRelativeWear(
          targetRelativeWear,
          payload && payload.wear_approach_mode
        );
      } catch (err) {
        return invalidResult({
          invalid_reason: String(err && err.code || "invalid_target_relative_wear"),
          message: "配方无效：目标相对磨损非法",
          required_count: requiredCount,
          current_count: currentCount
        });
      }
      if (!normalizedGroups.length || currentCount > requiredCount) {
        return invalidResult({
          invalid_reason: "invalid_group_count",
          message: "配方无效：材料数量非法",
          required_count: requiredCount,
          current_count: currentCount
        });
      }

      const inputRarity = asString(payload && payload.input_rarity).trim();
      const inputRarityRank = normalizeRarityRank(inputRarity, rarityOrder);
      if (inputRarityRank <= 0) {
        return invalidResult({
          invalid_reason: "invalid_input_rarity",
          message: "配方无效：输入稀有度非法",
          required_count: requiredCount,
          current_count: currentCount
        });
      }
      const outputRarityRank = inputRarityRank + 1;
      const outputRarity = rarityLabelFromRank(outputRarityRank, rarityOrder);
      if (!outputRarity) {
        return invalidResult({
          invalid_reason: "no_higher_rarity_outcomes",
          message: "配方无效：当前稀有度已无更高阶产物",
          required_count: requiredCount,
          current_count: currentCount
        });
      }

      const stattrak = !!payload.stattrak;
      const snapshot = catalog.getSnapshot();
      const outcomeBuckets = snapshot.outcomeBuckets || snapshot.baseBuckets;
      const outcomeWearMap = snapshot.outcomeWearMap || snapshot.wearMap;
      const outcomes = [];
      for (const group of normalizedGroups) {
        const bucketKey = `${group.collection_key}|${outputRarityRank}|${stattrak ? 1 : 0}`;
        const candidates = outcomeBuckets.get(bucketKey) || [];
        if (!candidates.length) {
          return invalidResult({
            invalid_reason: "collection_outcomes_missing",
            message: "配方无效：存在武器箱在当前稀有度下查不到上一级产物",
            required_count: requiredCount,
            current_count: currentCount
          });
        }
        const collectionShare = group.count / requiredCount;
        const perOutcomeProbability = roundNumber(collectionShare / candidates.length);
        for (const candidate of candidates) {
          const baseOutcome = {
            collection_key: group.collection_key,
            collection_display: candidate.collection_display || group.collection_key,
            base_name: asString(candidate.base_name).trim(),
            probability: perOutcomeProbability,
            minfloat: candidate.minfloat == null ? null : Number(candidate.minfloat),
            maxfloat: candidate.maxfloat == null ? null : Number(candidate.maxfloat),
            wear_range: candidate.wear_range == null ? null : Number(candidate.wear_range),
            goods_icon_url: asString(candidate.goods_icon_url).trim(),
            goods_original_icon_url: asString(candidate.goods_original_icon_url).trim(),
            goods_share_thumbnail_url: asString(candidate.goods_share_thumbnail_url).trim(),
            missing_wear_bounds: false,
            mapped_skin_missing: false,
            predicted_float: null,
            predicted_wearlevel: "",
            name: asString(candidate.base_name).trim(),
            markethashname: ""
          };
          if (!hasWearBounds(candidate)) {
            baseOutcome.missing_wear_bounds = true;
            outcomes.push(baseOutcome);
            continue;
          }
          const predictedFloat = roundNumber(
            outputWearFromRelativeFloat32(quantizedRelativeWear, candidate.minfloat, candidate.maxfloat)
          );
          const wearlevel = predictedWearLevel(predictedFloat);
          const concrete = outcomeWearMap.get(candidate.basemarkethashname)?.get(wearlevel) || null;
          baseOutcome.predicted_float = predictedFloat;
          baseOutcome.predicted_wearlevel = wearlevel;
          if (concrete) {
            baseOutcome.name = asString(concrete.name || concrete.markethashname).trim();
            baseOutcome.markethashname = asString(concrete.markethashname).trim();
          } else {
            baseOutcome.mapped_skin_missing = true;
          }
          outcomes.push(baseOutcome);
        }
      }

      const probabilityTotal = roundNumber(outcomes.reduce((sum, item) => sum + Number(item.probability || 0), 0)) || 0;
      return {
        ok: true,
        invalid_reason: "",
        message: "",
        required_count: requiredCount,
        current_count: currentCount,
        target_relative_wear: roundNumber(targetRelativeWear),
        input_rarity: inputRarity,
        output_rarity: outputRarity,
        stattrak,
        summary: {
          probability_total: probabilityTotal,
          probability_missing: roundNumber(Math.max(0, 1 - probabilityTotal)) || 0
        },
        outcomes
      };
    }
  };
}

module.exports = {
  createCraftOutcomePredictor
};
