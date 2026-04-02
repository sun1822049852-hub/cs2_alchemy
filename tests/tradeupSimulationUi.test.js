const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");

const requiredHtmlFragments = [
  'id="navSimulation"',
  'data-page="simulationPage"',
  'id="simulationPage"',
  'id="simulationModeSavedBtn"',
  'id="simulationModeWorkspaceBtn"',
  'id="simulationSavedPresets"',
  'id="simulationWorkspaceActionsBar"',
  'id="simulationSavePresetBtn"',
  'id="simulationCancelEditBtn"',
  'id="simulationLayout"',
  'id="simulationOutputPanel"',
  'id="simulationMaterialPanel"',
  'id="simulationOutputRoleChooser"',
  'id="simulationOutputRoleChooserText"',
  'id="simulationOutputRoleSplit"',
  'id="simulationMaterialRoleChooser"',
  'id="simulationMaterialRoleChooserText"',
  'id="simulationMaterialRoleSplit"',
  'id="simulationOutputLane"',
  'id="simulationMaterialLane"',
  'id="simulationPickerModal"',
  'id="simulationPickerTitle"',
  'id="simulationPickerRoleBadge"',
  'id="simulationPickerHint"',
  'id="simulationPickerMeta"',
  'id="simulationPickerSearchInput"',
  'id="simulationPickerSearchResults"',
  'id="simulationCardModal"',
  'id="simulationCardModalTitle"',
  'id="simulationCardModalBody"',
  'id="simulationCardModalWearInput"',
  'id="simulationCardModalSaveBtn"'
];

for (const fragment of requiredHtmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `tradeup simulation html should include fragment: ${fragment}`
  );
}

assert.match(
  html,
  /<div class="simulation-title-row">[\s\S]*<h1>汰换模拟<\/h1>[\s\S]*<div class="simulation-mode-tabs"/m,
  "tradeup simulation mode tabs should still sit beside the page title"
);

assert.doesNotMatch(
  html,
  /单工作台双模式，保存后可快速恢复到上次锚定状态/m,
  "tradeup simulation topbar should remove the redundant helper copy to keep the header compact"
);

assert.match(
  html,
  /<div id="simulationLayout" class="simulation-layout">[\s\S]*id="simulationOutputPanel"[\s\S]*id="simulationMaterialPanel"/m,
  "tradeup simulation workspace should render as a dual-pane layout"
);

assert.match(
  html,
  /id="simulationOutputRoleChooser"[\s\S]*主产物[\s\S]*辅产物/m,
  "tradeup simulation left pane should expose the hover split chooser for primary and auxiliary outputs"
);

assert.match(
  html,
  /id="simulationMaterialRoleChooser"[\s\S]*主料[\s\S]*辅料/m,
  "tradeup simulation right pane should expose the hover split chooser for main and auxiliary materials"
);

assert.match(
  html,
  /id="simulationPickerModal"[\s\S]*placeholder="搜索物品名称\s*\/\s*收藏品"/m,
  "tradeup simulation should use one shared picker modal for item search"
);

assert.match(
  html,
  /id="simulationPickerRoleBadge"[\s\S]*id="simulationPickerHint"[\s\S]*id="simulationPickerMeta"/m,
  "tradeup simulation picker should expose role context and search status hints"
);

assert.doesNotMatch(
  html,
  /封面永远锁定主产物|可从材料先推导主产物封面|产物列表|材料列表|后续查看与调整直接在下方产物列表卡片中完成|右侧直接展示当前封面产物对应的联动材料列表/m,
  "tradeup simulation workspace should remove the crossed helper copy and redundant lane headings"
);

assert.match(
  css,
  /#simulationPage\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*min-height:\s*calc\(100vh\s*-\s*32px\)/m,
  "tradeup simulation page should stretch to nearly the full viewport height"
);

assert.match(
  css,
  /\.simulation-header-main\s*\{[\s\S]*gap:\s*0;/m,
  "tradeup simulation header text stack should collapse its internal gap after removing the helper copy"
);

assert.match(
  css,
  /\.simulation-workspace-actions-bar\s*\{[\s\S]*min-height:\s*36px;/m,
  "tradeup simulation actions bar should tighten its vertical footprint after the helper copy is removed"
);

assert.doesNotMatch(
  html,
  /id="simulationTargetDropzone"/m,
  "tradeup simulation should remove the old single target dropzone"
);

assert.doesNotMatch(
  html,
  /id="simulationTargetPickerPanel"/m,
  "tradeup simulation should replace the inline picker panel with the shared modal"
);

assert.doesNotMatch(
  html,
  /id="simulationOutputRolePrimaryBtn"|id="simulationOutputRoleAuxBtn"|id="simulationMaterialRoleMainBtn"|id="simulationMaterialRoleAuxBtn"/m,
  "tradeup simulation should remove the old segmented role buttons"
);

assert.doesNotMatch(
  html,
  /id="simulationPrimaryOutputSlot"|id="simulationAuxOutputSlot"|id="simulationMainMaterialSlot"|id="simulationAuxMaterialSlot"/m,
  "tradeup simulation should remove the redundant top role slots"
);

assert.match(
  html,
  /<section class="page hidden" id="simulationPage">/m,
  "tradeup simulation should remain a standalone top-level page section"
);

const requiredAppFragments = [
  'simulationLayout: document.getElementById("simulationLayout")',
  'simulationOutputPanel: document.getElementById("simulationOutputPanel")',
  'simulationMaterialPanel: document.getElementById("simulationMaterialPanel")',
  'simulationOutputRoleChooser: document.getElementById("simulationOutputRoleChooser")',
  'simulationOutputRoleChooserText: document.getElementById("simulationOutputRoleChooserText")',
  'simulationOutputRoleSplit: document.getElementById("simulationOutputRoleSplit")',
  'simulationMaterialRoleChooser: document.getElementById("simulationMaterialRoleChooser")',
  'simulationMaterialRoleChooserText: document.getElementById("simulationMaterialRoleChooserText")',
  'simulationMaterialRoleSplit: document.getElementById("simulationMaterialRoleSplit")',
  'simulationPickerModal: document.getElementById("simulationPickerModal")',
  'simulationPickerTitle: document.getElementById("simulationPickerTitle")',
  'simulationPickerRoleBadge: document.getElementById("simulationPickerRoleBadge")',
  'simulationPickerHint: document.getElementById("simulationPickerHint")',
  'simulationPickerMeta: document.getElementById("simulationPickerMeta")',
  'simulationPickerSearchInput: document.getElementById("simulationPickerSearchInput")',
  'simulationPickerSearchResults: document.getElementById("simulationPickerSearchResults")',
  'simulationOutputRole: "primary_output"',
  'simulationMaterialRole: "main_material"',
  'simulationOutputChooserOpen: false',
  'simulationMaterialChooserOpen: false',
  'simulationPickerMode: ""',
  'simulationPickerError: ""',
  "function renderSimulationModeTabs(",
  "function renderSimulationSavedPresets(",
  "function renderSimulationWorkspaceActionsBar(",
  "function renderSimulationRoleChoosers(",
  "function renderSimulationRolePanel(",
  "function setTradeupSimulationRoleChooserOpen(",
  "function openTradeupSimulationPickerModal(",
  "function closeTradeupSimulationPickerModal(",
  "function renderTradeupSimulationPickerModal(",
  "function applyTradeupSimulationSlotSelection(",
  "function adoptTradeupSimulationDerivedPrimaryOutput(",
  "function selectTradeupSimulationPreset(",
  "function openBlankTradeupSimulationWorkspaceDraft(",
  "simulation-picker-item-thumb"
];

for (const fragment of requiredAppFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `tradeup simulation app should include fragment: ${fragment}`
  );
}

assert.match(
  app,
  /card\.ondblclick\s*=\s*\(\)\s*=>\s*\{/m,
  "tradeup simulation saved presets should still enter workspace editing on double click"
);

assert.match(
  app,
  /ui\.simulationModeWorkspaceBtn\.onclick\s*=\s*\(\)\s*=>\s*\{\s*openBlankTradeupSimulationWorkspaceDraft\(\);/m,
  "tradeup simulation workspace tab should still open a blank draft"
);

assert.match(
  app,
  /ui\.simulationSavePresetBtn\.disabled\s*=\s*!preset\s*\|\|\s*!\(preset\.primary_output\s*\|\|\s*preset\.cover_output\)\s*\|\|/m,
  "tradeup simulation save button should stay disabled until the workspace has a main cover output"
);

assert.match(
  app,
  /<button class="simulation-saved-remove-btn"[\s\S]*data-simulation-delete-preset-id="\$\{String\(preset && preset\.id \|\| ""\)\.trim\(\)\}"/m,
  "tradeup simulation saved cards should expose the dedicated delete button in the top-right corner"
);

assert.match(
  app,
  /<span class="simulation-card-wear-badge">\$\{summary\.wearLabel\}<\/span>/m,
  "tradeup simulation saved cards should surface the item's wear tier badge in the top-left corner"
);

assert.match(
  app,
  /function getTradeupSimulationWearBadgeToneClass\(/m,
  "tradeup simulation should expose a dedicated wear tone helper for card badges"
);

assert.match(
  app,
  /simulation-card-wear-badge\$\{wearToneClass\}/m,
  "tradeup simulation cards should apply wear tone classes to the wear badge text"
);

assert.match(
  app,
  /<div class="simulation-card-meta">相对磨损：\$\{summary\.relativeWear\}<\/div>/m,
  "tradeup simulation saved cards should rename anchor wear to relative wear"
);

assert.match(
  app,
  /openConfirmModal\(\{[\s\S]*title:\s*"确认删除配方"[\s\S]*message:\s*"确定要删除该配方吗？"[\s\S]*confirmText:\s*"确认删除"[\s\S]*cancelText:\s*"取消"[\s\S]*\}\)/m,
  "tradeup simulation saved-card deletion should use the in-app confirmation modal with the approved copy"
);

assert.doesNotMatch(
  app,
  /simulationTargetDropzone/m,
  "tradeup simulation app should remove the old single target selector wiring"
);

assert.doesNotMatch(
  app,
  /simulationOutputRolePrimaryBtn|simulationOutputRoleAuxBtn|simulationMaterialRoleMainBtn|simulationMaterialRoleAuxBtn/m,
  "tradeup simulation app should remove the old segmented role button wiring"
);

assert.doesNotMatch(
  app,
  /simulationPrimaryOutputSlot|simulationAuxOutputSlot|simulationMainMaterialSlot|simulationAuxMaterialSlot|renderSimulationRoleSlots/m,
  "tradeup simulation app should remove the redundant top role slot wiring"
);

assert.doesNotMatch(
  app,
  /<div class="simulation-card-role">已保存配方<\/div>|当前锚定：|锚定磨损：/m,
  "tradeup simulation saved cards should remove the old saved-preset and current-anchor copy"
);

assert.doesNotMatch(
  app,
  /<div class="simulation-card-modal-line"><span>卡片类型<\/span>|<div class="simulation-card-modal-line"><span>操作模式<\/span>/m,
  "tradeup simulation item modal should remove the old card-type and operation-mode rows"
);

assert.match(
  app,
  /function\s+resolveTradeupSimulationChooserSlot\(/m,
  "tradeup simulation should resolve role chooser clicks from the actual left or right hover target"
);

assert.match(
  app,
  /ui\.simulationOutputRoleChooser\.onclick\s*=\s*\(evt\)\s*=>\s*\{[\s\S]*resolveTradeupSimulationChooserSlot\([\s\S]*"output"[\s\S]*getTradeupSimulationPreferredSlot\("output"/m,
  "tradeup simulation output chooser should derive the selected slot from either the stable hover target or the next empty preferred output slot"
);

assert.match(
  app,
  /ui\.simulationMaterialRoleChooser\.onclick\s*=\s*\(evt\)\s*=>\s*\{[\s\S]*resolveTradeupSimulationChooserSlot\([\s\S]*"material"[\s\S]*getTradeupSimulationPreferredSlot\("material"/m,
  "tradeup simulation material chooser should derive the selected slot from either the stable hover target or the next empty preferred material slot"
);

assert.match(
  app,
  /function\s+getTradeupSimulationPreferredSlot\(/m,
  "tradeup simulation should compute the next empty preferred slot before opening the picker"
);

assert.match(
  app,
  /state\.simulationPickerQuery\s*=\s*"";\s*state\.simulationPickerResults\s*=\s*\[\];\s*state\.simulationPickerError\s*=\s*"";\s*state\.simulationSearchLoading\s*=\s*false;/m,
  "tradeup simulation picker should start from a clean search state whenever it opens"
);

assert.match(
  app,
  /state\.simulationPickerError\s*=\s*String\(err && err\.message \|\| err \|\| "未知错误"\)\.trim\(\);\s*renderTradeupSimulationPickerModal\(\);/m,
  "tradeup simulation picker failure state should flow through the unified modal renderer"
);

assert.doesNotMatch(
  app,
  /已选\s+\$\{outputCount\}\/2|已选\s+\$\{materialCount\}\/2/m,
  "tradeup simulation chooser copy should stop surfacing ambiguous x/2 counters"
);

assert.doesNotMatch(
  app,
  /if\s*\(ui\.simulationPickerSearchResults\)\s*\{\s*ui\.simulationPickerSearchResults\.innerHTML\s*=\s*`<div class="simulation-row-empty">搜索失败：/m,
  "tradeup simulation picker should not bypass unified rendering for search failure content"
);

assert.match(
  app,
  /function renderSimulationSelectedOutputCard\(/m,
  "tradeup simulation workspace should render selected output cards inside the lane when only direct slot picks exist"
);

assert.match(
  app,
  /function renderSimulationSelectedMaterialCard\(/m,
  "tradeup simulation workspace should render selected material cards inside the lane when only direct slot picks exist"
);

assert.match(
  css,
  /\.simulation-card-art::before\s*\{[\s\S]*background:\s*var\(--simulation-card-rarity-color,\s*#7d43ff\)/m,
  "tradeup simulation card rarity stripes should come from each item's rarity color variable"
);

assert.match(
  css,
  /\.simulation-card-art\.has-image::after\s*\{[\s\S]*background-position:\s*center 58%;[\s\S]*background-size:\s*contain;/m,
  "tradeup simulation cards should keep the full weapon image while nudging it slightly downward inside the compact card"
);

assert.match(
  css,
  /\.simulation-output-card\s+\.simulation-card-art,\s*\.simulation-material-card\s+\.simulation-card-art\s*\{[\s\S]*height:\s*120px;/m,
  "tradeup simulation output and material cards should enlarge the art area so the weapon can sit lower inside the card"
);

assert.match(
  css,
  /\.simulation-output-card\s+\.simulation-card-art\.has-image::after,\s*\.simulation-material-card\s+\.simulation-card-art\.has-image::after\s*\{[\s\S]*background-position:\s*center 70%;/m,
  "tradeup simulation output and material cards should push the weapon image visibly downward"
);

assert.match(
  css,
  /\.simulation-output-card\s+\.simulation-card-content,\s*\.simulation-material-card\s+\.simulation-card-content\s*\{[\s\S]*margin-top:\s*-24px;[\s\S]*background:\s*rgba\(0,\s*0,\s*0,\s*0\.15\);/m,
  "tradeup simulation output and material card captions should overlap the lower art area using a uniform 0.15 black mask"
);

assert.doesNotMatch(
  css,
  /\.simulation-anchor-active\s+\.simulation-card-art::before\s*\{[\s\S]*background:\s*#f0af31/m,
  "tradeup simulation anchor highlighting should not overwrite the card rarity stripe color"
);

assert.match(
  app,
  /<div class="simulation-card-grid\$\{cardCount === 1 \? " is-single-card" : ""\}">/m,
  "tradeup simulation lanes should mark single-card rows so a lone selected output keeps its fixed card width"
);

const requiredCssFragments = [
  ".simulation-title-row {",
  ".simulation-mode-tabs {",
  ".simulation-layout {",
  ".simulation-role-pane {",
  ".simulation-role-pane-head {",
  ".simulation-role-chooser {",
  ".simulation-role-chooser.split {",
  ".simulation-role-split {",
  ".simulation-pane-section {",
  ".simulation-output-lane {",
  ".simulation-material-lane {",
  ".simulation-card-grid.is-single-card {",
  ".simulation-picker-modal-card {",
  ".simulation-picker-context {",
  ".simulation-picker-role-badge {",
  ".simulation-picker-meta {",
  ".simulation-picker-results {",
  ".simulation-picker-item-thumb {",
  ".simulation-card-button {",
  ".simulation-saved-remove-btn {",
  ".simulation-card-art.has-image::after {",
  "body.theme-inkblue #simulationPage"
];

for (const fragment of requiredCssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `tradeup simulation css should include fragment: ${fragment}`
  );
}

assert.match(
  css,
  /\.hidden\s*\{[\s\S]*display:\s*none\s*!important;/m,
  "generic hidden utility must still win over later simulation display rules"
);

assert.match(
  css,
  /\.simulation-layout\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s+minmax\(320px,\s*0\.92fr\);/m,
  "tradeup simulation workspace should use the approved left-output and right-material split"
);

assert.match(
  css,
  /\.simulation-role-chooser\s*\{[\s\S]*border:\s*2px dashed[\s\S]*overflow:\s*hidden;/m,
  "tradeup simulation role chooser should render as a dashed hover-split placeholder"
);

assert.match(
  css,
  /\.simulation-role-chooser:hover\s+\.simulation-role-chooser-text[\s\S]*opacity:\s*0;/m,
  "tradeup simulation hover split should remain visible from CSS hover without relying on JS-only mouseenter state"
);

assert.match(
  css,
  /\.simulation-role-split\.hidden\s*\{[\s\S]*display:\s*grid\s*!important;/m,
  "tradeup simulation split overlay should stay structurally present while hidden so hover reveal remains stable"
);

assert.match(
  css,
  /\.simulation-picker-modal-card\s*\{[\s\S]*width:\s*min\(640px,\s*calc\(100vw\s*-\s*48px\)\);/m,
  "tradeup simulation picker modal should become narrower"
);

assert.match(
  css,
  /\.modal-card\.simulation-card-modal-card\s*\{[\s\S]*width:\s*min\(408px,\s*calc\(100vw\s*-\s*32px\)\);/m,
  "tradeup simulation item modal should double back to the approved portrait width while still overriding the generic modal-card width"
);

assert.match(
  css,
  /\.simulation-card-modal-preview\s+\.simulation-card-art\s*\{[\s\S]*height:\s*252px;/m,
  "tradeup simulation item modal should use a taller portrait preview art area"
);

assert.match(
  css,
  /\.simulation-card-modal-preview\s+\.simulation-card-art\.has-image::after\s*\{[\s\S]*background-position:\s*center center;[\s\S]*background-size:\s*contain;/m,
  "tradeup simulation item modal should render the full weapon image without clipping the upper half"
);

assert.match(
  css,
  /\.simulation-card-modal-preview\s+\.simulation-card-content\s*\{[\s\S]*padding:\s*12px\s+12px\s+14px;/m,
  "tradeup simulation item modal should tighten content spacing for the portrait layout"
);

assert.match(
  css,
  /\.simulation-picker-item\s*\{[\s\S]*height:\s*auto;[\s\S]*min-height:\s*0;/m,
  "tradeup simulation picker result rows should override the global button height so thumbnails remain visible"
);

assert.match(
  css,
  /\.simulation-picker-results\s*\{[\s\S]*max-height:\s*min\(72vh,\s*560px\);/m,
  "tradeup simulation picker results should become taller"
);

assert.match(
  css,
  /\.simulation-picker-results\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*min-height:\s*0;[^}]*\}/m,
  "tradeup simulation picker results should own the remaining modal height as a flexible scroll region"
);

assert.doesNotMatch(
  css,
  /\.simulation-target-dropzone\s*\{/m,
  "tradeup simulation css should remove the old target dropzone styles"
);

assert.doesNotMatch(
  css,
  /\.simulation-role-tabs\s*\{/m,
  "tradeup simulation css should remove the old segmented role tab styling"
);

assert.doesNotMatch(
  css,
  /\.simulation-selection-grid\s*\{|\.simulation-selection-card\s*\{/m,
  "tradeup simulation css should remove the duplicated inline slot card styling"
);

assert.doesNotMatch(
  css,
  /\.simulation-slot-grid\s*\{|\.simulation-role-slot\s*\{/m,
  "tradeup simulation css should remove the redundant top role slot styling"
);

console.log("tradeupSimulationUi tests passed");
