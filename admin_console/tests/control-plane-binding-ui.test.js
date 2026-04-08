const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const INDEX_SOURCE = fs.readFileSync(path.resolve(__dirname, "..", "ui", "index.html"), "utf8");
const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, "..", "ui", "app.js"), "utf8");

assert.equal(
  INDEX_SOURCE.includes("Steam 绑定资格"),
  true,
  "admin console should expose a dedicated Steam binding management panel"
);

assert.equal(
  APP_SOURCE.includes("解除绑定资格"),
  true,
  "admin console should expose a revoke binding action for manual reset"
);

assert.equal(
  APP_SOURCE.includes("/steam-bindings"),
  true,
  "admin console should request Steam binding data from the admin API"
);

console.log("control-plane-binding-ui tests passed");
