const assert = require("node:assert/strict");
const path = require("node:path");

const {resolveWindowIconPath} = require("../src/windowIconPath");

function test_dev_mode_uses_build_icon() {
  const iconPath = resolveWindowIconPath({
    isPackaged: false,
    appDir: "C:/tmp/cs2-alchemy/node_sidecar",
    resourcesPath: "C:/tmp/cs2-alchemy/node_sidecar/resources"
  });

  assert.equal(iconPath, path.join("C:/tmp/cs2-alchemy/node_sidecar", "build", "icon.ico"));
}

function test_packaged_mode_uses_packaged_icon_resource() {
  const iconPath = resolveWindowIconPath({
    isPackaged: true,
    appDir: "C:/tmp/cs2-alchemy/node_sidecar",
    resourcesPath: "C:/tmp/cs2-alchemy/App/resources"
  });

  assert.equal(iconPath, path.join("C:/tmp/cs2-alchemy/App/resources", "app-icon.ico"));
}

function main() {
  test_dev_mode_uses_build_icon();
  test_packaged_mode_uses_packaged_icon_resource();
  console.log("window-icon-path tests passed");
}

main();
