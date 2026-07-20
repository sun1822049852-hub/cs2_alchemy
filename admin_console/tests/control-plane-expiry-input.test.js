const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const INDEX_PATH = path.resolve(__dirname, "../ui/index.html");
const INDEX_SOURCE = fs.readFileSync(INDEX_PATH, "utf8");

function test_expiry_editor_uses_separate_date_and_time_inputs() {
  assert.equal(
    INDEX_SOURCE.includes('id="userExpiryDate"'),
    true,
    "会员到期编辑器应提供独立日期输入"
  );
  assert.equal(
    INDEX_SOURCE.includes('id="userExpiryTime"'),
    true,
    "会员到期编辑器应提供独立时间输入"
  );
  const userEditor = INDEX_SOURCE.slice(
    INDEX_SOURCE.indexOf('for="userExpiryDate"'),
    INDEX_SOURCE.indexOf('id="membershipMeta"')
  );
  assert.equal(
    userEditor.includes('type="datetime-local"'),
    false,
    "用户会员到期编辑器不应依赖 datetime-local 作为唯一输入控件"
  );
}

function main() {
  test_expiry_editor_uses_separate_date_and_time_inputs();
  console.log("control-plane-expiry-input tests passed");
}

main();
