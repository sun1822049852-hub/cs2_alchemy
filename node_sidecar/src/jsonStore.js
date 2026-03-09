const fs = require("fs");
const path = require("path");

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
}

function readJson(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text);
  } catch (_) {
    return fallbackValue;
  }
}

function writeJson(filePath, value) {
  ensureDirFor(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

module.exports = {
  readJson,
  writeJson,
  ensureDirFor
};
