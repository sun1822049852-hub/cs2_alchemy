const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "ui", "app.js"), "utf8");

assert.match(source, /item\.is_enabled\s*\?\?\s*item\.enabled/);
assert.match(source, /status\s*===\s*"available"/);
assert.match(source, /new_password\s*:/);
assert.match(source, /data\.reason\s*\|\|\s*data\.code/);
assert.match(source, /\/api\/admin\/products\/[\s\S]*method:\s*"DELETE"/);

console.log("control-plane-ui-data-contract tests passed");
