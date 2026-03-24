const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "node_sidecar", "ui", "index.html");
const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");

const htmlFragments = [
  'id="confirmModal"',
  'class="modal-card confirm-modal-card"',
  'id="confirmModalTitle"',
  'id="confirmModalMessage"',
  'id="confirmModalConfirmBtn"',
  'id="confirmModalCancelBtn"'
];

for (const fragment of htmlFragments) {
  assert.equal(
    html.includes(fragment),
    true,
    `confirm modal html should include fragment: ${fragment}`
  );
}

const cssFragments = [
  ".confirm-modal-card {",
  ".confirm-modal-message {",
  ".confirm-modal-confirm-btn {"
];

for (const fragment of cssFragments) {
  assert.equal(
    css.includes(fragment),
    true,
    `confirm modal css should include fragment: ${fragment}`
  );
}

const appFragments = [
  'confirmModal: document.getElementById("confirmModal")',
  'confirmModalTitle: document.getElementById("confirmModalTitle")',
  'confirmModalMessage: document.getElementById("confirmModalMessage")',
  'confirmModalConfirmBtn: document.getElementById("confirmModalConfirmBtn")',
  'confirmModalCancelBtn: document.getElementById("confirmModalCancelBtn")',
  "let confirmModalResolver = null;",
  "function closeConfirmModal(value = false) {",
  "function openConfirmModal(",
  "ui.confirmModal.classList.remove(\"hidden\");"
];

for (const fragment of appFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `confirm modal app logic should include fragment: ${fragment}`
  );
}

console.log("confirmModalUi tests passed");
