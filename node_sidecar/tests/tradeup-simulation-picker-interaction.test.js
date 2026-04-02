const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawn} = require("node:child_process");
const {createServer} = require("../src/uiServer");

const BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findBrowserPath() {
  return BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || "";
}

async function waitForJson(url, {timeoutMs = 15000, intervalMs = 200} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
    } catch (_) {
      // keep polling
    }
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for json: ${url}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.seq = 0;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        this.socket.removeEventListener("open", onOpen);
        this.socket.removeEventListener("error", onError);
      };
      this.socket.addEventListener("open", onOpen);
      this.socket.addEventListener("error", onError);
    });

    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id || !this.pending.has(payload.id)) return;
      const {resolve, reject} = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      else resolve(payload.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.socket.send(JSON.stringify({id, method, params}));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    return result && result.result ? result.result.value : undefined;
  }

  close() {
    try {
      this.socket.close();
    } catch (_) {
      // ignore close failures
    }
  }
}

async function waitForCondition(cdp, expression, {timeoutMs = 15000, intervalMs = 100} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const matched = await cdp.evaluate(`(() => { try { return !!(${expression}); } catch (_) { return false; } })()`);
    if (matched) return true;
    await sleep(intervalMs);
  }
  throw new Error(`waitForCondition timeout: ${expression}`);
}

async function removeDirWithRetries(targetPath, {attempts = 6, delayMs = 250} = {}) {
  if (!targetPath) return;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, {recursive: true, force: true});
      return;
    } catch (err) {
      lastError = err;
      if (!err || (err.code !== "EPERM" && err.code !== "EBUSY" && err.code !== "ENOTEMPTY")) {
        throw err;
      }
      await sleep(delayMs);
    }
  }
  if (lastError) throw lastError;
}

async function withBrowserPage(run) {
  const browserPath = findBrowserPath();
  if (!browserPath) {
    console.log("tradeup-simulation-picker-interaction skipped: no browser found");
    return;
  }

  const server = createServer();
  let browser = null;
  let cdp = null;
  let userDataDir = "";
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 8787;
    const appUrl = `http://127.0.0.1:${port}`;
    const debugPort = 9200 + Math.floor(Math.random() * 400);
    userDataDir = path.resolve(
      __dirname,
      "..",
      "..",
      "tmp",
      "edge-headless-profile",
      `simulation-picker-test-${process.pid}-${Date.now()}`
    );
    fs.mkdirSync(userDataDir, {recursive: true});

    browser = spawn(browserPath, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank"
    ], {
      stdio: ["ignore", "ignore", "ignore"]
    });

    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const pageTarget = (Array.isArray(targets) ? targets : []).find((target) => target.type === "page");
    assert.ok(pageTarget && pageTarget.webSocketDebuggerUrl, "expected browser page target");

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Page.navigate", {url: appUrl});

    await waitForCondition(cdp, `document.readyState === "complete"`);
    await waitForCondition(cdp, `document.getElementById("navSimulation") && document.getElementById("simulationPage")`);
    await sleep(1200);

    await run({cdp});
  } finally {
    if (cdp) cdp.close();
    if (browser && !browser.killed) {
      browser.kill();
      await new Promise((resolve) => browser.once("close", resolve));
    }
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (userDataDir) {
      await removeDirWithRetries(userDataDir);
    }
  }
}

async function test_clicking_output_chooser_opens_picker_without_inline_slot_cards() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationOutputRoleChooser")`);
    await sleep(300);

    const chooserState = await cdp.evaluate(`(() => {
      const duplicatedSlots = document.querySelectorAll('[data-simulation-slot-name]');
      const chooser = document.getElementById('simulationOutputRoleChooser');
      if (!chooser) return null;
      const rect = chooser.getBoundingClientRect();
      return {
        duplicatedSlotCount: duplicatedSlots.length,
        clickX: rect.left + rect.width * 0.25,
        clickY: rect.top + rect.height / 2
      };
    })()`);
    assert.ok(chooserState, "expected output chooser");
    assert.equal(chooserState.duplicatedSlotCount, 0, "expected duplicated inline slot cards to be removed");

    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: chooserState.clickX,
      y: chooserState.clickY,
      button: "left",
      buttons: 1
    });
    await sleep(150);
    const hoverState = await cdp.evaluate(`(() => {
      const chooser = document.getElementById('simulationOutputRoleChooser');
      const split = document.getElementById('simulationOutputRoleSplit');
      return {
        splitVisible: !!(split && getComputedStyle(split).visibility !== 'hidden' && Number.parseFloat(getComputedStyle(split).opacity) > 0.2),
        activeSlot: chooser ? String(chooser.dataset.activeSlot || '').trim() : ''
      };
    })()`);
    assert.equal(hoverState && hoverState.splitVisible, true, "output chooser hover should keep the left/right split affordance visible before click");
    assert.equal(hoverState && hoverState.activeSlot, "primary_output", "output chooser hover should keep the currently hovered left half explicitly marked as the active slot");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: chooserState.clickX + 120,
      y: chooserState.clickY,
      button: "left",
      buttons: 1
    });
    await sleep(150);
    const hoverAuxState = await cdp.evaluate(`(() => {
      const chooser = document.getElementById('simulationOutputRoleChooser');
      return chooser ? String(chooser.dataset.activeSlot || '').trim() : '';
    })()`);
    assert.equal(hoverAuxState, "aux_output", "output chooser should keep tracking the hovered right half before click");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: chooserState.clickX + 120,
      y: chooserState.clickY,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: chooserState.clickX + 120,
      y: chooserState.clickY,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await sleep(400);

    const modalState = await cdp.evaluate(`(() => {
      const modal = document.getElementById('simulationPickerModal');
      return {
        hidden: !!(modal && modal.classList.contains('hidden')),
        title: document.getElementById('simulationPickerTitle') ? document.getElementById('simulationPickerTitle').textContent : ''
      };
    })()`);

    assert.equal(modalState && modalState.hidden, false, "picker modal should remain open after clicking output chooser");
    assert.equal(modalState && modalState.title, "选择辅产物");
  });
}

async function test_picker_search_dedupes_results_and_renders_visible_thumbnails() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationOutputRoleChooser")`);
    await sleep(300);

    await cdp.evaluate(`document.getElementById("simulationOutputRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "阿尔卑斯"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
    await waitForCondition(cdp, `(() => {
      const thumb = document.querySelector('.simulation-picker-item-thumb');
      return !!(thumb && (thumb.getAttribute('src') || '').trim());
    })()`);
    await waitForCondition(cdp, `(() => {
      const thumb = document.querySelector('.simulation-picker-item-thumb');
      return !!(thumb && thumb.complete && thumb.naturalWidth > 0 && thumb.getBoundingClientRect().width > 40 && thumb.getBoundingClientRect().height > 40);
    })()`, {timeoutMs: 15000});
    await sleep(250);

    const pickerState = await cdp.evaluate(`(() => {
      const items = document.querySelectorAll('.simulation-picker-item');
      const firstItem = document.querySelector('.simulation-picker-item');
      const art = document.querySelector('.simulation-picker-item-art');
      const thumb = document.querySelector('.simulation-picker-item-thumb');
      const modal = document.querySelector('.simulation-picker-modal-card');
      const overlayStyle = art ? getComputedStyle(art, '::after') : null;
      const lineStyle = art ? getComputedStyle(art, '::before') : null;
      const thumbRect = thumb ? thumb.getBoundingClientRect() : null;
      const thumbStyle = thumb ? getComputedStyle(thumb) : null;
      const itemRect = firstItem ? firstItem.getBoundingClientRect() : null;
      const artRect = art ? art.getBoundingClientRect() : null;
      const badge = firstItem ? firstItem.querySelector('.simulation-card-wear-badge') : null;
      const meta = firstItem ? firstItem.querySelector('.simulation-card-meta') : null;
      const mask = firstItem ? firstItem.querySelector('.simulation-picker-art-mask') : null;
      const maskStyle = mask ? getComputedStyle(mask) : null;
      const maskRect = mask ? mask.getBoundingClientRect() : null;
      const maskTitle = firstItem ? firstItem.querySelector('.simulation-picker-art-title') : null;
      const maskMeta = firstItem ? firstItem.querySelector('.simulation-picker-art-meta') : null;
      const bodyTitle = firstItem ? firstItem.querySelector('.simulation-picker-item-body strong') : null;
      const bodyMeta = firstItem ? firstItem.querySelector('.simulation-picker-item-body .simulation-card-meta') : null;
      return {
        itemCount: items.length,
        thumbSrc: thumb ? thumb.getAttribute('src') || '' : '',
        thumbCurrentSrc: thumb ? thumb.currentSrc || '' : '',
        thumbNaturalWidth: thumb ? thumb.naturalWidth : 0,
        thumbWidth: thumbRect ? thumbRect.width : 0,
        thumbHeight: thumbRect ? thumbRect.height : 0,
        thumbTransform: thumbStyle ? String(thumbStyle.transform || '') : '',
        thumbClipPath: thumbStyle ? String(thumbStyle.clipPath || '') : '',
        itemHeight: itemRect ? itemRect.height : 0,
        artOverlayOpacity: overlayStyle ? Number.parseFloat(overlayStyle.opacity || '0') : 0,
        artOverlayContent: overlayStyle ? String(overlayStyle.content || '').replaceAll('"', '') : '',
        artLineColor: lineStyle ? String(lineStyle.backgroundColor || '') : '',
        artLineWidth: lineStyle ? Number.parseFloat(lineStyle.width || '0') : 0,
        badgeText: badge ? String(badge.textContent || '').trim() : '',
        metaText: meta ? String(meta.textContent || '').trim() : '',
        maskTitleText: maskTitle ? String(maskTitle.textContent || '').trim() : '',
        maskMetaText: maskMeta ? String(maskMeta.textContent || '').trim() : '',
        bodyTitleCount: bodyTitle ? 1 : 0,
        bodyMetaCount: bodyMeta ? 1 : 0,
        maskDisplay: maskStyle ? String(maskStyle.display || '') : '',
        maskBackgroundImage: maskStyle ? String(maskStyle.backgroundImage || '') : '',
        maskHeight: maskStyle ? Number.parseFloat(maskStyle.height || '0') : 0,
        maskTopRatio: maskRect && artRect && artRect.height > 0 ? (maskRect.top - artRect.top) / artRect.height : -1,
        maskBottomGap: maskRect && artRect ? Math.abs(artRect.bottom - maskRect.bottom) : -1,
        modalWidth: modal ? Number.parseFloat(getComputedStyle(modal).width) : 0,
        modalHeight: modal ? Number.parseFloat(getComputedStyle(modal).height) : 0
      };
    })()`);

    assert.equal(pickerState.itemCount, 1, "picker search should dedupe wear-level duplicates into one result");
    assert.equal(Boolean(pickerState.thumbSrc), true, "picker search result should render a thumbnail image element");
    assert.equal(Boolean(pickerState.thumbCurrentSrc), true, "picker search thumbnail should resolve to a real image URL");
    assert.equal(pickerState.thumbNaturalWidth > 0, true, "picker thumbnail should finish loading real image pixels");
    assert.equal(pickerState.itemHeight >= 120, true, "picker search result row should expand tall enough to visibly show the art area instead of being clipped to button default height");
    assert.equal(pickerState.thumbWidth >= 96 && pickerState.thumbHeight >= 96, true, "picker thumbnail should occupy an obviously visible on-screen size");
    assert.equal(pickerState.thumbTransform !== "none", true, "picker thumbnail should apply an explicit scale transform to cut down the transparent whitespace");
    assert.equal(pickerState.thumbClipPath !== "none", true, "picker thumbnail should apply a clip-path crop to trim transparent margins");
    assert.equal(/24%|25%|26%|27%|28%/.test(pickerState.thumbClipPath), true, "picker thumbnail should use a stronger vertical crop so the top and bottom transparent whitespace shrink further");
    assert.equal(pickerState.badgeText.length > 0, true, "picker search card should show a rarity badge");
    assert.equal(["主产物", "辅产物", "主料", "辅料"].includes(pickerState.badgeText), false, "picker rarity badge should replace the old role text");
    assert.equal(pickerState.maskMetaText.includes(pickerState.badgeText), false, "picker mask meta should no longer repeat the rarity label that already appears in the badge");
    assert.equal(pickerState.maskTitleText.length > 0, true, "picker item name should move into the artwork mask area");
    assert.equal(pickerState.maskMetaText.length > 0, true, "picker collection text should also move into the artwork mask area");
    assert.equal(pickerState.bodyTitleCount, 0, "picker item body should no longer render a separate title below the artwork");
    assert.equal(pickerState.bodyMetaCount, 0, "picker item body should no longer render a separate collection line below the artwork");
    assert.equal(pickerState.artLineWidth >= 4, true, "picker artwork should render a visible rarity-colored vertical line");
    assert.equal(["transparent", "rgba(0, 0, 0, 0)"].includes(pickerState.artLineColor), false, "picker rarity line should receive a real color");
    assert.equal(pickerState.artOverlayContent === "none" || pickerState.artOverlayOpacity === 0, true, "picker artwork should remove the old ghost overlay");
    assert.equal(pickerState.maskDisplay !== "none", true, "picker artwork should render a dedicated bottom mask element");
    assert.equal(pickerState.maskBackgroundImage.includes("linear-gradient"), true, "picker artwork mask should use a dark gradient");
    assert.equal(pickerState.maskHeight >= 40, true, "picker artwork mask should cover the lower band of the image");
    assert.equal(pickerState.maskTopRatio >= 0.42 && pickerState.maskTopRatio <= 0.58, true, "picker artwork mask should start around the middle-lower band instead of hugging only the bottom edge");
    assert.equal(pickerState.maskBottomGap <= 2, true, "picker artwork mask should stay anchored to the bottom edge of the art area");
    assert.equal(pickerState.modalWidth <= 640, true, "picker modal should become narrower than the previous wide layout");
    assert.equal(pickerState.modalHeight > 0, true, "picker modal should stay measurable after opening");
  });
}

async function test_clicking_search_result_populates_output_lane_immediately() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationOutputRoleChooser")`);
    await sleep(300);

    await cdp.evaluate(`document.getElementById("simulationOutputRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "跑跑跑"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
    await sleep(350);

    await cdp.evaluate(`document.querySelector(".simulation-picker-item").click();`);
    await sleep(1200);

    const laneState = await cdp.evaluate(`(() => {
      const outputLane = document.getElementById('simulationOutputLane');
      const firstCard = outputLane.querySelector('[data-simulation-card-role="output"]');
      const firstArt = firstCard ? firstCard.querySelector('.simulation-card-art') : null;
      const firstArtStyle = firstArt ? getComputedStyle(firstArt, '::after') : null;
      const firstSubline = firstCard ? firstCard.querySelector('.simulation-card-subline') : null;
      const cardNames = Array.from(outputLane.querySelectorAll('.simulation-card-name')).map((node) => String(node.textContent || '').trim());
      const chosenCard = Array.from(outputLane.querySelectorAll('[data-simulation-card-role="output"]')).find((card) => {
        const nameNode = card.querySelector('.simulation-card-name');
        return String(nameNode && nameNode.textContent || '').trim() === 'XM1014 | 跑跑跑';
      });
      const chosenSection = chosenCard ? chosenCard.closest('.simulation-lane-section') : null;
      const chosenTitleWrap = chosenSection ? chosenSection.querySelector('.simulation-lane-title-wrap') : null;
      const chosenSectionTitle = chosenSection ? String(((chosenSection.querySelector('.simulation-lane-head strong')) || {}).textContent || '').trim() : '';
      const chosenRemoveButton = chosenSection ? chosenSection.querySelector('[data-simulation-remove-collection]') : null;
      const materialSection = chosenSectionTitle
        ? Array.from(document.querySelectorAll('#simulationMaterialLane .simulation-lane-section')).find((section) => {
            const titleNode = section.querySelector('.simulation-lane-head strong');
            return String(titleNode && titleNode.textContent || '').trim() === chosenSectionTitle;
          })
        : null;
      return {
        modalHidden: document.getElementById('simulationPickerModal').classList.contains('hidden'),
        outputCardCount: outputLane.querySelectorAll('[data-simulation-card-role=\"output\"]').length,
        cardNames,
        laneText: String(outputLane.textContent || '').trim(),
        firstCardMetaCount: firstCard ? firstCard.querySelectorAll('.simulation-card-meta').length : 0,
        firstCardNoteCount: firstCard ? firstCard.querySelectorAll('.simulation-card-note').length : 0,
        firstCardArtBackgroundSize: firstArtStyle ? String(firstArtStyle.backgroundSize || '') : '',
        firstCardCollectionText: firstSubline ? String((firstSubline.querySelector('.simulation-card-collection') || {}).textContent || '').trim() : '',
        firstCardRarityText: firstSubline ? String((firstSubline.querySelector('.simulation-card-rarity') || {}).textContent || '').trim() : '',
        chosenCardCollectionText: chosenCard ? String(((chosenCard.querySelector('.simulation-card-collection')) || {}).textContent || '').trim() : '',
        chosenCardRarityText: chosenCard ? String(((chosenCard.querySelector('.simulation-card-rarity')) || {}).textContent || '').trim() : '',
        chosenCardSlotTags: chosenCard
          ? Array.from(chosenCard.querySelectorAll('.simulation-card-slot-tag')).map((node) => String(node.textContent || '').trim())
          : [],
        chosenHeaderRarityText: chosenSection ? String(((chosenSection.querySelector('.simulation-lane-rarity')) || {}).textContent || '').trim() : '',
        chosenHeaderSlotTags: chosenSection
          ? Array.from(chosenSection.querySelectorAll('.simulation-card-slot-tag')).map((node) => String(node.textContent || '').trim())
          : [],
        chosenHeaderFirstChildClass: chosenTitleWrap && chosenTitleWrap.firstElementChild
          ? (chosenTitleWrap.firstElementChild.classList.contains('simulation-lane-meta')
            ? 'simulation-lane-meta'
            : chosenTitleWrap.firstElementChild.classList.contains('simulation-lane-rarity')
              ? 'simulation-lane-rarity'
              : String(chosenTitleWrap.firstElementChild.tagName || '').toLowerCase())
          : '',
        chosenHeaderSecondChildClass: chosenTitleWrap && chosenTitleWrap.children && chosenTitleWrap.children[1]
          ? (chosenTitleWrap.children[1].classList.contains('simulation-lane-rarity')
            ? 'simulation-lane-rarity'
            : chosenTitleWrap.children[1].classList.contains('simulation-lane-meta')
              ? 'simulation-lane-meta'
              : String(chosenTitleWrap.children[1].tagName || '').toLowerCase())
          : '',
        chosenSectionTitle,
        chosenRemoveButtonExists: !!chosenRemoveButton,
        chosenRemoveButtonLabel: chosenRemoveButton ? String(chosenRemoveButton.getAttribute('aria-label') || '').trim() : '',
        materialRemoveButtonExists: !!(materialSection && materialSection.querySelector('[data-simulation-remove-collection]')),
        chosenCardBadgeText: chosenCard
          ? Array.from(chosenCard.querySelectorAll('.simulation-card-action-badge')).map((node) => String(node.textContent || '').trim())
          : []
      };
    })()`);

    assert.equal(laneState.modalHidden, true, "picker modal should close after choosing an output item");
    assert.equal(laneState.outputCardCount >= 1, true, "choosing an output item should immediately create a visible output card in the left lane");
    assert.equal(laneState.cardNames.includes("XM1014 | 跑跑跑"), true, "the chosen output item should appear in the left output lane");
    assert.equal(laneState.firstCardMetaCount, 0, "simulation output cards should remove the extra collection/rarity meta block below the title");
    assert.equal(laneState.firstCardNoteCount, 0, "simulation output cards should remove the extra helper note block below the title");
    assert.equal(laneState.firstCardArtBackgroundSize !== "max(132px, 100%) auto", true, "simulation output card artwork should shrink from the previous oversized default");
    assert.equal(Boolean(laneState.firstCardCollectionText), false, "simulation output cards should remove the repeated collection signature line from the card body");
    assert.equal(Boolean(laneState.firstCardRarityText), false, "simulation output cards should remove the rarity text from the card bottom signature");
    assert.equal(Boolean(laneState.chosenCardCollectionText), false, "the chosen output card should remove the repeated collection signature line from the card body");
    assert.equal(Boolean(laneState.chosenCardRarityText), false, "the chosen output card should remove rarity from the card bottom signature");
    assert.equal(laneState.chosenCardSlotTags.includes("主"), false, "primary slot tags should move out of the card bottom signature");
    assert.equal(Boolean(laneState.chosenHeaderRarityText), true, "the collection section header should show the shared rarity signature");
    assert.equal(laneState.chosenHeaderRarityText === "R0", false, "the collection section header should not fall back to the broken R0 rarity label");
    assert.equal(laneState.chosenHeaderFirstChildClass, "simulation-lane-meta", "the collection section header should render the main/aux tags before the rarity");
    assert.equal(laneState.chosenHeaderSecondChildClass, "simulation-lane-rarity", "the collection section header should render rarity immediately after the main/aux tags");
    assert.equal(laneState.chosenHeaderSlotTags.includes("主"), true, "the chosen output section header should carry the primary slot tag");
    assert.equal(laneState.chosenRemoveButtonExists, true, "collection sections should expose a delete control in the old count position");
    assert.equal(Boolean(laneState.chosenRemoveButtonLabel), true, "collection delete controls should expose an accessible label");
    assert.equal(laneState.materialRemoveButtonExists, true, "the mirrored material collection section should also expose the linked delete control");
    assert.equal(laneState.chosenCardBadgeText.includes("当前锚定"), true, "the active anchor output should still show the anchor badge");
    assert.equal(laneState.chosenCardBadgeText.includes("候选产物"), false, "simulation output cards should remove the old candidate badge text");
    assert.equal(laneState.chosenCardBadgeText.includes("只读"), false, "simulation output cards should remove the old readonly badge text");

    await cdp.evaluate(`(() => {
      const title = ${JSON.stringify("PLACEHOLDER_TITLE")};
      const section = Array.from(document.querySelectorAll('#simulationOutputLane .simulation-lane-section')).find((node) => {
        const titleNode = node.querySelector('.simulation-lane-head strong');
        return String(titleNode && titleNode.textContent || '').trim() === title;
      });
      const button = section ? section.querySelector('[data-simulation-remove-collection]') : null;
      if (button) button.click();
    })()`.replace('"PLACEHOLDER_TITLE"', JSON.stringify(laneState.chosenSectionTitle)));
    await sleep(250);

    const afterDeleteState = await cdp.evaluate(`(() => ({
      outputLaneText: String(document.getElementById('simulationOutputLane').textContent || '').trim(),
      materialLaneText: String(document.getElementById('simulationMaterialLane').textContent || '').trim(),
      outputSectionTitles: Array.from(document.querySelectorAll('#simulationOutputLane .simulation-lane-head strong')).map((node) => String(node.textContent || '').trim()),
      materialSectionTitles: Array.from(document.querySelectorAll('#simulationMaterialLane .simulation-lane-head strong')).map((node) => String(node.textContent || '').trim())
    }))()`);

    assert.equal(afterDeleteState.outputLaneText.includes("XM1014 | 跑跑跑"), false, "deleting a collection should remove the chosen output card from the left lane");
    assert.equal(afterDeleteState.outputSectionTitles.includes(laneState.chosenSectionTitle), false, "deleting a collection should remove that collection section from the output lane");
    assert.equal(afterDeleteState.materialSectionTitles.includes(laneState.chosenSectionTitle), false, "deleting a collection from the output lane should also remove the mirrored material section");
  });
}

async function test_material_chooser_defaults_to_next_empty_slot() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationMaterialRoleChooser")`);
    await sleep(300);

    await cdp.evaluate(`document.getElementById("simulationMaterialRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    assert.equal(
      await cdp.evaluate(`document.getElementById("simulationPickerTitle").textContent.trim()`),
      "选择主料",
      "first material pick should still start from the main material slot"
    );
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "列车停放站"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
    await sleep(300);
    await cdp.evaluate(`document.querySelector(".simulation-picker-item").click();`);
    await waitForCondition(cdp, `document.querySelectorAll('#simulationMaterialLane [data-simulation-card-role="material"]').length >= 1`);

    await cdp.evaluate(`document.getElementById("simulationMaterialRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);

    const secondOpenState = await cdp.evaluate(`(() => ({
      title: document.getElementById('simulationPickerTitle').textContent.trim(),
      chooserText: document.getElementById('simulationMaterialRoleChooserText').textContent.replace(/\\s+/g, ' ').trim()
    }))()`);

    assert.equal(secondOpenState.title, "选择辅料", "after a main material already exists, the next direct material pick should default to the auxiliary material slot");
    assert.equal(secondOpenState.chooserText.includes("/2"), false, "material chooser copy should no longer show the ambiguous x/2 counter");
  });
}

async function test_material_chooser_can_switch_to_a_different_collection() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationMaterialRoleChooser")`);
    await sleep(300);

    await cdp.evaluate(`(() => {
      window.__simulationFetchLog = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const input = args[0];
        const init = args[1] || {};
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const body = init && init.body != null ? String(init.body) : "";
        const response = await originalFetch(...args);
        const clone = response.clone();
        const text = await clone.text();
        window.__simulationFetchLog.push({
          url,
          method: String((init && init.method) || "GET"),
          body,
          status: Number(response.status || 0),
          text
        });
        return response;
      };
    })();`);

    async function pickCollection(query) {
      await cdp.evaluate(`document.getElementById("simulationMaterialRoleChooser").click();`);
      await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
      await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = ${JSON.stringify(query)}; document.getElementById("simulationPickerSearchBtn").click();`);
      await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
      await sleep(350);
      await cdp.evaluate(`document.querySelector(".simulation-picker-item").click();`);
      await sleep(1600);
    }

    await pickCollection("列车停放站");
    await pickCollection("殒命大厦");

    const state = await cdp.evaluate(`(() => ({
      outputLaneText: document.getElementById("simulationOutputLane").textContent.replace(/\\s+/g, " ").trim(),
      materialLaneText: document.getElementById("simulationMaterialLane").textContent.replace(/\\s+/g, " ").trim(),
      fetchLog: Array.isArray(window.__simulationFetchLog) ? window.__simulationFetchLog : []
    }))()`);

    const lastPredictRequest = [...state.fetchLog]
      .reverse()
      .find((entry) => String(entry && entry.url || "").includes("/api/craft/predict-outcomes"));
    const lastResolveRequest = [...state.fetchLog]
      .reverse()
      .find((entry) => String(entry && entry.url || "").includes("/api/simulation/tradeup/resolve"));

    assert.ok(lastPredictRequest, "mixed-collection material picks should still send a predictor request");
    assert.equal(
      String(lastPredictRequest.body || "").includes("\"collection\":\"殒命大厦收藏品\""),
      true,
      "the predictor payload should include the second collection instead of getting stuck on the first one"
    );
    assert.ok(lastResolveRequest, "mixed-collection material picks should continue into resolve");
    assert.equal(
      Number(lastResolveRequest.status || 0) < 400,
      true,
      "resolving after switching to a different collection should no longer fail with collection_mismatch"
    );
    assert.equal(
      state.outputLaneText.includes("殒命大厦收藏品") || state.materialLaneText.includes("殒命大厦收藏品"),
      true,
      "after switching the anchor collection, at least one lane should visibly update to the newly chosen collection"
    );
  });
}

async function test_material_picker_blocks_mixed_rarity_without_closing_modal() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationMaterialRoleChooser")`);
    await sleep(300);

    await cdp.evaluate(`document.getElementById("simulationMaterialRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "列车停放站"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
    await sleep(300);

    const lockedPick = await cdp.evaluate(`(() => {
      const first = document.querySelector('.simulation-picker-item');
      if (!first) return null;
      const badge = first.querySelector('.simulation-picker-rarity-badge');
      return {
        rarity: String(badge && badge.textContent || '').trim()
      };
    })()`);
    assert.ok(lockedPick && lockedPick.rarity, "expected first picker result to expose a rarity badge");

    await cdp.evaluate(`document.querySelector(".simulation-picker-item").click();`);
    await waitForCondition(cdp, `document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    await sleep(1000);

    await cdp.evaluate(`document.getElementById("simulationMaterialRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "列车停放站"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
    await sleep(300);

    const mismatchState = await cdp.evaluate(`(() => {
      const lockedRarity = ${JSON.stringify(lockedPick.rarity)};
      const items = Array.from(document.querySelectorAll('.simulation-picker-item'));
      const mismatchIndex = items.findIndex((item) => {
        const badge = item.querySelector('.simulation-picker-rarity-badge');
        const rarity = String(badge && badge.textContent || '').trim();
        return rarity && rarity !== lockedRarity;
      });
      const mismatchItem = mismatchIndex >= 0 ? items[mismatchIndex] : null;
      const mismatchBadge = mismatchItem ? mismatchItem.querySelector('.simulation-picker-rarity-badge') : null;
      return {
        mismatchIndex,
        mismatchRarity: String(mismatchBadge && mismatchBadge.textContent || '').trim()
      };
    })()`);
    assert.ok(
      mismatchState && mismatchState.mismatchIndex >= 0 && mismatchState.mismatchRarity,
      "expected the collection search results to contain at least one item with a different rarity so the lock can be validated"
    );

    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.simulation-picker-item'));
      const target = items[${Number(mismatchState.mismatchIndex) || 0}];
      if (target) target.click();
    })()`);
    await sleep(400);

    const blockedState = await cdp.evaluate(`(() => {
      const modal = document.getElementById('simulationPickerModal');
      const toast = document.querySelector('.error-toast.show .error-toast-text') || document.querySelector('.error-toast .error-toast-text');
      return {
        modalHidden: !!(modal && modal.classList.contains('hidden')),
        modalTitle: String((document.getElementById('simulationPickerTitle') || {}).textContent || '').trim(),
        toastText: toast ? String(toast.textContent || '').trim() : ''
      };
    })()`);

    assert.equal(blockedState.modalHidden, false, "picker modal should stay open after selecting a mismatched rarity");
    assert.equal(blockedState.modalTitle, "选择辅料", "blocked material selection should keep the current slot context");
    assert.equal(blockedState.toastText.includes("单配方需同一稀有度"), true, "blocked material selection should surface the rarity-lock toast");
    assert.equal(blockedState.toastText.includes(lockedPick.rarity), true, "the toast should mention the currently locked rarity");
    assert.equal(blockedState.toastText.includes(mismatchState.mismatchRarity), true, "the toast should mention the rejected rarity");
  });
}

async function test_output_lane_expands_selected_output_collections() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationOutputRoleChooser")`);
    await sleep(300);

    async function pickOutput(query) {
      await cdp.evaluate(`document.getElementById("simulationOutputRoleChooser").click();`);
      await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
      await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = ${JSON.stringify(query)}; document.getElementById("simulationPickerSearchBtn").click();`);
      await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
      await sleep(350);
      await cdp.evaluate(`document.querySelector(".simulation-picker-item").click();`);
      await sleep(1600);
    }

    await pickOutput("AWP | Acheron");
    await pickOutput("USP-S | Check Engine");

    const laneState = await cdp.evaluate(`(() => {
      const outputSections = Array.from(document.querySelectorAll('#simulationOutputLane .simulation-lane-section'));
      const materialSections = Array.from(document.querySelectorAll('#simulationMaterialLane .simulation-lane-section'));
      const readSectionMeta = (section) => {
        const titleWrap = section ? section.querySelector('.simulation-lane-title-wrap') : null;
        return {
          rarity: section ? String(((section.querySelector('.simulation-lane-rarity')) || {}).textContent || '').trim() : '',
          slotTags: section
            ? Array.from(section.querySelectorAll('.simulation-card-slot-tag')).map((node) => String(node.textContent || '').trim())
            : [],
          firstChildClass: titleWrap && titleWrap.firstElementChild
            ? (titleWrap.firstElementChild.classList.contains('simulation-lane-meta')
              ? 'simulation-lane-meta'
              : titleWrap.firstElementChild.classList.contains('simulation-lane-rarity')
                ? 'simulation-lane-rarity'
                : String(titleWrap.firstElementChild.tagName || '').toLowerCase())
            : '',
          secondChildClass: titleWrap && titleWrap.children && titleWrap.children[1]
            ? (titleWrap.children[1].classList.contains('simulation-lane-rarity')
              ? 'simulation-lane-rarity'
              : titleWrap.children[1].classList.contains('simulation-lane-meta')
                ? 'simulation-lane-meta'
                : String(titleWrap.children[1].tagName || '').toLowerCase())
            : ''
        };
      };
      const findByTitle = (sections, title) => sections.find((section) => {
        const titleNode = section.querySelector('.simulation-lane-head strong');
        return String(titleNode && titleNode.textContent || '').trim() === title;
      });
      return {
        outputSectionTitles: outputSections.map((section) => {
          const titleNode = section.querySelector('.simulation-lane-head strong');
          return String(titleNode && titleNode.textContent || '').trim();
        }),
        materialSectionTitles: materialSections.map((section) => {
          const titleNode = section.querySelector('.simulation-lane-head strong');
          return String(titleNode && titleNode.textContent || '').trim();
        }),
        outputCardNames: Array.from(document.querySelectorAll('#simulationOutputLane [data-simulation-card-role] .simulation-card-name'))
          .map((node) => String(node.textContent || '').trim()),
        materialCardNames: Array.from(document.querySelectorAll('#simulationMaterialLane [data-simulation-card-role] .simulation-card-name'))
          .map((node) => String(node.textContent || '').trim()),
        outputPrimaryMeta: readSectionMeta(findByTitle(outputSections, '2018 核子危机收藏品')),
        outputAuxMeta: readSectionMeta(findByTitle(outputSections, '2018 炼狱小镇收藏品')),
        materialPrimaryMeta: readSectionMeta(findByTitle(materialSections, '2018 核子危机收藏品')),
        materialAuxMeta: readSectionMeta(findByTitle(materialSections, '2018 炼狱小镇收藏品'))
      };
    })()`);

    assert.equal(
      laneState.outputSectionTitles.includes("2018 核子危机收藏品"),
      true,
      "the output lane should expand the full collection that belongs to the chosen primary output"
    );
    assert.equal(
      laneState.outputSectionTitles.includes("2018 炼狱小镇收藏品"),
      true,
      "the output lane should also expand the full collection that belongs to the chosen auxiliary output"
    );
    assert.equal(
      laneState.outputSectionTitles.includes("当前已选产物"),
      false,
      "when collection rows exist, the output lane should show collection combinations instead of collapsing into a selected-only section"
    );
    assert.equal(
      laneState.outputCardNames.includes("AWP | 冥界之河"),
      true,
      "the primary output collection row should still include the originally chosen output"
    );
    assert.equal(
      laneState.outputCardNames.includes("USP消音版 | 引擎故障灯"),
      true,
      "the auxiliary output collection row should include the newly chosen output"
    );
    assert.equal(
      laneState.materialSectionTitles.includes("2018 核子危机收藏品"),
      true,
      "the material lane should map the primary output collection into its full material set"
    );
    assert.equal(
      laneState.materialSectionTitles.includes("2018 炼狱小镇收藏品"),
      true,
      "the material lane should also map the auxiliary output collection into its full material set"
    );
    assert.equal(laneState.outputPrimaryMeta.firstChildClass, "simulation-lane-meta", "output section headers should render the main/aux tags before the rarity");
    assert.equal(laneState.outputAuxMeta.firstChildClass, "simulation-lane-meta", "auxiliary output section headers should also render the main/aux tags before the rarity");
    assert.equal(laneState.materialPrimaryMeta.firstChildClass, "simulation-lane-meta", "material section headers should render the main/aux tags before the rarity");
    assert.equal(laneState.materialAuxMeta.firstChildClass, "simulation-lane-meta", "auxiliary material section headers should render the main/aux tags before the rarity");
    assert.equal(laneState.outputPrimaryMeta.secondChildClass, "simulation-lane-rarity", "output section headers should render rarity immediately after the main/aux tags");
    assert.equal(laneState.outputAuxMeta.secondChildClass, "simulation-lane-rarity", "auxiliary output section headers should also render rarity immediately after the main/aux tags");
    assert.equal(laneState.materialPrimaryMeta.secondChildClass, "simulation-lane-rarity", "material section headers should render rarity immediately after the main/aux tags");
    assert.equal(laneState.materialAuxMeta.secondChildClass, "simulation-lane-rarity", "auxiliary material section headers should render rarity immediately after the main/aux tags");
    assert.equal(laneState.outputPrimaryMeta.slotTags.includes("主"), true, "the primary output collection should carry the main tag");
    assert.equal(laneState.outputAuxMeta.slotTags.includes("辅"), true, "the auxiliary output collection should carry the aux tag");
    assert.equal(laneState.materialPrimaryMeta.slotTags.includes("主"), true, "material-side collection tags should sync with the primary output role");
    assert.equal(laneState.materialAuxMeta.slotTags.includes("辅"), true, "material-side collection tags should sync with the auxiliary output role");
  });
}

async function test_picker_search_results_take_real_scrollable_height() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1180,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationOutputRoleChooser")`);
    await sleep(300);

    await cdp.evaluate(`document.getElementById("simulationOutputRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "AK"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length >= 10`);
    await sleep(300);

    const pickerState = await cdp.evaluate(`(() => {
      const modal = document.querySelector('.simulation-picker-modal-card');
      const results = document.getElementById('simulationPickerSearchResults');
      if (!modal || !results) return null;
      const modalRect = modal.getBoundingClientRect();
      const resultsRect = results.getBoundingClientRect();
      const resultsStyle = getComputedStyle(results);
      const thumbStyle = getComputedStyle(results, '::-webkit-scrollbar-thumb');
      return {
        modalWidth: modalRect.width,
        modalHeight: modalRect.height,
        resultsClientHeight: results.clientHeight,
        resultsScrollHeight: results.scrollHeight,
        resultsTopGap: Math.max(0, resultsRect.top - modalRect.top),
        resultsBottomGap: Math.max(0, modalRect.bottom - resultsRect.bottom),
        scrollbarColor: String(resultsStyle.scrollbarColor || ''),
        scrollbarThumbBackgroundImage: String(thumbStyle.backgroundImage || '')
      };
    })()`);

    assert.ok(pickerState, "expected picker modal layout metrics");
    assert.equal(pickerState.modalWidth <= 640, true, "picker modal should stay in the narrower layout");
    assert.equal(pickerState.resultsClientHeight >= 260, true, "picker results region should receive substantial real viewport height");
    assert.equal(pickerState.resultsScrollHeight > pickerState.resultsClientHeight, true, "picker results region should become an actual scroll container when matches are plentiful");
    assert.equal(pickerState.resultsBottomGap <= 70, true, "picker results region should stretch close to the modal footer instead of collapsing");
    assert.equal(pickerState.scrollbarColor.includes("220, 164, 76"), true, "picker results scrollbar should adopt the yellow accent color");
    assert.equal(pickerState.scrollbarThumbBackgroundImage.includes("linear-gradient"), true, "picker results scrollbar thumb should render the accent gradient");
  });
}

async function test_picker_search_results_render_compact_three_column_cards() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1180,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationOutputRoleChooser")`);
    await sleep(300);

    await cdp.evaluate(`document.getElementById("simulationOutputRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "AK"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length >= 10`);
    await sleep(300);

    const pickerState = await cdp.evaluate(`(() => {
      const results = document.getElementById('simulationPickerSearchResults');
      const items = Array.from(document.querySelectorAll('.simulation-picker-item'));
      const first = items[0];
      if (!results || !first) return null;
      const gridTemplateColumns = getComputedStyle(results).gridTemplateColumns;
      const firstRect = first.getBoundingClientRect();
      const meta = first.querySelector('.simulation-card-meta');
      return {
        columnCount: gridTemplateColumns.split(' ').filter(Boolean).length,
        firstCardWidth: firstRect.width,
        firstCardHeight: firstRect.height,
        titleText: String(first.querySelector('.simulation-picker-art-title')?.textContent || '').trim(),
        bodyTitleCount: first.querySelectorAll('.simulation-picker-item-body strong').length,
        bodyMetaCount: first.querySelectorAll('.simulation-picker-item-body .simulation-card-meta').length,
        metaText: String(first.querySelector('.simulation-picker-art-meta')?.textContent || '').trim(),
        noteCount: first.querySelectorAll('.simulation-card-note').length,
        actionCount: first.querySelectorAll('.simulation-picker-item-action').length
      };
    })()`);

    assert.ok(pickerState, "expected compact picker card metrics");
    assert.equal(pickerState.columnCount, 3, "picker search results should stay in a three-column grid");
    assert.equal(pickerState.firstCardWidth >= 170, true, "each picker card should keep a readable width instead of collapsing into thin rows");
    assert.equal(pickerState.firstCardHeight >= 220, true, "compact picker cards should keep enough vertical space for the artwork and meta");
    assert.equal(pickerState.titleText.length > 0, true, "picker cards should still show the item name inside the artwork mask");
    assert.equal(pickerState.bodyTitleCount, 0, "compact picker cards should not repeat the title in the body section");
    assert.equal(pickerState.bodyMetaCount, 0, "compact picker cards should not repeat the collection in the body section");
    assert.equal(pickerState.metaText.includes("·"), false, "picker cards should keep only the collection text in the compact meta line");
    assert.equal(pickerState.noteCount, 0, "compact picker cards should remove the extra wear note line");
    assert.equal(pickerState.actionCount, 0, "compact picker cards should remove the extra action hint line");
  });
}

async function main() {
  await test_clicking_output_chooser_opens_picker_without_inline_slot_cards();
  await test_picker_search_dedupes_results_and_renders_visible_thumbnails();
  await test_clicking_search_result_populates_output_lane_immediately();
  await test_material_chooser_defaults_to_next_empty_slot();
  await test_material_chooser_can_switch_to_a_different_collection();
  await test_material_picker_blocks_mixed_rarity_without_closing_modal();
  await test_output_lane_expands_selected_output_collections();
  await test_picker_search_results_take_real_scrollable_height();
  await test_picker_search_results_render_compact_three_column_cards();
  console.log("tradeup-simulation-picker-interaction tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
