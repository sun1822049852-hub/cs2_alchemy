const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.resolve(__dirname, "../electron-builder.yml");
const CONFIG_TEXT = fs.readFileSync(CONFIG_PATH, "utf8");
const ICON_ICO_PATH = path.resolve(__dirname, "../build/icon.ico");
const ICON_PNG_PATH = path.resolve(__dirname, "../build/icon.png");

function test_nsis_installer_defaults_to_single_entry_user_experience() {
  assert.match(CONFIG_TEXT, /productName:\s*CS Tools/, "用户可见产品名应统一改为 CS Tools");
  assert.match(CONFIG_TEXT, /executableName:\s*CS Tools/, "Windows 可执行文件名应改为 CS Tools");
  assert.match(CONFIG_TEXT, /icon:\s*build\/icon\.ico/, "打包配置应显式指向新的 Windows 图标");
  assert.match(CONFIG_TEXT, /oneClick:\s*true/, "安装器应改为 one-click，避免向用户暴露安装向导");
  assert.match(
    CONFIG_TEXT,
    /allowToChangeInstallationDirectory:\s*false/,
    "安装器不应再向终端用户暴露安装目录选择"
  );
  assert.match(
    CONFIG_TEXT,
    /createDesktopShortcut:\s*always/,
    "安装后应始终创建桌面入口"
  );
  assert.match(
    CONFIG_TEXT,
    /createStartMenuShortcut:\s*true/,
    "安装后应保留开始菜单入口"
  );
  assert.match(
    CONFIG_TEXT,
    /shortcutName:\s*CS Tools/,
    "所有用户可见入口都应统一使用产品名"
  );
  assert.match(CONFIG_TEXT, /installerIcon:\s*build\/icon\.ico/, "安装器图标应复用新的品牌图标");
  assert.match(CONFIG_TEXT, /uninstallerIcon:\s*build\/icon\.ico/, "卸载器图标应复用新的品牌图标");
  assert.match(
    CONFIG_TEXT,
    /runAfterFinish:\s*true/,
    "安装完成后应支持直接进入程序"
  );
}

function test_brand_icon_assets_exist() {
  assert.equal(fs.existsSync(ICON_ICO_PATH), true, "Windows 图标资源 icon.ico 必须存在");
  assert.equal(fs.existsSync(ICON_PNG_PATH), true, "品牌预览图标 icon.png 必须存在");
}

function main() {
  test_nsis_installer_defaults_to_single_entry_user_experience();
  test_brand_icon_assets_exist();
  console.log("windows-installer-entrypoint tests passed");
}

main();
