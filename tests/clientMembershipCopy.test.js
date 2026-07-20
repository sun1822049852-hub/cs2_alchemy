const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const source = fs.readFileSync(appPath, "utf8");

assert.match(
  source,
  /当前为基础版，可使用除炼金执行外的现有功能；开通高级会员版后可使用炼金/,
  "inactive membership copy should describe the single restricted permission"
);

assert.match(
  source,
  /高级会员版已生效，可使用全部现有功能/,
  "member copy should describe full current access"
);

assert.doesNotMatch(source, /\b(?:trial|standard)\b|普通版权限|绑定无限个 Steam 账号/i);

console.log("clientMembershipCopy tests passed");
