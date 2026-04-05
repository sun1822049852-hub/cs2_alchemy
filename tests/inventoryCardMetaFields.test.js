const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const app = fs.readFileSync(appPath, "utf8");

const requiredFragments = [
  'if (showSeed) lines.push(`皮肤编号: ${Number(row.paint_index || 0)}  种子: ${Number(row.paint_seed || 0)}`);',
  'else lines.push(`皮肤编号: ${Number(row.paint_index || 0)}`);',
  'lines.push(`稀有度: ${rarityName(row)}`);'
];

for (const fragment of requiredFragments) {
  assert.equal(
    app.includes(fragment),
    true,
    `inventory cards should include fragment: ${fragment}`
  );
}

const forbiddenFragments = [
  'lines.push(`Asset: ${itemId || "-"}`);',
  '<td>Asset ${itemId || "-"}</td>',
  'lines.push(`品质/稀有度: ${qualityName(row)}(${Number(row.quality || 0)}) / ${rarityName(row)}(${Number(row.rarity || 0)})`);',
  'lines.push(`稀有度: ${rarityName(row)}(${Number(row.rarity || 0)})`);'
];

for (const fragment of forbiddenFragments) {
  assert.equal(
    app.includes(fragment),
    false,
    `inventory cards should not include fragment: ${fragment}`
  );
}

console.log("inventoryCardMetaFields tests passed");
