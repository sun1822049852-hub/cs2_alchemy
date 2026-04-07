const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

assert.match(
  appSource,
  /name:\s*String\(row\s*&&\s*\(row\.name\s*\|\|\s*row\.alchemy_name\)/,
  "component summary in UI should prefer concrete inventory row.name before generic alchemy_name"
);

console.log("inventoryComponentNamesUi tests passed");
