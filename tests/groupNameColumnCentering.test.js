const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.join(__dirname, "..", "node_sidecar", "ui", "styles.css");
const appPath = path.join(__dirname, "..", "node_sidecar", "ui", "app.js");
const css = fs.readFileSync(cssPath, "utf8");
const app = fs.readFileSync(appPath, "utf8");

const headingMatches = app.match(/group-name-heading/g) || [];

assert.equal(
  headingMatches.length >= 2,
  true,
  "both inventory and craft group tables should mark the name header with a dedicated centering class"
);

assert.match(
  css,
  /\.group-name-heading,\s*\.group-name-cell\s*\{[^}]*text-align:\s*center;/m,
  "the name column header and cells should share a dedicated centered alignment rule"
);

assert.doesNotMatch(
  css,
  /\.group-table th:nth-child\(2\),\s*\.group-table td:nth-child\(2\)\s*\{[^}]*text-align:\s*left;/m,
  "the old nth-child left alignment should be removed so tables with a select column do not drift out of sync"
);

assert.match(
  css,
  /#inventoryPage \.group-name-cell\.has-skin-image \.group-name-label\s*\{[^}]*transform:\s*translateX\(/m,
  "inventory overview name labels should visually compensate for the left skin-image gutter so the column still reads centered"
);

console.log("groupNameColumnCentering tests passed");
