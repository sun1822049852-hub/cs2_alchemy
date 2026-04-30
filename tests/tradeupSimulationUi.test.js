const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");

function sliceRequired(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `expected source to include start token: ${startToken}`);
  const end = source.indexOf(endToken, start);
  assert.notEqual(end, -1, `expected source to include end token after ${startToken}: ${endToken}`);
  return source.slice(start, end);
}

const simulationPageHtml = sliceRequired(
  html,
  '<section class="page hidden" id="simulationPage">',
  '<div id="simulationPickerModal"'
);

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

assert.match(
  css,
  /\.simulation-picker-context\s*\{[^}]*display:\s*none;[^}]*\}/m,
  "tradeup simulation picker should visually remove the old role-context block so the search bar can sit directly under the modal header"
);

assert.match(
  css,
  /#simulationPickerModal\s+\.simulation-picker-modal-card\s*\{[^}]*gap:\s*10px;[^}]*\}/m,
  "tradeup simulation picker modal should tighten its internal gap after removing the top context block"
);

assert.doesNotMatch(
  simulationPageHtml,
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

assert.match(
  css,
  /#simulationPage\s*\{[\s\S]*gap:\s*10px;/m,
  "tradeup simulation page should pull the workspace closer to the topbar for a tighter overall layout"
);

assert.match(
  css,
  /\.simulation-topbar\s*\{[\s\S]*padding:\s*10px 16px;/m,
  "tradeup simulation topbar should trim excess padding so the lower workspace can sit higher"
);

assert.match(
  css,
  /\.simulation-mode-tabs button\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*height:\s*38px;[\s\S]*padding:\s*0 16px;[\s\S]*text-align:\s*center;/m,
  "tradeup simulation mode-tab labels should use an explicit flex-centered button box so the text stays visually centered inside the pill"
);

assert.match(
  css,
  /\.simulation-shell\s*\{[\s\S]*gap:\s*12px;[\s\S]*padding:\s*12px;/m,
  "tradeup simulation shell should reduce outer spacing to keep the page compact"
);

assert.match(
  css,
  /\.simulation-layout\s*\{[\s\S]*gap:\s*14px;/m,
  "tradeup simulation dual-pane workspace should reduce inter-pane spacing"
);

assert.match(
  css,
  /\.simulation-role-pane\s*\{[\s\S]*gap:\s*10px;[\s\S]*padding:\s*14px;/m,
  "tradeup simulation role panes should use tighter padding so the content starts closer to the top edge"
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
  "function openTradeupSimulationWorkspaceDraft(",
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
  /ui\.simulationModeWorkspaceBtn\.onclick\s*=\s*\(\)\s*=>\s*\{\s*openTradeupSimulationWorkspaceDraft\(\);/m,
  "tradeup simulation workspace tab should reopen the in-progress draft instead of always clearing it to blank"
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
  /renderTradeupSimulationSelectionStyleCard\(\{[\s\S]*wearLabel:\s*summary\.wearLabel[\s\S]*wearToneClass:\s*summary\.wearToneClass/m,
  "tradeup simulation saved cards should pass the saved summary wear tier into the shared card renderer so the top-left badge keeps the same tier label and tone"
);

assert.match(
  css,
  /\.simulation-saved-card\s+\.simulation-card-wear-badge\s*\{[\s\S]*top:\s*8px;[\s\S]*left:\s*12px;[\s\S]*z-index:\s*4;/m,
  "tradeup simulation saved cards should pin the wear tier badge into the artwork top-left corner instead of letting it drift into the lower wear overlay area"
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
  /function renderTradeupSimulationSelectionStyleCard\(/m,
  "tradeup simulation should expose a shared selection-style card renderer so saved cards can reuse the same visual shell as the selection page"
);

assert.match(
  app,
  /function renderSimulationSavedPresets\(\)\s*\{[\s\S]*renderTradeupSimulationSelectionStyleCard\(\{[\s\S]*titleText:\s*summary\.presetName[\s\S]*summary\.collectionText[\s\S]*extraClasses:\s*`simulation-saved-card[\s\S]*extraArtHtml:\s*`[\s\S]*simulation-saved-export-btn[\s\S]*simulation-saved-remove-btn/m,
  "tradeup simulation saved cards should reuse the shared selection-style renderer while only injecting preset-specific title, collection text, export action, and delete action"
);

assert.match(
  app,
  /async function saveActiveTradeupSimulationPreset\(/m,
  "tradeup simulation should expose a dedicated save helper that can request the preset name before persisting"
);

assert.match(
  app,
  /ui\.simulationSavePresetBtn\.onclick\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]*await saveActiveTradeupSimulationPreset\(\);/m,
  "tradeup simulation save button should route through the preset-name prompt helper instead of persisting immediately"
);

assert.doesNotMatch(
  app,
  /<div class="simulation-saved-anchor-name">[\s\S]*<div class="simulation-card-meta">相对磨损：\$\{summary\.relativeWear\}<\/div>|<div class="simulation-card-tag-row">[\s\S]*simulation-saved-body|simulation-saved-collection/m,
  "tradeup simulation saved cards should stop maintaining their own lower-body markup and instead rely on the shared selection-page card skeleton"
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

assert.match(
  app,
  /最低级物品不能作为产物添加/m,
  "tradeup simulation output picker should explicitly warn that the lowest collection rarity cannot be added as an output"
);

assert.match(
  app,
  /function getTradeupSimulationOutputRestrictionMessage\(/m,
  "tradeup simulation picker should expose a dedicated helper for blocking lowest-rarity collection items from output slots"
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
  app,
  /<div class="simulation-card-wear-stack\$\{wearToneClass\}">[\s\S]*<div class="simulation-card-float">\$\{wearText\}<\/div>[\s\S]*<div class="simulation-card-bar\$\{wearToneClass\}"/m,
  "tradeup simulation cards should carry the wear tone class into the wear stack and bar so each wear tier can style the bar itself"
);

assert.match(
  app,
  /function renderSimulationOutputCard\(output,\s*preset,\s*rowIndex,\s*itemIndex\)\s*\{[\s\S]*<div class="simulation-card-art\$\{artUrl \? " has-image" : ""\}"\$\{artStyleAttr\}>[\s\S]*\$\{renderTradeupSimulationWearStack\(wearValue,\s*wearText,\s*wearToneClass\)\}[\s\S]*<\/div>\s*<div class="simulation-card-content">\s*<div class="simulation-card-name">/m,
  "tradeup simulation output cards should move the wear overlay into the artwork block so the name area no longer needs a full-width black mask"
);

assert.match(
  app,
  /function renderSimulationMaterialCard\(material,\s*rowIndex,\s*itemIndex\)\s*\{[\s\S]*<div class="simulation-card-art\$\{artUrl \? " has-image" : ""\}"\$\{artStyleAttr\}>[\s\S]*\$\{renderTradeupSimulationWearStack\(wearValue,\s*wearText,\s*wearToneClass\)\}[\s\S]*<\/div>\s*<div class="simulation-card-content">\s*<div class="simulation-card-name">/m,
  "tradeup simulation derived material cards should also keep the wear overlay inside the artwork block instead of rebuilding the old lower black band"
);

assert.match(
  app,
  /function renderSimulationSelectedOutputCard\(output,\s*preset,\s*slotName\)\s*\{[\s\S]*return renderTradeupSimulationSelectionStyleCard\(/m,
  "tradeup simulation selected output cards should route through the shared selection-style renderer"
);

assert.match(
  app,
  /function renderSimulationSelectedMaterialCard\(material,\s*preset,\s*slotName\)\s*\{[\s\S]*return renderTradeupSimulationSelectionStyleCard\(/m,
  "tradeup simulation selected material cards should also route through the shared selection-style renderer"
);

assert.match(
  css,
  /\.simulation-card-art::before\s*\{[\s\S]*left:\s*8px;[\s\S]*background:\s*var\(--simulation-card-rarity-color,\s*#7d43ff\)/m,
  "tradeup simulation default card rarity stripes should keep their original inset offset while still following each item's rarity color"
);

assert.match(
  css,
  /\.simulation-output-card\s*\{[\s\S]*border-radius:\s*8px;[\s\S]*\}\s*[\s\S]*\.simulation-material-card\s*\{[\s\S]*border-radius:\s*8px;/m,
  "tradeup simulation output and material cards should keep shaving down the outer corner radius for a tighter silhouette"
);

assert.match(
  css,
  /\.simulation-output-card\s+\.simulation-card-art::before,\s*\.simulation-material-card\s+\.simulation-card-art::before\s*\{[\s\S]*left:\s*0;[\s\S]*bottom:\s*8px;[\s\S]*width:\s*5px;/m,
  "tradeup simulation output and material rarity stripes should stop at the thin wear bar instead of reserving the old full black band"
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
  /\.simulation-card-wear-badge\.tone-fn\s*\{[\s\S]*color:\s*#e6a5ff;/m,
  "tradeup simulation factory-new wear badges should switch to a pink-violet tone so they are easier to distinguish from minimal wear"
);

assert.match(
  css,
  /\.simulation-card-wear-badge\.tone-mw\s*\{[\s\S]*color:\s*#8fdd7a;/m,
  "tradeup simulation minimal-wear badges should stay green and must not be recolored pink with factory new"
);

assert.match(
  css,
  /\.simulation-card-bar\s*\{[\s\S]*background:\s*linear-gradient\(90deg,\s*#e6a5ff 0 7%,\s*#4aa84e 7% 15%,\s*#d1a746 15% 38%,\s*#c98a45 38% 45%,\s*#d56752 45% 100%\);/m,
  "tradeup simulation wear bars should split the bottom range by real wear tiers so factory new and minimal wear no longer share the same color band"
);

assert.match(
  css,
  /\.simulation-card-bar\.tone-fn\s*>\s*span\s*\{[\s\S]*background:\s*#f0b0ff;[\s\S]*opacity:\s*0\.38;[\s\S]*min-width:\s*2px;/m,
  "tradeup simulation factory-new wear bars should keep a pink-violet fill accent for quick recognition"
);

assert.match(
  css,
  /\.simulation-card-bar\.tone-fn::after\s*\{[\s\S]*border-top-color:\s*#f0b0ff;/m,
  "tradeup simulation factory-new wear markers should also shift to pink-violet for quick recognition"
);

assert.match(
  css,
  /\.simulation-card-bar\s*\{[\s\S]*#e6a5ff 0 7%,\s*#4aa84e 7% 15%/m,
  "tradeup simulation minimal-wear bars should keep their original green segment while factory new gets its own pink-violet segment ahead of it"
);

assert.match(
  css,
  /\.simulation-output-card\s+\.simulation-card-content,\s*\.simulation-material-card\s+\.simulation-card-content\s*\{[\s\S]*margin-top:\s*0;[\s\S]*background:\s*none;[\s\S]*gap:\s*4px;[\s\S]*padding:\s*8px 10px 10px;/m,
  "tradeup simulation output and material card captions should return to a clean text block below the artwork after the wear overlay moves into the image area"
);

assert.match(
  css,
  /\.simulation-card-name\s*\{[\s\S]*font-weight:\s*600;[\s\S]*letter-spacing:\s*0\.01em;[\s\S]*line-height:\s*1\.2;/m,
  "tradeup simulation weapon names should soften the typography with a lighter weight and cleaner spacing"
);

assert.match(
  css,
  /\.simulation-picker-item\.is-disabled,\s*\.simulation-picker-item:disabled\s*\{[\s\S]*cursor:\s*not-allowed;[\s\S]*opacity:\s*0\.72;/m,
  "tradeup simulation picker should visibly disable lowest-rarity output candidates so they do not look selectable"
);

assert.match(
  css,
  /\.simulation-picker-item-warning\s*\{[\s\S]*border-top:[\s\S]*background:[\s\S]*text-align:\s*left;/m,
  "tradeup simulation picker should render blocked warnings inside a dedicated footer block"
);

assert.match(
  css,
  /body\.theme-inkblue #simulationPage :is\(#simulationCancelEditBtn:hover,\s*\.simulation-picker-item:not\(\.is-disabled\):not\(:disabled\):hover\)\s*\{/m,
  "tradeup simulation inkblue hover styling should exclude disabled picker cards so blocked candidates never light up on hover"
);

assert.match(
  css,
  /\.simulation-picker-art-warning\s*\{[\s\S]*color:\s*#ffbf70;[\s\S]*white-space:\s*normal;/m,
  "tradeup simulation picker should render a wrapped amber warning for blocked candidates"
);

assert.match(
  css,
  /\.simulation-output-card\s+\.simulation-card-wear-stack,\s*\.simulation-material-card\s+\.simulation-card-wear-stack\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*0;[\s\S]*height:\s*18px;[\s\S]*background:\s*none;[\s\S]*background-color:\s*transparent;/m,
  "tradeup simulation compact cards should anchor the wear overlay to the artwork bottom instead of rendering a full-width black strip below the image"
);

assert.match(
  css,
  /\.simulation-output-card\s+\.simulation-card-bar,\s*\.simulation-material-card\s+\.simulation-card-bar\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*0;[\s\S]*border-radius:\s*0;/m,
  "tradeup simulation compact cards should pin the wear bar to the artwork bottom as a thin rectangular strip"
);

assert.match(
  css,
  /\.simulation-output-card\s+\.simulation-card-float,\s*\.simulation-material-card\s+\.simulation-card-float\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*5px;[\s\S]*right:\s*auto;[\s\S]*bottom:\s*8px;[\s\S]*padding:\s*0 4px;[\s\S]*background:\s*rgba\(0,\s*0,\s*0,\s*0\.9\);[\s\S]*font-size:\s*12px;[\s\S]*line-height:\s*1;/m,
  "tradeup simulation compact cards should dock the black wear chip into the bottom-left 90-degree corner formed by the rarity stripe and the wear bar"
);

assert.doesNotMatch(
  css,
  /\.simulation-card-wear-stack::(?:before|after)\s*\{/m,
  "tradeup simulation wear stacks should not grow pseudo-element overlays that could silently recreate the old full-width black strip"
);

assert.doesNotMatch(
  css,
  /\.simulation-card-float::(?:before|after)\s*\{/m,
  "tradeup simulation wear chips should not grow pseudo-element overlays that could silently recreate a full-width black strip"
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

assert.match(
  app,
  /<button class="simulation-picker-item\$\{disabled \? " is-disabled" : ""\}" type="button" data-simulation-pick-index="\$\{index\}"\$\{rarityStyleAttr\}\$\{disabledAttr\}>[\s\S]*simulation-picker-item-warning[\s\S]*simulation-picker-art-warning/m,
  "tradeup simulation picker results should mark blocked candidates as disabled and render the warning in the card footer"
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
  app,
  /<div class="simulation-card-modal-preview">[\s\S]*<div class="simulation-card-art\$\{artUrl \? " has-image" : ""\}"\$\{artStyleAttr\}>[\s\S]*<div class="simulation-card-float">绝对磨损\s+\$\{wearText\}<\/div>[\s\S]*<\/div>\s*<div class="simulation-card-content">[\s\S]*<div class="simulation-card-bar\$\{wearToneClass\}"/m,
  "tradeup simulation item modal should intentionally keep its portrait preview split layout instead of reusing the workspace overlay structure"
);

assert.doesNotMatch(
  app,
  /<div class="simulation-card-modal-preview">[\s\S]*renderTradeupSimulationWearStack/m,
  "tradeup simulation item modal should remain an explicit preview exception and must not silently start sharing the workspace wear overlay helper"
);

assert.match(
  css,
  /\.simulation-picker-item\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*236px;[^}]*\}/m,
  "tradeup simulation picker result rows should keep a dedicated tall card height so thumbnails remain visible"
);

assert.match(
  css,
  /\.simulation-picker-results\s*\{[^}]*max-height:\s*min\(72vh,\s*560px\);[^}]*\}/m,
  "tradeup simulation picker results should become taller"
);

assert.match(
  css,
  /\.simulation-picker-results\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*min-height:\s*0;[^}]*\}/m,
  "tradeup simulation picker results should own the remaining modal height as a flexible scroll region"
);

assert.match(
  css,
  /\.simulation-picker-item-thumb\s*\{[^}]*max-height:\s*148px;[^}]*object-position:\s*center center;[^}]*clip-path:\s*inset\(5%\s+6%\s+5%\s+6%\);[^}]*transform:\s*translateY\(2px\)\s+scale\(1\.18\);[^}]*\}/m,
  "tradeup simulation picker thumbnails should stop over-cropping the art so the full item image stays visible"
);

assert.match(
  css,
  /\.simulation-picker-item-art\s*\{[^}]*align-items:\s*flex-start;[^}]*padding:\s*18px\s+14px\s+10px;[^}]*\}/m,
  "tradeup simulation picker art area should pull the image upward to remove the oversized empty top band"
);

assert.match(
  css,
  /\.simulation-picker-art-mask\s*\{[^}]*top:\s*75%;[^}]*\}/m,
  "tradeup simulation picker artwork mask should cover only the lower quarter of the card"
);

assert.match(
  css,
  /\.simulation-picker-item-thumb\.is-wide\s*\{[^}]*transform:\s*translateY\(10px\)\s+scale\(1\.3\);[^}]*transform-origin:\s*center top;[^}]*\}/m,
  "tradeup simulation picker should give wide weapon thumbnails a stronger downward scale so the middle gap disappears"
);

assert.match(
  app,
  /const handlePickerThumbError = \(thumb\) => \{[\s\S]*thumb\.onerror = \(\) => \{[\s\S]*handlePickerThumbError\(thumb\);[\s\S]*if \(thumb\.complete\) \{[\s\S]*applyPickerThumbLayout\(thumb\);[\s\S]*handlePickerThumbError\(thumb\);[\s\S]*\}/m,
  "tradeup simulation picker should handle both cached-success and cached-failure thumbnail states after binding image events"
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
