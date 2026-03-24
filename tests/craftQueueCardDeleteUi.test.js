const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");

const css = fs.readFileSync(cssPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");

assert.match(
  css,
  /\.craft-queue-group\s*\{[\s\S]*position:\s*relative;/m,
  "pending craft recipe cards should become positioning anchors so the delete button can sit in the top-right corner"
);

assert.match(
  css,
  /\.craft-queue-group\.deletable\s+\.craft-queue-group-head\s*\{[\s\S]*padding-right:\s*32px;/m,
  "pending craft recipe titles should reserve space for the top-right delete button"
);

assert.equal(
  app.includes('showDeleteAction ? " deletable" : ""'),
  true,
  "pending craft recipe cards should expose a deletable class whenever the card delete affordance is visible"
);

assert.equal(
  app.includes('removeBtn.className = "craft-queue-card-delete craft-queue-card-delete-floating";'),
  true,
  "pending and completed craft recipe cards should use the same floating delete button treatment"
);

assert.equal(
  app.includes("wrap.append(removeBtn);"),
  true,
  "pending craft recipe cards should append the delete button directly to the card wrapper so it can float in the top-right corner"
);

console.log("craftQueueCardDeleteUi tests passed");
