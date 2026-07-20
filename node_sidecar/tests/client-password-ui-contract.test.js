const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../ui/index.html"), "utf8");
const js = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");

for (const id of ["clientLoginPassword", "clientRegisterPassword", "clientResetPassword"]) {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
  assert.ok(tag, `missing ${id}`);
  assert.match(tag[0], /minlength="12"/);
  assert.match(tag[0], /maxlength="128"/);
}

assert.doesNotMatch(js, /client(?:Login|Register|Reset)Password[^\n]*\.trim\(\)/);

console.log("client-password-ui-contract tests passed");
