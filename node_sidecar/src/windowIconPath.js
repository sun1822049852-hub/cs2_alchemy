const path = require("node:path");

function resolveWindowIconPath({
  isPackaged = false,
  appDir = __dirname,
  resourcesPath = ""
} = {}) {
  if (isPackaged) {
    return path.join(resourcesPath, "app-icon.ico");
  }
  return path.join(appDir, "build", "icon.ico");
}

module.exports = {
  resolveWindowIconPath
};
