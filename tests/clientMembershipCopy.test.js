const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const source = fs.readFileSync(appPath, "utf8");

assert.match(
  source,
  /新用户体验中，还可使用 \$\{remainingDays\} 天普通版权限/,
  "trial membership copy should mention the remaining standard-tier trial days"
);

assert.match(
  source,
  /体验期内可使用炼金，到期后将失效/,
  "trial membership copy should explain that craft is allowed during the trial"
);

assert.match(
  source,
  /体验已到期，请开通会员后继续使用炼金功能/,
  "inactive membership copy should explain that craft is unavailable after the trial expires"
);

assert.match(
  source,
  /当前版本支持绑定无限个 Steam 账号/,
  "member tier copy should explain the unlimited Steam binding benefit"
);

console.log("clientMembershipCopy tests passed");
