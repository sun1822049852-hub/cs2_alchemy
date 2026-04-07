const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

assert.match(
  appSource,
  /const raw = isComponentRow\(row\)\s*\?\s*String\(row\.name \|\| row\.alchemy_name \|\| ""\)\.trim\(\)\s*:\s*String\(row\.alchemy_name \|\| ""\)\.trim\(\) \|\| String\(row\.name \|\| ""\)\.trim\(\);/,
  "inventory component display names should prefer concrete row.name before generic alchemy_name"
);

assert.doesNotMatch(
  appSource,
  /const raw = String\(row\.alchemy_name \|\| ""\)\.trim\(\) \|\| String\(row\.name \|\| ""\)\.trim\(\);/,
  "inventory component display names should not use the old alchemy-first fallback for every row"
);

console.log("inventoryComponentDisplayNameUi tests passed");
