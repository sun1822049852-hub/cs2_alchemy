const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");

const {createServer} = require("../src/uiServer");
const {configureRuntimePaths} = require("../src/constants");

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

async function withPackagedLikeGuestPage(run) {
  const browserPath = findBrowserPath();
  if (!browserPath) {
    console.log("client-auth-modal-guest-interaction skipped: no browser found");
    return;
  }

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-packaged-like-"));
  configureRuntimePaths({
    projectRoot: path.resolve(__dirname, ".."),
    isPackaged: true,
    userDataDir: runtimeDir
  });

  const server = createServer({
    licenseConfigFactory: () => ({
      defaultAuthMode: "prod_login",
      defaultControlPlaneBaseUrl: "http://127.0.0.1:8787"
    })
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
    const debugPort = 9300 + Math.floor(Math.random() * 300);
    userDataDir = path.resolve(
      __dirname,
      "..",
      "..",
      "tmp",
      "edge-headless-profile",
      `client-auth-modal-test-${process.pid}-${Date.now()}`
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
    await waitForCondition(cdp, `document.getElementById("guestWorkspaceLoginBtn")`);
    await waitForCondition(cdp, `!document.getElementById("guestWorkspaceNotice").classList.contains("hidden")`);
    await sleep(600);

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
    await removeDirWithRetries(runtimeDir);
  }
}

async function test_guest_login_button_keeps_modal_open() {
  await withPackagedLikeGuestPage(async ({cdp}) => {
    const before = await cdp.evaluate(`(() => ({
      guestVisible: !document.getElementById("guestWorkspaceNotice").classList.contains("hidden"),
      modalHidden: document.getElementById("clientAuthModal").classList.contains("hidden")
    }))()`);
    assert.equal(before.guestVisible, true);
    assert.equal(before.modalHidden, true);

    await cdp.evaluate(`document.getElementById("guestWorkspaceLoginBtn").click();`);
    await sleep(800);

    const after = await cdp.evaluate(`(() => ({
      modalHidden: document.getElementById("clientAuthModal").classList.contains("hidden"),
      gateHidden: document.getElementById("licenseGate").classList.contains("hidden"),
      loginPanelHidden: document.getElementById("clientLoginPanel").classList.contains("hidden"),
      title: String(document.getElementById("licenseTitle").textContent || "").trim()
    }))()`);

    assert.equal(after.modalHidden, false, "guest login button should keep the auth modal visible");
    assert.equal(after.gateHidden, false, "guest login button should keep the auth gate visible");
    assert.equal(after.loginPanelHidden, false, "guest login button should leave the login panel active");
    assert.equal(after.title.includes("登录"), true);
  });
}

async function main() {
  await test_guest_login_button_keeps_modal_open();
  console.log("client-auth-modal-guest-interaction tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
