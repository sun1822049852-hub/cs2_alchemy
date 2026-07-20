const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const INDEX_SOURCE = fs.readFileSync(path.resolve(__dirname, "..", "ui", "index.html"), "utf8");
const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, "..", "ui", "app.js"), "utf8");

assert.equal(INDEX_SOURCE.includes("Steam 绑定资格"), false, "控制台不应再展示 Steam 绑定资格面板");
assert.equal(APP_SOURCE.includes("解除绑定资格"), false, "控制台不应再提供换绑操作");
assert.equal(APP_SOURCE.includes("/steam-bindings"), false, "控制台不应再请求 Steam 绑定数据");

console.log("control-plane-binding-ui tests passed");
