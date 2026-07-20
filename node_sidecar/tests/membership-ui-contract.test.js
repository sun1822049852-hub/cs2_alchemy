const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../ui/index.html"), "utf8");
const js = fs.readFileSync(path.resolve(__dirname, "../ui/app.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../ui/styles.css"), "utf8");

function cssBlock(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing CSS selector: ${selector}`);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS selector: ${selector}`);
  return css.slice(start, end + 1);
}

function test_recharge_navigation_is_last_and_anchored_to_sidebar_bottom() {
  const webInventoryIndex = html.indexOf('id="navWebInventory"');
  const rechargeIndex = html.indexOf('id="navMembership"');
  const sidebarEnd = html.indexOf("</aside>", rechargeIndex);
  assert.equal(webInventoryIndex >= 0, true);
  assert.equal(rechargeIndex > webInventoryIndex, true);
  assert.equal(sidebarEnd > rechargeIndex, true);
  assert.match(html, /id="navMembership"[^>]*class="[^"]*nav-btn-bottom/);
  assert.match(css, /\.sidebar\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.nav-btn-bottom\s*\{[^}]*margin-top:\s*auto/s);
}

function test_membership_page_exposes_products_activation_and_placeholder_checkout() {
  for (const id of [
    "membershipPage",
    "membershipPlanValue",
    "membershipExpiresValue",
    "membershipRemainingValue",
    "membershipProductList",
    "membershipActivationCode",
    "membershipRedeemBtn",
    "membershipStatus"
  ]) {
    assert.equal(html.includes(`id="${id}"`), true, `missing ${id}`);
  }
  assert.equal(js.includes('api("/api/membership/products"'), true);
  assert.equal(js.includes('api("/api/membership/redeem"'), true);
  assert.equal(js.includes('api("/api/membership/checkout"'), true);
  assert.equal(js.includes("支付方式暂未开放"), true);
}

function test_membership_page_uses_the_current_dark_gold_theme() {
  const page = cssBlock("body.theme-inkblue #membershipPage");
  const header = cssBlock("body.theme-inkblue #membershipPage .membership-header");
  const product = cssBlock("body.theme-inkblue #membershipPage .membership-product-card");
  const primaryActions = cssBlock("body.theme-inkblue #membershipPage :is(.membership-redeem-row button, .membership-product-action)");
  assert.match(page, /--membership-accent:\s*#dca44c/);
  assert.match(page, /background:\s*linear-gradient/);
  assert.match(header, /rgba\(243, 199, 121,/);
  assert.match(header, /border-color:\s*var\(--membership-border-soft\)/);
  assert.match(product, /var\(--membership-surface-main\)/);
  assert.match(product, /var\(--membership-border-soft\)/);
  assert.match(primaryActions, /linear-gradient\(135deg, #f3c779, #dca44c\)/);
}

function test_craft_execution_requests_include_operation_ids() {
  const craftRequestBodies = [...js.matchAll(/api\("\/api\/craft\/(?:tradeup|tradeup-with-components)"[\s\S]{0,500}?body:\s*JSON\.stringify\(\{([\s\S]{0,350}?)\}\)/g)]
    .map((match) => match[1]);
  assert.equal(craftRequestBodies.length >= 4, true);
  assert.equal(craftRequestBodies.every((body) => /operation_id\s*:/.test(body)), true);
}

function main() {
  test_recharge_navigation_is_last_and_anchored_to_sidebar_bottom();
  test_membership_page_exposes_products_activation_and_placeholder_checkout();
  test_membership_page_uses_the_current_dark_gold_theme();
  test_craft_execution_requests_include_operation_ids();
  console.log("membership-ui-contract tests passed");
}

main();
