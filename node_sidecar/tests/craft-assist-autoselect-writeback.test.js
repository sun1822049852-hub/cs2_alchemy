const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractConst(name) {
  const match = APP_SOURCE.match(new RegExp(`^const\\s+${name}\\s*=\\s*[^;]+;`, "m"));
  assert.ok(match, `missing const ${name}`);
  return match[0];
}

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createScopedState() {
  return {
    craftSelectedItemIds: [],
    craftStatusText: "",
    craftStatusError: false,
    craftRecipeQueue: [],
    craftActiveRecipeId: "",
    craftAssistSelecting: false,
    craftAssistPendingUiAction: "",
    craftAssistPendingPresetId: "",
    craftAssistOpen: true,
    craftAssistPickerOpen: false,
    craftAssistPickerTargetMaterialId: "",
    craftAssistRoleChooserOpen: false,
    craftAssistPickRole: "main",
    craftAssistUseAbsoluteWear: false,
    craftAssistTargetWear: 0.2142,
    craftAssistMainCount: 5,
    craftAssistAuxCount: 5,
    craftAssistMaterials: [],
    craftAssistPresetApplyCountMap: {},
    craftAssistPresetEditingId: "",
    craftAssistPresetEditingName: "",
    craftAssistPresetEditingBackup: null,
    craftAssistPresetEditingInitialSnapshot: null
  };
}

function loadApplyCraftAssistAutoSelection() {
  const ids = Array.from({length: 10}, (_, index) => String(index + 1));
  const rows = ids.map((id) => ({asset_id: id}));
  let savedScopedState = createScopedState();
  function createAbortError(message = "aborted") {
    const err = new Error(message);
    err.name = "AbortError";
    return err;
  }
  class AbortSignalMock {
    constructor() {
      this.aborted = false;
      this.listeners = new Set();
    }

    addEventListener(type, listener) {
      if (type !== "abort" || typeof listener !== "function") return;
      this.listeners.add(listener);
    }

    removeEventListener(type, listener) {
      if (type !== "abort" || typeof listener !== "function") return;
      this.listeners.delete(listener);
    }

    dispatchAbort() {
      if (this.aborted) return;
      this.aborted = true;
      for (const listener of Array.from(this.listeners)) {
        listener({type: "abort"});
      }
    }
  }
  class AbortControllerMock {
    constructor() {
      this.signal = new AbortSignalMock();
    }

    abort() {
      this.signal.dispatchAbort();
    }
  }
  const source = [
    extractConst("DEFAULT_CRAFT_ASSIST_WEAR_OFFSET_PCT"),
    extractConst("WEAR_INPUT_DECIMALS"),
    extractBlock("async function api(", "function parseEventData("),
    extractBlock("function createDefaultCraftAssistRuntimeState(", "function createDefaultCraftAccountScopedState("),
    extractBlock("async function applyCraftAssistAutoSelection(", "async function applyCraftAssistAutoSelectionBatch(")
  ].join("\n");
  const context = {
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    JSON,
    console,
    AbortController: AbortControllerMock,
    setTimeout(fn) {
      if (typeof fn === "function") fn();
      return {cleared: false};
    },
    clearTimeout(timer) {
      if (timer && typeof timer === "object") timer.cleared = true;
    },
    state: {
      craftBusy: false,
      refreshing: false,
      currentAccountUsername: "acc-a",
      accountSelectedUsername: "acc-a",
      craftAssistSelecting: false,
      craftAssistPendingUiAction: "",
      craftAssistPendingPresetId: "",
      craftAssistRunToken: "",
      craftUseComponentItems: false,
      craftIncludeCooling: false,
      craftAssistWearOffsetPct: 5,
      craftAssistRuntimeByAccount: new Map(),
      craftAssistActiveRunTokensByAccount: new Map()
    },
    getCraftAccountScopedStateSnapshot() {
      return deepClone(savedScopedState);
    },
    commitCraftAccountScopedState(username, snapshot) {
      assert.equal(username, "acc-a");
      savedScopedState = deepClone(snapshot);
      return deepClone(savedScopedState);
    },
    buildCraftAssistDraftSnapshotFromScopedState() {
      return {
        panel_open: true,
        target_wear: 0.2142,
        wear_filter_mode: "relative",
        materials: [{id: "mat-1", names: ["AK"], role: "main", count: 10}],
        pick_role: "main"
      };
    },
    normalizeCraftAssistFilterMode(value) {
      return String(value || "relative");
    },
    parseOptionalWear01(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    },
    normalizeCraftAssistMaterialsForRun({materials}) {
      return Array.isArray(materials) ? materials : [];
    },
    craftAssistTargetCountFromMaterials() {
      return 10;
    },
    getCraftQueuePendingCountFromState(scopedState) {
      return Array.isArray(scopedState && scopedState.craftRecipeQueue) ? scopedState.craftRecipeQueue.length : 0;
    },
    getCraftQueuePendingEntriesFromState(scopedState) {
      return Array.isArray(scopedState && scopedState.craftRecipeQueue) ? scopedState.craftRecipeQueue : [];
    },
    createEmptyCraftRecipeEntryInState(scopedState) {
      const entry = {
        id: "recipe-1",
        item_ids: [],
        item_sources: {},
        status: "pending",
        prepare_status: "pending",
        prepare_message: "",
        removed_missing_count: 0
      };
      scopedState.craftRecipeQueue.push(entry);
      return entry;
    },
    normalizeCraftRecipeItemIds(list) {
      return Array.from(new Set((Array.isArray(list) ? list : []).map((id) => String(id || "").trim()).filter(Boolean)));
    },
    normalizeCraftAssistWearOffsetPct(value) {
      return Number(value) || 5;
    },
    async fetch(_path, options = {}) {
      return new Promise((resolve, reject) => {
        const signal = options && options.signal;
        if (!signal || typeof signal.addEventListener !== "function") return;
        if (signal.aborted) {
          reject(createAbortError());
          return;
        }
        signal.addEventListener("abort", () => reject(createAbortError()), {once: true});
      });
    },
    resetCraftRecipeEntryPreparation(entry) {
      entry.prepare_status = "pending";
    },
    getCraftRowsForAccount() {
      return rows;
    },
    buildRowsByAssetId(list) {
      return new Map((Array.isArray(list) ? list : []).map((row) => [String(row.asset_id), row]));
    },
    syncCraftRecipeEntryItemSources(entry) {
      entry.item_sources = Object.fromEntries((Array.isArray(entry.item_ids) ? entry.item_ids : []).map((id) => [id, {source_scope: "main"}]));
    },
    getCraftComponentSummaryMapForAccount() {
      return {};
    },
    logCraftAssistPickedRows() {},
    numberTextTrunc(value) {
      return String(value);
    },
    wearTextFull(value) {
      return String(value);
    },
    getTradeUpRecipeFromRows() {
      return {ok: true, reason: ""};
    },
    craftRarityLabel(value) {
      return `R${value}`;
    },
    setCraftStatusOnScopedState(scopedState, text, isError = false) {
      scopedState.craftStatusText = String(text || "").trim();
      scopedState.craftStatusError = !!isError;
    },
    showErrorToast() {},
    renderCraftPage() {}
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  context.getSavedScopedState = () => deepClone(savedScopedState);
  return context;
}

async function testSuccessfulAutoSelectionWritesBackFilledRecipeInsteadOfEmptyShell() {
  const app = loadApplyCraftAssistAutoSelection();
  app.fetch = async () => ({
    ok: true,
    async json() {
      return {
        item_ids: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        overall: 0.214199,
        rarity: 2,
        recipe_ok: true
      };
    }
  });

  const ok = await app.applyCraftAssistAutoSelection({accountUsername: "acc-a", pendingUiAction: "panel_apply"});
  const saved = app.getSavedScopedState();

  assert.equal(ok, true);
  assert.equal(saved.craftRecipeQueue.length, 1);
  assert.deepEqual(saved.craftRecipeQueue[0].item_ids, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  assert.equal(saved.craftRecipeQueue.some((entry) => Array.isArray(entry.item_ids) && entry.item_ids.length === 0), false);
  assert.equal(app.state.craftAssistSelecting, false);
  assert.equal(app.state.craftAssistPendingUiAction, "");
  assert.equal(app.state.craftAssistRunToken, "");
  assert.equal(app.getCraftAssistActiveRunToken("acc-a"), "");
}

async function testHungAutoSelectionRequestStillClearsBusyStateAfterTimeout() {
  const app = loadApplyCraftAssistAutoSelection();
  let ok;
  try {
    ok = await Promise.race([
      app.applyCraftAssistAutoSelection({accountUsername: "acc-a", pendingUiAction: "panel_apply"}),
      new Promise((_, reject) => setTimeout(() => reject(new Error("test timeout: assist-select remained pending")), 80))
    ]);
  } catch (err) {
    if (String(err && err.message || "").includes("test timeout")) {
      throw err;
    }
    throw err;
  }
  const saved = app.getSavedScopedState();
  assert.equal(ok, false);
  assert.equal(saved.craftRecipeQueue.length, 0);
  assert.equal(saved.craftStatusError, true);
  assert.match(saved.craftStatusText, /超时|请重试|timeout/i);
  assert.equal(app.state.craftAssistSelecting, false);
  assert.equal(app.state.craftAssistPendingUiAction, "");
  assert.equal(app.state.craftAssistRunToken, "");
  assert.equal(app.getCraftAssistActiveRunToken("acc-a"), "");
}

async function main() {
  await testSuccessfulAutoSelectionWritesBackFilledRecipeInsteadOfEmptyShell();
  await testHungAutoSelectionRequestStillClearsBusyStateAfterTimeout();
  console.log("craft-assist-autoselect-writeback tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
