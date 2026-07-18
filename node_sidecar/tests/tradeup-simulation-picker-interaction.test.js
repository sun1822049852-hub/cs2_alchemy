const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawn} = require("node:child_process");
const {FEATURE_CODES} = require("../../shared/licensePolicy");
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

function createReadyLicenseRuntime() {
  const state = {
    ok: true,
    code: "ready",
    user: {
      id: "user_test",
      username: "member_test",
      membership_plan: "pro"
    },
    permissions: Object.values(FEATURE_CODES),
    featureFlags: {
      simulation_enabled: true
    },
    expiresAt: "2099-01-01T00:15:00.000Z",
    expiresInMs: 86400000
  };
  return {
    getState() {
      return state;
    },
    stop() {},
    importBundle() {
      return state;
    },
    clear() {
      return state;
    }
  };
}

async function withBrowserPage(run) {
  const browserPath = findBrowserPath();
  if (!browserPath) {
    console.log("tradeup-simulation-picker-interaction skipped: no browser found");
    return;
  }

  const server = createServer({
    licenseRuntimeFactory: () => createReadyLicenseRuntime()
  });
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
        thumbWideClass: thumb ? thumb.classList.contains('is-wide') : false,
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
        thumbTopRatio: thumbRect && artRect && artRect.height > 0 ? (thumbRect.top - artRect.top) / artRect.height : -1,
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
    assert.equal(pickerState.thumbWideClass, false, "regular picker thumbnails should not be misclassified into the wide-weapon layout branch");
    assert.equal(/24%|25%|26%|27%|28%/.test(pickerState.thumbClipPath), false, "picker thumbnail should stop using the old heavy vertical crop that clipped some item art");
    assert.equal(/5%/.test(pickerState.thumbClipPath), true, "picker thumbnail should keep the requested 5% vertical crop so the full item image stays visible");
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
    assert.equal(pickerState.maskTopRatio >= 0.72 && pickerState.maskTopRatio <= 0.78, true, "picker artwork mask should start around the lower quarter instead of swallowing half the card");
    assert.equal(pickerState.maskBottomGap <= 2, true, "picker artwork mask should stay anchored to the bottom edge of the art area");
    assert.equal(pickerState.thumbTopRatio >= 0 && pickerState.thumbTopRatio <= 0.18, true, "picker thumbnail should sit near the top of the art area so the empty upper band is removed");
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
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "Acheron"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
    await sleep(350);
    const selectedOutputName = await cdp.evaluate(`(() => String(document.querySelector(".simulation-picker-item .simulation-picker-art-title")?.textContent || "").trim())()`);
    assert.ok(selectedOutputName, "expected a concrete output picker title before selection");

    await cdp.evaluate(`document.querySelector(".simulation-picker-item").click();`);
    await sleep(1200);

    const laneState = await cdp.evaluate(`(() => {
      const selectedOutputName = ${JSON.stringify(selectedOutputName)};
      const outputLane = document.getElementById('simulationOutputLane');
      const firstCard = outputLane.querySelector('[data-simulation-card-role="output"]');
      const firstArt = firstCard ? firstCard.querySelector('.simulation-card-art') : null;
      const firstArtStyle = firstArt ? getComputedStyle(firstArt, '::after') : null;
      const firstFloat = firstCard ? firstCard.querySelector('.simulation-card-float') : null;
      const firstBar = firstCard ? firstCard.querySelector('.simulation-card-bar') : null;
      const firstContent = firstCard ? firstCard.querySelector('.simulation-card-content') : null;
      const firstWearStack = firstCard ? firstCard.querySelector('.simulation-card-wear-stack') : null;
      const firstSubline = firstCard ? firstCard.querySelector('.simulation-card-subline') : null;
      const cardNames = Array.from(outputLane.querySelectorAll('.simulation-card-name')).map((node) => String(node.textContent || '').trim());
      const chosenCard = Array.from(outputLane.querySelectorAll('[data-simulation-card-role="output"]')).find((card) => {
        const nameNode = card.querySelector('.simulation-card-name');
        return String(nameNode && nameNode.textContent || '').trim() === selectedOutputName;
      });
      const chosenSection = chosenCard ? chosenCard.closest('.simulation-lane-section') : null;
      const chosenTitleWrap = chosenSection ? chosenSection.querySelector('.simulation-lane-title-wrap') : null;
      const chosenSectionTitle = chosenSection ? String(((chosenSection.querySelector('.simulation-lane-head strong')) || {}).textContent || '').trim() : '';
      const chosenRemoveButton = chosenSection ? chosenSection.querySelector('[data-simulation-remove-collection]') : null;
      const targetCard = chosenCard || firstCard;
      const targetArt = targetCard ? targetCard.querySelector('.simulation-card-art') : null;
      const targetArtStyle = targetArt ? getComputedStyle(targetArt, '::after') : null;
      const targetFloat = targetCard ? targetCard.querySelector('.simulation-card-float') : null;
      const targetBar = targetCard ? targetCard.querySelector('.simulation-card-bar') : null;
      const targetBarMarkerStyle = targetBar ? getComputedStyle(targetBar, '::after') : null;
      const targetContent = targetCard ? targetCard.querySelector('.simulation-card-content') : null;
      const targetWearStack = targetCard ? targetCard.querySelector('.simulation-card-wear-stack') : null;
      const targetSubline = targetCard ? targetCard.querySelector('.simulation-card-subline') : null;
      const targetArtStripeStyle = targetArt ? getComputedStyle(targetArt, '::before') : null;
      const targetBarMarkerTop = targetBar && targetBarMarkerStyle
        ? targetBar.getBoundingClientRect().top + Number.parseFloat(targetBarMarkerStyle.top || '0')
        : null;
      const targetArtStripeRight = targetArt && targetArtStripeStyle
        ? targetArt.getBoundingClientRect().left
          + Number.parseFloat(targetArtStripeStyle.left || '0')
          + Number.parseFloat(targetArtStripeStyle.width || '0')
        : null;
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
        targetCardName: targetCard ? String((targetCard.querySelector('.simulation-card-name')?.textContent || '')).trim() : '',
        firstCardMetaCount: targetCard ? targetCard.querySelectorAll('.simulation-card-meta').length : 0,
        firstCardNoteCount: targetCard ? targetCard.querySelectorAll('.simulation-card-note').length : 0,
        firstCardArtBackgroundSize: targetArtStyle ? String(targetArtStyle.backgroundSize || '') : '',
        firstFloatText: targetFloat ? String(targetFloat.textContent || '').trim() : '',
        firstFloatMatchesWearPattern: targetFloat ? /^(?:-|\\d+\\.\\d+)$/.test(String(targetFloat.textContent || '').trim()) : false,
        firstFloatOverlap: targetFloat && targetContent
          ? targetFloat.getBoundingClientRect().bottom - targetContent.getBoundingClientRect().top
          : -1,
        firstFloatTopVsContentTop: targetFloat && targetContent
          ? targetFloat.getBoundingClientRect().top - targetContent.getBoundingClientRect().top
          : -1,
        firstFloatHeight: targetFloat
          ? targetFloat.getBoundingClientRect().height
          : -1,
        firstContentTopVsArtBottom: targetArt && targetContent
          ? targetContent.getBoundingClientRect().top - targetArt.getBoundingClientRect().bottom
          : -1,
        firstFloatBottomVsBarTop: targetFloat && targetBar
          ? targetFloat.getBoundingClientRect().bottom - targetBar.getBoundingClientRect().top
          : -1,
        firstFloatLeftVsStripeRight: targetFloat && targetArtStripeRight !== null
          ? targetFloat.getBoundingClientRect().left - targetArtStripeRight
          : -1,
        firstFloatBottomVsBarMarkerTop: targetFloat && targetBarMarkerTop !== null
          ? targetFloat.getBoundingClientRect().bottom - targetBarMarkerTop
          : -1,
        firstWearStackParentClass: targetWearStack && targetWearStack.parentElement
          ? String(targetWearStack.parentElement.className || '')
          : '',
        firstContentHasWearStack: !!(targetContent && targetContent.querySelector('.simulation-card-wear-stack')),
        firstWearStackBackgroundImage: targetWearStack ? String(getComputedStyle(targetWearStack).backgroundImage || '') : '',
        firstWearStackBackgroundColor: targetWearStack ? String(getComputedStyle(targetWearStack).backgroundColor || '') : '',
        firstWearStackBeforeBackgroundImage: targetWearStack ? String(getComputedStyle(targetWearStack, '::before').backgroundImage || '') : '',
        firstWearStackBeforeBackgroundColor: targetWearStack ? String(getComputedStyle(targetWearStack, '::before').backgroundColor || '') : '',
        firstWearStackAfterBackgroundImage: targetWearStack ? String(getComputedStyle(targetWearStack, '::after').backgroundImage || '') : '',
        firstWearStackAfterBackgroundColor: targetWearStack ? String(getComputedStyle(targetWearStack, '::after').backgroundColor || '') : '',
        firstFloatWidth: targetFloat ? targetFloat.getBoundingClientRect().width : -1,
        firstArtWidth: targetArt ? targetArt.getBoundingClientRect().width : -1,
        firstFloatBeforeBackgroundImage: targetFloat ? String(getComputedStyle(targetFloat, '::before').backgroundImage || '') : '',
        firstFloatBeforeBackgroundColor: targetFloat ? String(getComputedStyle(targetFloat, '::before').backgroundColor || '') : '',
        firstFloatAfterBackgroundImage: targetFloat ? String(getComputedStyle(targetFloat, '::after').backgroundImage || '') : '',
        firstFloatAfterBackgroundColor: targetFloat ? String(getComputedStyle(targetFloat, '::after').backgroundColor || '') : '',
        firstFloatBackgroundColor: targetFloat ? String(getComputedStyle(targetFloat).backgroundColor || '') : '',
        firstCardCollectionText: targetSubline ? String((targetSubline.querySelector('.simulation-card-collection') || {}).textContent || '').trim() : '',
        firstCardRarityText: targetSubline ? String((targetSubline.querySelector('.simulation-card-rarity') || {}).textContent || '').trim() : '',
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
    assert.equal(laneState.cardNames.includes(selectedOutputName), true, "the chosen output item should appear in the left output lane");
    assert.equal(laneState.targetCardName, selectedOutputName, "the runtime wear-geometry assertions should inspect the specifically chosen output card, not whichever card happens to render first");
    assert.equal(laneState.firstCardMetaCount, 0, "simulation output cards should remove the extra collection/rarity meta block below the title");
    assert.equal(laneState.firstCardNoteCount, 0, "simulation output cards should remove the extra helper note block below the title");
    assert.equal(laneState.firstCardArtBackgroundSize !== "max(132px, 100%) auto", true, "simulation output card artwork should shrink from the previous oversized default");
    assert.equal(laneState.firstFloatText.includes("绝对磨损"), false, "simulation output cards should remove the redundant absolute wear label text");
    assert.equal(laneState.firstFloatMatchesWearPattern, true, "simulation output cards should show the compact wear chip as either a decimal wear value or the '-' fallback");
    assert.equal(
      laneState.firstContentTopVsArtBottom > -0.5 && laneState.firstContentTopVsArtBottom < 0.5,
      true,
      "simulation output cards should return the title block below the artwork instead of letting a full-width black mask overlap the image"
    );
    assert.equal(
      laneState.firstWearStackParentClass.includes("simulation-card-art"),
      true,
      "simulation output cards should anchor the wear overlay inside the artwork container"
    );
    assert.equal(
      laneState.firstContentHasWearStack,
      false,
      "simulation output cards should stop rendering the wear overlay inside the lower text content block"
    );
    assert.equal(
      laneState.firstFloatLeftVsStripeRight > -1 && laneState.firstFloatLeftVsStripeRight < 1.5,
      true,
      "simulation output cards should align the wear chip flush to the inner edge of the left rarity stripe"
    );
    assert.equal(
      laneState.firstFloatBottomVsBarTop > -1 && laneState.firstFloatBottomVsBarTop < 1.5,
      true,
      "simulation output cards should dock the wear chip directly onto the wear-bar top edge to form a bottom-left right angle"
    );
    assert.equal(
      laneState.firstWearStackBackgroundImage === "none",
      true,
      "simulation output cards should remove the old full-width black wear-strip background"
    );
    assert.equal(
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(laneState.firstWearStackBackgroundColor),
      true,
      "simulation output cards should keep the wear-stack background itself transparent so a full-width black strip cannot silently return via background-color"
    );
    assert.equal(
      laneState.firstWearStackBeforeBackgroundImage === "none" &&
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(laneState.firstWearStackBeforeBackgroundColor) &&
      laneState.firstWearStackAfterBackgroundImage === "none" &&
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(laneState.firstWearStackAfterBackgroundColor),
      true,
      "simulation output cards should keep wear-stack pseudo-elements visually inert so the old black strip cannot return through ::before or ::after"
    );
    assert.equal(
      laneState.firstFloatWidth > 0 && laneState.firstArtWidth > 0 && laneState.firstFloatWidth < laneState.firstArtWidth * 0.75,
      true,
      "simulation output cards should keep the wear chip narrower than the artwork width so it remains a distinct corner chip instead of expanding across the whole artwork"
    );
    assert.equal(
      laneState.firstFloatBeforeBackgroundImage === "none" &&
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(laneState.firstFloatBeforeBackgroundColor) &&
      laneState.firstFloatAfterBackgroundImage === "none" &&
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(laneState.firstFloatAfterBackgroundColor),
      true,
      "simulation output cards should keep wear-chip pseudo-elements visually inert so a hidden black strip cannot return through ::before or ::after"
    );
    assert.equal(
      ["rgba(0, 0, 0, 0.9)", "rgba(0,0,0,0.9)"].includes(laneState.firstFloatBackgroundColor),
      true,
      "simulation output cards should keep only a compact black wear chip over the bar instead of the old wide black band"
    );
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

    assert.equal(afterDeleteState.outputLaneText.includes(selectedOutputName), false, "deleting a collection should remove the chosen output card from the left lane");
    assert.equal(afterDeleteState.outputSectionTitles.includes(laneState.chosenSectionTitle), false, "deleting a collection should remove that collection section from the output lane");
    assert.equal(afterDeleteState.materialSectionTitles.includes(laneState.chosenSectionTitle), false, "deleting a collection from the output lane should also remove the mirrored material section");
  });
}

async function test_switching_pages_preserves_unsaved_simulation_workspace_draft() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationOutputRoleChooser")`);
    await sleep(300);

    await cdp.evaluate(`document.getElementById("simulationOutputRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "Acheron"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
    await sleep(350);
    const selectedOutputName = await cdp.evaluate(`(() => String(document.querySelector(".simulation-picker-item .simulation-picker-art-title")?.textContent || "").trim())()`);
    assert.ok(selectedOutputName, "expected a concrete output picker title before page-switch draft preservation");

    await cdp.evaluate(`document.querySelector(".simulation-picker-item").click();`);
    await waitForCondition(cdp, `document.querySelectorAll('#simulationOutputLane [data-simulation-card-role="output"]').length >= 1`);

    const beforeSwitch = await cdp.evaluate(`(() => ({
      workspaceActive: document.getElementById('simulationModeWorkspaceBtn').classList.contains('is-active'),
      outputNames: Array.from(document.querySelectorAll('#simulationOutputLane .simulation-card-name')).map((node) => String(node.textContent || '').trim())
    }))()`);

    await cdp.evaluate(`document.getElementById("navInventory").click();`);
    await waitForCondition(cdp, `!document.getElementById("inventoryPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationPage").classList.contains("hidden")`);
    await sleep(200);

    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await sleep(350);

    const afterSwitch = await cdp.evaluate(`(() => ({
      workspaceActive: document.getElementById('simulationModeWorkspaceBtn').classList.contains('is-active'),
      outputNames: Array.from(document.querySelectorAll('#simulationOutputLane .simulation-card-name')).map((node) => String(node.textContent || '').trim()),
      savedHidden: document.getElementById('simulationSavedPresets').classList.contains('hidden'),
      workspaceHidden: document.getElementById('simulationWorkspace').classList.contains('hidden')
    }))()`);

    assert.equal(beforeSwitch.workspaceActive, true, "choosing an unsaved simulation output should keep the workspace tab active before page switching");
    assert.equal(beforeSwitch.outputNames.includes(selectedOutputName), true, "the unsaved workspace draft should exist before page switching");
    assert.equal(afterSwitch.workspaceActive, true, "switching away from the simulation page and back should preserve workspace mode");
    assert.equal(afterSwitch.outputNames.includes(selectedOutputName), true, "switching pages should not discard the in-progress simulation draft");
    assert.equal(afterSwitch.savedHidden, true, "returning to the simulation page should not silently bounce the user back to the saved preset list");
    assert.equal(afterSwitch.workspaceHidden, false, "returning to the simulation page should still show the active workspace");
  });
}

async function test_switching_simulation_mode_tabs_preserves_unsaved_workspace_draft() {
  await withBrowserPage(async ({cdp}) => {
    await cdp.evaluate(`document.getElementById("navSimulation").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPage").classList.contains("hidden")`);
    await waitForCondition(cdp, `document.getElementById("simulationOutputRoleChooser")`);
    await sleep(300);

    await cdp.evaluate(`document.getElementById("simulationOutputRoleChooser").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationPickerModal").classList.contains("hidden")`);
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "Acheron"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item").length > 0`);
    await sleep(350);
    const selectedOutputName = await cdp.evaluate(`(() => String(document.querySelector(".simulation-picker-item .simulation-picker-art-title")?.textContent || "").trim())()`);
    assert.ok(selectedOutputName, "expected a concrete output picker title before tab-switch draft preservation");

    await cdp.evaluate(`document.querySelector(".simulation-picker-item").click();`);
    await waitForCondition(cdp, `document.querySelectorAll('#simulationOutputLane .simulation-card-name').length >= 1`);

    await cdp.evaluate(`document.getElementById("simulationModeSavedBtn").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationSavedPresets").classList.contains("hidden")`);

    await cdp.evaluate(`document.getElementById("simulationModeWorkspaceBtn").click();`);
    await waitForCondition(cdp, `!document.getElementById("simulationWorkspace").classList.contains("hidden")`);
    await sleep(250);

    const workspaceState = await cdp.evaluate(`(() => ({
      workspaceActive: document.getElementById('simulationModeWorkspaceBtn').classList.contains('is-active'),
      outputNames: Array.from(document.querySelectorAll('#simulationOutputLane .simulation-card-name')).map((node) => String(node.textContent || '').trim()),
      outputEmptyText: String(document.getElementById('simulationOutputLane').textContent || '').trim()
    }))()`);

    assert.equal(workspaceState.workspaceActive, true, "returning from the saved tab should reactivate the workspace tab");
    assert.equal(workspaceState.outputNames.includes(selectedOutputName), true, "switching simulation tabs should not discard the unsaved workspace draft");
    assert.equal(workspaceState.outputEmptyText.includes("等待根据当前槽位推导产物组合"), false, "returning to workspace should not reopen a blank draft");
  });
}

async function test_limited_collection_picker_items_stay_disabled_and_ignore_clicks() {
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
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "Heat Treated"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `(() => Array.from(document.querySelectorAll(".simulation-picker-item")).some((item) => item.classList.contains("is-disabled") && String(item.querySelector(".simulation-picker-art-warning")?.textContent || "").includes("限量版物品不能加入炼金")))()`);
    await sleep(300);

    const beforeClick = await cdp.evaluate(`(() => {
      const blocked = Array.from(document.querySelectorAll('.simulation-picker-item')).find((item) => item.classList.contains('is-disabled') && String(item.querySelector('.simulation-picker-art-warning')?.textContent || '').includes('限量版物品不能加入炼金'));
      return {
        found: !!blocked,
        disabled: !!(blocked && blocked.disabled),
        ariaDisabled: blocked ? String(blocked.getAttribute('aria-disabled') || '').trim() : '',
        warningText: blocked ? String((blocked.querySelector('.simulation-picker-art-warning') || {}).textContent || '').trim() : '',
        materialCardCount: document.querySelectorAll('#simulationMaterialLane [data-simulation-card-role="material"]').length
      };
    })()`);

    assert.ok(beforeClick && beforeClick.found, "expected a disabled limited-edition picker card");
    assert.equal(beforeClick.disabled, true, "limited-edition picker cards should carry the native disabled attribute");
    assert.equal(beforeClick.ariaDisabled, "true", "limited-edition picker cards should also expose aria-disabled for accessibility");
    assert.equal(beforeClick.warningText.includes("限量版物品不能加入炼金"), true, "limited-edition picker cards should show the inline restriction warning");
    assert.equal(beforeClick.materialCardCount, 0, "before clicking the blocked card there should be no selected material cards");

    await cdp.evaluate(`(() => {
      const blocked = Array.from(document.querySelectorAll('.simulation-picker-item')).find((item) => item.classList.contains('is-disabled') && String(item.querySelector('.simulation-picker-art-warning')?.textContent || '').includes('限量版物品不能加入炼金'));
      if (blocked) blocked.click();
    })()`);
    await sleep(300);

    const afterClick = await cdp.evaluate(`(() => ({
      modalHidden: document.getElementById('simulationPickerModal').classList.contains('hidden'),
      materialCardCount: document.querySelectorAll('#simulationMaterialLane [data-simulation-card-role="material"]').length
    }))()`);

    assert.equal(afterClick.modalHidden, false, "clicking a disabled limited-edition picker card should not close the picker");
    assert.equal(afterClick.materialCardCount, 0, "clicking a disabled limited-edition picker card should not add anything to the material lane");
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
    const selectedMaterialName = await cdp.evaluate(`(() => String(document.querySelector(".simulation-picker-item .simulation-picker-art-title")?.textContent || "").trim())()`);
    assert.ok(selectedMaterialName, "expected a concrete material picker title before selection");
    await cdp.evaluate(`document.querySelector(".simulation-picker-item").click();`);
    await waitForCondition(cdp, `document.querySelectorAll('#simulationMaterialLane [data-simulation-card-role="material"]').length >= 1`);

    const materialCardState = await cdp.evaluate(`(() => {
      const selectedMaterialName = ${JSON.stringify(selectedMaterialName)};
      const firstCard = document.querySelector('#simulationMaterialLane [data-simulation-card-role="material"]');
      const chosenCard = Array.from(document.querySelectorAll('#simulationMaterialLane [data-simulation-card-role="material"]')).find((card) => {
        const nameNode = card.querySelector('.simulation-card-name');
        return String(nameNode && nameNode.textContent || '').trim() === selectedMaterialName;
      });
      const targetCard = chosenCard || firstCard;
      const firstArt = targetCard ? targetCard.querySelector('.simulation-card-art') : null;
      const firstFloat = targetCard ? targetCard.querySelector('.simulation-card-float') : null;
      const firstBar = targetCard ? targetCard.querySelector('.simulation-card-bar') : null;
      const firstBarMarkerStyle = firstBar ? getComputedStyle(firstBar, '::after') : null;
      const firstContent = targetCard ? targetCard.querySelector('.simulation-card-content') : null;
      const firstWearStack = targetCard ? targetCard.querySelector('.simulation-card-wear-stack') : null;
      const firstArtStripeStyle = firstArt ? getComputedStyle(firstArt, '::before') : null;
      const firstBarMarkerTop = firstBar && firstBarMarkerStyle
        ? firstBar.getBoundingClientRect().top + Number.parseFloat(firstBarMarkerStyle.top || '0')
        : null;
      const firstArtStripeRight = firstArt && firstArtStripeStyle
        ? firstArt.getBoundingClientRect().left
          + Number.parseFloat(firstArtStripeStyle.left || '0')
          + Number.parseFloat(firstArtStripeStyle.width || '0')
        : null;
      return {
        targetCardName: targetCard ? String((targetCard.querySelector('.simulation-card-name')?.textContent || '')).trim() : '',
        firstContentTopVsArtBottom: firstArt && firstContent
          ? firstContent.getBoundingClientRect().top - firstArt.getBoundingClientRect().bottom
          : -1,
        firstFloatBottomVsBarTop: firstFloat && firstBar
          ? firstFloat.getBoundingClientRect().bottom - firstBar.getBoundingClientRect().top
          : -1,
        firstFloatLeftVsStripeRight: firstFloat && firstArtStripeRight !== null
          ? firstFloat.getBoundingClientRect().left - firstArtStripeRight
          : -1,
        firstFloatBottomVsBarMarkerTop: firstFloat && firstBarMarkerTop !== null
          ? firstFloat.getBoundingClientRect().bottom - firstBarMarkerTop
          : -1,
        firstWearStackParentClass: firstWearStack && firstWearStack.parentElement
          ? String(firstWearStack.parentElement.className || '')
          : '',
        firstContentHasWearStack: !!(firstContent && firstContent.querySelector('.simulation-card-wear-stack')),
        firstWearStackBackgroundImage: firstWearStack ? String(getComputedStyle(firstWearStack).backgroundImage || '') : '',
        firstWearStackBackgroundColor: firstWearStack ? String(getComputedStyle(firstWearStack).backgroundColor || '') : '',
        firstWearStackBeforeBackgroundImage: firstWearStack ? String(getComputedStyle(firstWearStack, '::before').backgroundImage || '') : '',
        firstWearStackBeforeBackgroundColor: firstWearStack ? String(getComputedStyle(firstWearStack, '::before').backgroundColor || '') : '',
        firstWearStackAfterBackgroundImage: firstWearStack ? String(getComputedStyle(firstWearStack, '::after').backgroundImage || '') : '',
        firstWearStackAfterBackgroundColor: firstWearStack ? String(getComputedStyle(firstWearStack, '::after').backgroundColor || '') : '',
        firstFloatText: firstFloat ? String(firstFloat.textContent || '').trim() : '',
        firstFloatMatchesWearPattern: firstFloat ? /^(?:-|\\d+\\.\\d+)$/.test(String(firstFloat.textContent || '').trim()) : false,
        firstFloatWidth: firstFloat ? firstFloat.getBoundingClientRect().width : -1,
        firstArtWidth: firstArt ? firstArt.getBoundingClientRect().width : -1,
        firstFloatBeforeBackgroundImage: firstFloat ? String(getComputedStyle(firstFloat, '::before').backgroundImage || '') : '',
        firstFloatBeforeBackgroundColor: firstFloat ? String(getComputedStyle(firstFloat, '::before').backgroundColor || '') : '',
        firstFloatAfterBackgroundImage: firstFloat ? String(getComputedStyle(firstFloat, '::after').backgroundImage || '') : '',
        firstFloatAfterBackgroundColor: firstFloat ? String(getComputedStyle(firstFloat, '::after').backgroundColor || '') : '',
        firstFloatBackgroundColor: firstFloat ? String(getComputedStyle(firstFloat).backgroundColor || '') : ''
      };
    })()`);

    assert.equal(materialCardState.targetCardName, selectedMaterialName, "the runtime wear-geometry assertions should inspect the specifically chosen material card, not whichever card renders first");
    assert.equal(
      materialCardState.firstContentTopVsArtBottom > -0.5 && materialCardState.firstContentTopVsArtBottom < 0.5,
      true,
      "simulation material cards should return the title block below the artwork instead of keeping the old full-width black band"
    );
    assert.equal(
      materialCardState.firstWearStackParentClass.includes("simulation-card-art"),
      true,
      "simulation material cards should anchor the wear overlay inside the artwork container"
    );
    assert.equal(
      materialCardState.firstContentHasWearStack,
      false,
      "simulation material cards should stop rendering the wear overlay inside the lower text content block"
    );
    assert.equal(
      materialCardState.firstFloatMatchesWearPattern,
      true,
      "simulation material cards should also keep the compact wear chip as either a decimal wear value or the '-' fallback"
    );
    assert.equal(
      materialCardState.firstFloatLeftVsStripeRight > -1 && materialCardState.firstFloatLeftVsStripeRight < 1.5,
      true,
      "simulation material cards should align the wear chip flush to the inner edge of the left rarity stripe"
    );
    assert.equal(
      materialCardState.firstFloatBottomVsBarTop > -1 && materialCardState.firstFloatBottomVsBarTop < 1.5,
      true,
      "simulation material cards should dock the wear chip directly onto the wear-bar top edge to form a bottom-left right angle"
    );
    assert.equal(
      materialCardState.firstWearStackBackgroundImage === "none",
      true,
      "simulation material cards should remove the old full-width black wear-strip background"
    );
    assert.equal(
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(materialCardState.firstWearStackBackgroundColor),
      true,
      "simulation material cards should keep the wear-stack background itself transparent so a full-width black strip cannot silently return via background-color"
    );
    assert.equal(
      materialCardState.firstWearStackBeforeBackgroundImage === "none" &&
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(materialCardState.firstWearStackBeforeBackgroundColor) &&
      materialCardState.firstWearStackAfterBackgroundImage === "none" &&
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(materialCardState.firstWearStackAfterBackgroundColor),
      true,
      "simulation material cards should keep wear-stack pseudo-elements visually inert so the old black strip cannot return through ::before or ::after"
    );
    assert.equal(
      materialCardState.firstFloatWidth > 0 && materialCardState.firstArtWidth > 0 && materialCardState.firstFloatWidth < materialCardState.firstArtWidth * 0.75,
      true,
      "simulation material cards should keep the wear chip narrower than the artwork width so it remains a distinct corner chip instead of expanding across the whole artwork"
    );
    assert.equal(
      materialCardState.firstFloatBeforeBackgroundImage === "none" &&
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(materialCardState.firstFloatBeforeBackgroundColor) &&
      materialCardState.firstFloatAfterBackgroundImage === "none" &&
      ["rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "transparent"].includes(materialCardState.firstFloatAfterBackgroundColor),
      true,
      "simulation material cards should keep wear-chip pseudo-elements visually inert so a hidden black strip cannot return through ::before or ::after"
    );
    assert.equal(
      ["rgba(0, 0, 0, 0.9)", "rgba(0,0,0,0.9)"].includes(materialCardState.firstFloatBackgroundColor),
      true,
      "simulation material cards should keep only a compact black wear chip over the bar instead of the old wide black band"
    );

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

async function test_material_picker_disables_mixed_rarity_candidates_without_closing_modal() {
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

    const blockedBeforeClick = await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.simulation-picker-item'));
      const target = items[${Number(mismatchState.mismatchIndex) || 0}];
      const footer = target ? target.querySelector('.simulation-picker-item-warning') : null;
      const warning = footer ? footer.querySelector('.simulation-picker-art-warning') : null;
      return {
        found: !!target,
        disabled: !!(target && target.disabled),
        ariaDisabled: target ? String(target.getAttribute('aria-disabled') || '').trim() : '',
        hasFooterWarning: !!footer,
        warningText: warning ? String(warning.textContent || '').trim() : '',
        materialCardCount: document.querySelectorAll('#simulationMaterialLane [data-simulation-card-role="material"]').length
      };
    })()`);

    assert.ok(blockedBeforeClick && blockedBeforeClick.found, "expected a mismatched-rarity picker card to remain visible in the result list");
    assert.equal(blockedBeforeClick.disabled, true, "mismatched-rarity picker cards should be disabled before the user clicks them");
    assert.equal(blockedBeforeClick.ariaDisabled, "true", "mismatched-rarity picker cards should expose aria-disabled for accessibility");
    assert.equal(blockedBeforeClick.hasFooterWarning, true, "mismatched-rarity picker cards should render the warning in the footer area");
    assert.equal(blockedBeforeClick.warningText.includes("单配方需同一稀有度"), true, "mismatched-rarity picker cards should explain the same-rarity restriction");
    assert.equal(blockedBeforeClick.warningText.includes(lockedPick.rarity), true, "the footer warning should mention the currently locked rarity");
    assert.equal(blockedBeforeClick.warningText.includes(mismatchState.mismatchRarity), true, "the footer warning should mention the rejected rarity");

    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.simulation-picker-item'));
      const target = items[${Number(mismatchState.mismatchIndex) || 0}];
      if (target) target.click();
    })()`);
    await sleep(400);

    const blockedAfterClick = await cdp.evaluate(`(() => {
      const modal = document.getElementById('simulationPickerModal');
      const toast = document.querySelector('.error-toast.show .error-toast-text') || document.querySelector('.error-toast .error-toast-text');
      return {
        modalHidden: !!(modal && modal.classList.contains('hidden')),
        modalTitle: String((document.getElementById('simulationPickerTitle') || {}).textContent || '').trim(),
        toastText: toast ? String(toast.textContent || '').trim() : '',
        materialCardCount: document.querySelectorAll('#simulationMaterialLane [data-simulation-card-role="material"]').length
      };
    })()`);

    assert.equal(blockedAfterClick.modalHidden, false, "clicking a disabled mismatched-rarity picker card should not close the picker");
    assert.equal(blockedAfterClick.modalTitle, "选择辅料", "blocked material selection should keep the current slot context");
    assert.equal(blockedAfterClick.toastText.includes("单配方需同一稀有度"), false, "disabled mismatched-rarity picker cards should be blocked in-place instead of showing the old toast");
    assert.equal(blockedAfterClick.materialCardCount, blockedBeforeClick.materialCardCount, "clicking a disabled mismatched-rarity picker card should not add anything to the material lane");
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

async function test_picker_wide_weapon_cards_reduce_mid_gap() {
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
    await cdp.evaluate(`document.getElementById("simulationPickerSearchInput").value = "二西莫夫"; document.getElementById("simulationPickerSearchBtn").click();`);
    await waitForCondition(cdp, `(() => Array.from(document.querySelectorAll(".simulation-picker-item")).some((item) => String(item.querySelector(".simulation-picker-art-title")?.textContent || "").trim().includes("AWP | 二西莫夫")))()`);
    await waitForCondition(cdp, `(() => {
      const item = Array.from(document.querySelectorAll('.simulation-picker-item')).find((entry) => String(entry.querySelector('.simulation-picker-art-title')?.textContent || '').trim().includes('AWP | 二西莫夫'));
      const thumb = item ? item.querySelector('.simulation-picker-item-thumb') : null;
      return !!(thumb && thumb.complete && thumb.naturalWidth > 0 && thumb.naturalHeight > 0);
    })()`);
    await waitForCondition(cdp, `(() => {
      const item = Array.from(document.querySelectorAll('.simulation-picker-item')).find((entry) => String(entry.querySelector('.simulation-picker-art-title')?.textContent || '').trim().includes('AWP | 二西莫夫'));
      const thumb = item ? item.querySelector('.simulation-picker-item-thumb') : null;
      return !!(thumb && thumb.classList.contains('is-wide'));
    })()`);

    const pickerState = await cdp.evaluate(`(() => {
      const target = Array.from(document.querySelectorAll('.simulation-picker-item')).find((entry) => String(entry.querySelector('.simulation-picker-art-title')?.textContent || '').trim().includes('AWP | 二西莫夫'));
      const art = target ? target.querySelector('.simulation-picker-item-art') : null;
      const thumb = target ? target.querySelector('.simulation-picker-item-thumb') : null;
      const mask = target ? target.querySelector('.simulation-picker-art-mask') : null;
      if (!target || !art || !thumb || !mask) return null;
      const artRect = art.getBoundingClientRect();
      const thumbRect = thumb.getBoundingClientRect();
      const maskRect = mask.getBoundingClientRect();
      return {
        titleText: String(target.querySelector('.simulation-picker-art-title')?.textContent || '').trim(),
        thumbWideClass: thumb.classList.contains('is-wide'),
        gapRatio: artRect.height > 0 ? (maskRect.top - thumbRect.bottom) / artRect.height : -1,
        thumbBottomRatio: artRect.height > 0 ? (thumbRect.bottom - artRect.top) / artRect.height : -1
      };
    })()`);

    assert.ok(pickerState, "expected wide-weapon picker card metrics");
    assert.equal(pickerState.titleText.includes("AWP | 二西莫夫"), true, "expected the inspected picker card to target the wide weapon case");
    assert.equal(pickerState.thumbWideClass, true, "wide picker thumbnails should receive a dedicated layout class");
    assert.equal(pickerState.gapRatio >= -0.04 && pickerState.gapRatio <= 0.06, true, "wide weapon picker cards should remove the large mid-gap without sinking too far under the lower caption mask");
    assert.equal(pickerState.thumbBottomRatio >= 0.68 && pickerState.thumbBottomRatio <= 0.84, true, "wide weapon picker art should extend further downward while staying within the intended lower-band range");
  });
}

async function test_picker_broken_thumbnail_falls_back_to_placeholder() {
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
    await waitForCondition(cdp, `document.querySelectorAll(".simulation-picker-item-thumb").length > 0`);

    const fallbackState = await cdp.evaluate(`(() => {
      const thumbProto = HTMLImageElement.prototype;
      const completeDesc = Object.getOwnPropertyDescriptor(thumbProto, 'complete');
      const naturalWidthDesc = Object.getOwnPropertyDescriptor(thumbProto, 'naturalWidth');
      const naturalHeightDesc = Object.getOwnPropertyDescriptor(thumbProto, 'naturalHeight');
      const restore = () => {
        if (completeDesc) Object.defineProperty(thumbProto, 'complete', completeDesc);
        if (naturalWidthDesc) Object.defineProperty(thumbProto, 'naturalWidth', naturalWidthDesc);
        if (naturalHeightDesc) Object.defineProperty(thumbProto, 'naturalHeight', naturalHeightDesc);
      };
      try {
        Object.defineProperty(thumbProto, 'complete', {
          configurable: true,
          get() {
            if (this.classList && this.classList.contains('simulation-picker-item-thumb')) return true;
            return completeDesc && typeof completeDesc.get === 'function' ? completeDesc.get.call(this) : true;
          }
        });
        Object.defineProperty(thumbProto, 'naturalWidth', {
          configurable: true,
          get() {
            if (this.classList && this.classList.contains('simulation-picker-item-thumb')) return 0;
            return naturalWidthDesc && typeof naturalWidthDesc.get === 'function' ? naturalWidthDesc.get.call(this) : 0;
          }
        });
        Object.defineProperty(thumbProto, 'naturalHeight', {
          configurable: true,
          get() {
            if (this.classList && this.classList.contains('simulation-picker-item-thumb')) return 0;
            return naturalHeightDesc && typeof naturalHeightDesc.get === 'function' ? naturalHeightDesc.get.call(this) : 0;
          }
        });
        renderTradeupSimulationPickerResults();
        const firstArt = document.querySelector('.simulation-picker-item-art');
        return {
          hasThumb: !!document.querySelector('.simulation-picker-item-thumb'),
          hasPlaceholder: !!document.querySelector('.simulation-picker-item-art .simulation-card-art-empty'),
          artHasImage: firstArt ? firstArt.classList.contains('has-image') : true
        };
      } finally {
        restore();
        renderTradeupSimulationPickerResults();
      }
    })()`);

    assert.ok(fallbackState, "expected broken-thumbnail fallback metrics");
    assert.equal(fallbackState.hasThumb, false, "cached-failure thumbnails should be removed from picker cards");
    assert.equal(fallbackState.hasPlaceholder, true, "cached-failure thumbnails should fall back to the empty-art placeholder");
    assert.equal(fallbackState.artHasImage, false, "cached-failure thumbnails should also clear the has-image art state");
  });
}

async function main() {
  await test_clicking_output_chooser_opens_picker_without_inline_slot_cards();
  await test_picker_search_dedupes_results_and_renders_visible_thumbnails();
  await test_clicking_search_result_populates_output_lane_immediately();
  await test_switching_pages_preserves_unsaved_simulation_workspace_draft();
  await test_switching_simulation_mode_tabs_preserves_unsaved_workspace_draft();
  await test_limited_collection_picker_items_stay_disabled_and_ignore_clicks();
  await test_material_chooser_defaults_to_next_empty_slot();
  await test_material_chooser_can_switch_to_a_different_collection();
  await test_material_picker_disables_mixed_rarity_candidates_without_closing_modal();
  await test_output_lane_expands_selected_output_collections();
  await test_picker_search_results_take_real_scrollable_height();
  await test_picker_search_results_render_compact_three_column_cards();
  await test_picker_wide_weapon_cards_reduce_mid_gap();
  await test_picker_broken_thumbnail_falls_back_to_placeholder();
  console.log("tradeup-simulation-picker-interaction tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
