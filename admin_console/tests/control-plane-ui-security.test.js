const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

class TextNode {
  constructor(text = "") {
    this.nodeType = 3;
    this.textContent = String(text || "");
    this.parentNode = null;
  }

  get outerHTML() {
    return escapeHtml(this.textContent);
  }
}

class ElementNode {
  constructor(tagName = "div") {
    this.nodeType = 1;
    this.tagName = String(tagName || "div").toLowerCase();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.checked = false;
    this.value = "";
    this._className = "";
    this._textContent = "";
  }

  set className(value) {
    this._className = String(value || "");
    if (this._className) {
      this.attributes.set("class", this._className);
    } else {
      this.attributes.delete("class");
    }
  }

  get className() {
    return this._className;
  }

  get classList() {
    return {
      add: (...names) => {
        const current = new Set(this._className.split(/\s+/).filter(Boolean));
        names.forEach((name) => current.add(name));
        this.className = [...current].join(" ");
      },
      remove: (...names) => {
        const removed = new Set(names);
        this.className = this._className.split(/\s+/).filter((name) => !removed.has(name)).join(" ");
      }
    };
  }

  set textContent(value) {
    this.children = [];
    this._textContent = String(value || "");
  }

  get textContent() {
    return this.children.length
      ? this.children.map((child) => child.textContent).join("")
      : this._textContent;
  }

  set innerHTML(value) {
    const text = String(value || "");
    this.children = [new RawHtmlNode(text)];
    this._textContent = "";
  }

  get innerHTML() {
    return this.children.map((child) => child.outerHTML).join("");
  }

  get outerHTML() {
    const attrs = [];
    const merged = new Map(this.attributes);
    if (this.hidden) merged.set("hidden", "");
    if (this.disabled) merged.set("disabled", "");
    if (this.required) merged.set("required", "");
    if (this.checked) merged.set("checked", "");
    for (const [name, value] of merged.entries()) {
      attrs.push(value === "" ? name : `${name}="${escapeAttribute(value)}"`);
    }
    const attrText = attrs.length ? ` ${attrs.join(" ")}` : "";
    return `<${this.tagName}${attrText}>${escapeHtml(this._textContent)}${this.children.map((child) => child.outerHTML).join("")}</${this.tagName}>`;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    const child = typeof node === "string" ? new TextNode(node) : node;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = "";
    this.append(...nodes);
  }

  setAttribute(name, value) {
    const key = String(name || "");
    const text = String(value || "");
    this.attributes.set(key, text);
    if (key === "class") {
      this._className = text;
    }
  }

  getAttribute(name) {
    const key = String(name || "");
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  addEventListener() {
  }

  closest(selector) {
    const attrMatch = String(selector || "").match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    let node = this;
    while (node) {
      if (attrMatch) {
        const [, name, value] = attrMatch;
        if (node.attributes && node.attributes.has(name) && (value === undefined || node.attributes.get(name) === value)) {
          return node;
        }
      }
      node = node.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    const attrMatch = String(selector || "").match(/^\[([^=\]]+)="([^"]*)"\]$/);
    if (!attrMatch) {
      return null;
    }
    const [, name, value] = attrMatch;
    return findNode(this, (node) => node.attributes && node.attributes.get(name) === value);
  }
}

class RawHtmlNode {
  constructor(html = "") {
    this.nodeType = 11;
    this.html = String(html || "");
    this.textContent = this.html;
  }

  get outerHTML() {
    return this.html;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function findNode(node, predicate) {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) {
      return found;
    }
  }
  return null;
}

function createDocumentStub() {
  const refs = new Map();
  const document = {
    createElement(tagName) {
      return new ElementNode(tagName);
    },
    createTextNode(text) {
      return new TextNode(text);
    },
    querySelector(selector) {
      const key = String(selector || "").replace(/^#/, "");
      if (!refs.has(key)) {
        refs.set(key, new ElementNode("div"));
      }
      return refs.get(key);
    }
  };
  return {document, refs};
}

function loadAppForRendering() {
  const {document, refs} = createDocumentStub();
  const context = {
    console,
    document,
    window: {
      localStorage: {
        getItem() {
          return "";
        },
        setItem() {
        },
        removeItem() {
        }
      },
      confirm() {
        return true;
      }
    },
    fetch: async () => ({
      ok: true,
      headers: {get: () => "application/json"},
      json: async () => ({ok: true, needs_bootstrap: false})
    }),
    setTimeout,
    clearTimeout,
    Date,
    Number,
    String,
    Boolean,
    Set,
    Promise
  };
  vm.runInNewContext(`${APP_SOURCE}
globalThis.__adminConsoleTest = {
  state,
  refs,
  renderUsers,
  renderUserDetail,
  renderDevices,
  renderBindings,
  handleWorkspaceClick,
  loadSelectedUserRuntimeDetails,
  loadDashboard
};`, context, {filename: APP_PATH});
  return {app: context.__adminConsoleTest, refs, context};
}

function jsonResponse(status = 200, payload = {}) {
  return {
    ok: status >= 200 && status < 300,
    headers: {get: () => "application/json"},
    json: async () => payload
  };
}

function assertSafeMarkup(html, label, {requiresEscapedText = true} = {}) {
  assert.equal(
    html.includes("<script"),
    false,
    `${label} should not expose script-like dynamic text as HTML`
  );
  assert.equal(
    html.includes("<img"),
    false,
    `${label} should not expose tag-like dynamic text as HTML`
  );
  if (requiresEscapedText) {
    assert.equal(
      html.includes("&lt;"),
      true,
      `${label} should preserve dangerous characters as escaped text`
    );
  }
}

function test_dynamic_admin_fields_render_as_text_not_html() {
  const {app, refs} = loadAppForRendering();
  const dangerousName = 'alice <script>alert("x")</script>';
  const dangerousEmail = 'a"b<img src=x onerror="alert(1)">@example.com';
  app.state.session = {user: {username: "admin"}};
  app.state.plans = [
    {code: 'standard"><img src=x onerror="alert(2)">', permissions: ['craft.use<script>']}
  ];
  app.state.users = [{
    id: 1,
    username: dangerousName,
    email: dangerousEmail,
    membership_plan: 'standard"><script>',
    membership_expires_at: "2026-04-20T00:00:00.000Z",
    remaining_membership_days: 15,
    status: 'active"><img src=x onerror="alert(3)">',
    entitlements: {
      permissions: ['craft.use<script>alert("p")</script>']
    }
  }];
  app.state.selectedUserId = 1;
  app.state.devices = [{
    id: 7,
    device_id: 'device <img src=x onerror="alert(4)">',
    created_at: "2026-04-05T00:00:00.000Z",
    last_used_at: 'last <script>alert("d")</script>',
    expires_at: "2026-04-20T00:00:00.000Z"
  }];
  app.state.bindings = [{
    id: 9,
    steam_account_name: 'steam "name" <script>alert("b")</script>',
    steam_id: '7656<img src=x onerror="alert(5)">',
    first_bound_at: "2026-04-05T00:00:00.000Z",
    last_seen_at: "2026-04-06T00:00:00.000Z"
  }];

  app.renderUsers();
  app.renderUserDetail();

  assertSafeMarkup(refs.get("usersList").innerHTML, "user list");
  assertSafeMarkup(refs.get("userPlan").innerHTML, "plan list");
  assertSafeMarkup(refs.get("permissionList").innerHTML, "permission controls", {requiresEscapedText: false});
  assertSafeMarkup(refs.get("deviceList").innerHTML, "device list");
  assertSafeMarkup(refs.get("bindingList").innerHTML, "binding list");
}

async function test_device_revoke_requires_confirmation_and_reports_status() {
  const {app, refs, context} = loadAppForRendering();
  app.state.session = {user: {username: "admin"}};
  app.state.users = [{
    id: 1,
    username: "alice",
    email: "alice@example.com",
    membership_plan: "standard",
    membership_expires_at: "",
    remaining_membership_days: 0,
    status: "active",
    entitlements: {permissions: []}
  }];
  app.state.selectedUserId = 1;
  app.state.devices = [{
    id: 7,
    device_id: "device_alpha",
    created_at: "2026-04-05T00:00:00.000Z",
    last_used_at: "2026-04-06T00:00:00.000Z",
    expires_at: "2026-04-20T00:00:00.000Z"
  }];
  app.state.bindings = [];
  app.renderDevices();

  const button = findNode(refs.get("deviceList"), (node) => node.attributes && node.attributes.get("data-session-id") === "7");
  assert.ok(button, "device revoke button should render");

  const requestedPaths = [];
  let releaseFetch = null;
  context.fetch = async (requestPath) => {
    requestedPaths.push(requestPath);
    if (String(requestPath).endsWith("/devices")) {
      return jsonResponse(200, {ok: true, items: []});
    }
    if (String(requestPath).endsWith("/steam-bindings")) {
      return jsonResponse(200, {ok: true, items: []});
    }
    if (requestPath === "/api/admin/overview") {
      return jsonResponse(200, {ok: true, stats: {total_users: 1, active_users: 1, plans: 1}});
    }
    if (requestPath === "/api/admin/plans") {
      return jsonResponse(200, {ok: true, items: []});
    }
    if (requestPath === "/api/admin/users") {
      return jsonResponse(200, {ok: true, items: app.state.users});
    }
    return new Promise((resolve) => {
      releaseFetch = () => resolve({
        ok: true,
        headers: {get: () => "application/json"},
        json: async () => ({ok: true, message: "设备已吊销"})
      });
    });
  };
  const confirms = [];
  context.window.confirm = (message) => {
    confirms.push(message);
    return true;
  };

  const pending = app.handleWorkspaceClick({target: button});
  assert.equal(confirms.length, 1, "device revoke should ask for confirmation before calling API");
  assert.equal(button.disabled, true, "device revoke button should be disabled while request is pending");
  assert.equal(button.textContent.includes("吊销中"), true, "device revoke button should show a pending label");
  assert.equal(requestedPaths[0], "/api/admin/users/1/devices/7/revoke");

  releaseFetch();
  await pending;
  assert.equal(button.disabled, false, "device revoke button should be re-enabled after success");
  assert.equal(refs.get("authMessage").textContent.includes("设备已吊销"), true, "device revoke success should show a clear status");
}

async function test_device_revoke_cancel_does_not_call_api() {
  const {app, refs, context} = loadAppForRendering();
  app.state.session = {user: {username: "admin"}};
  app.state.users = [{
    id: 1,
    username: "alice",
    email: "alice@example.com",
    membership_plan: "standard",
    membership_expires_at: "",
    remaining_membership_days: 0,
    status: "active",
    entitlements: {permissions: []}
  }];
  app.state.selectedUserId = 1;
  app.state.devices = [{
    id: 7,
    device_id: "device_alpha",
    created_at: "2026-04-05T00:00:00.000Z",
    last_used_at: "2026-04-06T00:00:00.000Z",
    expires_at: "2026-04-20T00:00:00.000Z"
  }];
  app.renderDevices();

  const button = findNode(refs.get("deviceList"), (node) => node.attributes && node.attributes.get("data-session-id") === "7");
  const requestedPaths = [];
  context.fetch = async (requestPath) => {
    requestedPaths.push(requestPath);
    return jsonResponse(200, {ok: true});
  };
  context.window.confirm = () => false;

  await app.handleWorkspaceClick({target: button});

  assert.deepEqual(requestedPaths, [], "device revoke cancel should not call API");
  assert.equal(button.disabled, false, "device revoke cancel should leave button enabled");
}

async function test_device_revoke_failure_reenables_button_and_reports_error() {
  const {app, refs, context} = loadAppForRendering();
  app.state.session = {user: {username: "admin"}};
  app.state.users = [{
    id: 1,
    username: "alice",
    email: "alice@example.com",
    membership_plan: "standard",
    membership_expires_at: "",
    remaining_membership_days: 0,
    status: "active",
    entitlements: {permissions: []}
  }];
  app.state.selectedUserId = 1;
  app.state.devices = [{
    id: 7,
    device_id: "device_alpha",
    created_at: "2026-04-05T00:00:00.000Z",
    last_used_at: "2026-04-06T00:00:00.000Z",
    expires_at: "2026-04-20T00:00:00.000Z"
  }];
  app.renderDevices();

  const button = findNode(refs.get("deviceList"), (node) => node.attributes && node.attributes.get("data-session-id") === "7");
  context.window.confirm = () => true;
  context.fetch = async () => jsonResponse(500, {ok: false, message: "设备吊销失败"});

  await app.handleWorkspaceClick({target: button});

  assert.equal(button.disabled, false, "device revoke button should be re-enabled after failure");
  assert.equal(button.textContent.includes("吊销设备"), true, "device revoke button should restore its label after failure");
  assert.equal(refs.get("authMessage").textContent.includes("设备吊销失败"), true, "device revoke failure should show a clear error");
}

async function main() {
  test_dynamic_admin_fields_render_as_text_not_html();
  await test_device_revoke_requires_confirmation_and_reports_status();
  await test_device_revoke_cancel_does_not_call_api();
  await test_device_revoke_failure_reenables_button_and_reports_error();
  console.log("control-plane-ui-security tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
