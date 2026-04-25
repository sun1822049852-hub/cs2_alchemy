const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.resolve(__dirname, "../electron-builder.yml");
const CONFIG_TEXT = fs.readFileSync(CONFIG_PATH, "utf8");
const UI_SERVER_PATH = path.resolve(__dirname, "../src/uiServer.js");
const UI_SERVER_TEXT = fs.readFileSync(UI_SERVER_PATH, "utf8");
const INSTALLER_INCLUDE_PATH = path.resolve(__dirname, "../build/installer.nsh");
const ICON_ICO_PATH = path.resolve(__dirname, "../build/icon.ico");
const ICON_PNG_PATH = path.resolve(__dirname, "../build/icon.png");
const RELEASE_CONFIG_PATH = path.resolve(__dirname, "../build/client_config.release.json");
const SKIN_DB_SEED_PATH = path.resolve(__dirname, "../build/csgo_skins.seed.db");

function test_nsis_installer_defaults_to_custom_install_dir_with_desktop_shortcut() {
  assert.match(CONFIG_TEXT, /productName:\s*CS Tools/, "用户可见产品名应统一改为 CS Tools");
  assert.match(CONFIG_TEXT, /executableName:\s*CS Tools/, "Windows 可执行文件名应改为 CS Tools");
  assert.match(CONFIG_TEXT, /icon:\s*build\/icon\.ico/, "打包配置应显式指向新的 Windows 图标");
  assert.match(CONFIG_TEXT, /signAndEditExecutable:\s*false/, "当前 Windows 打包应关闭内置 rcedit，避免 app-builder 下载旧版 winCodeSign 导致构建不稳定");
  assert.match(CONFIG_TEXT, /oneClick:\s*false/, "安装器应提供向导，以便用户自定义安装位置");
  assert.match(
    CONFIG_TEXT,
    /allowToChangeInstallationDirectory:\s*true/,
    "安装器应允许用户自定义安装目录"
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
  assert.equal(fs.existsSync(SKIN_DB_SEED_PATH), true, "打包专用皮肤数据库种子 csgo_skins.seed.db 必须存在");
}

function test_packaged_release_resources_are_included() {
  assert.equal(fs.existsSync(RELEASE_CONFIG_PATH), true, "打包专用 client_config.release.json 必须存在");
  assert.match(
    CONFIG_TEXT,
    /from:\s*build\/client_config\.release\.json[\s\S]*to:\s*client_config\.json/,
    "安装包必须内置默认远端控制台配置"
  );
  assert.match(
    CONFIG_TEXT,
    /from:\s*\.\.\/schema_cache\.json[\s\S]*to:\s*schema_cache\.json/,
    "安装包必须内置 schema_cache.json 种子资源"
  );
  assert.match(
    CONFIG_TEXT,
    /from:\s*build\/csgo_skins\.seed\.db[\s\S]*to:\s*csgo_skins\.db/,
    "安装包必须内置 csgo_skins.db 种子资源"
  );
  assert.doesNotMatch(
    CONFIG_TEXT,
    /from:\s*\.\.\/csgo_skins\.db[\s\S]*to:\s*csgo_skins\.db/,
    "打包配置不应再直接引用根目录运行态 csgo_skins.db"
  );
  assert.match(
    CONFIG_TEXT,
    /from:\s*build\/icon\.ico[\s\S]*to:\s*app-icon\.ico/,
    "安装包必须内置 app-icon.ico，供运行时窗口与快捷方式统一复用"
  );
}

function test_packaged_runtime_does_not_depend_on_repo_root_tools() {
  assert.doesNotMatch(
    CONFIG_TEXT,
    /from:\s*\.\.\/tools\/enrichInventoryDisplayOnlyImages\.js[\s\S]*to:\s*tools\/enrichInventoryDisplayOnlyImages\.js/,
    "打包运行时不应再依赖仓库根目录 tools/enrichInventoryDisplayOnlyImages.js"
  );
  assert.doesNotMatch(
    CONFIG_TEXT,
    /from:\s*\.\.\/tools\/enrichMissingImages\.js[\s\S]*to:\s*tools\/enrichMissingImages\.js/,
    "打包运行时不应再依赖仓库根目录 tools/enrichMissingImages.js"
  );
  assert.doesNotMatch(
    UI_SERVER_TEXT,
    /\.\.\/\.\.\/tools\/enrichInventoryDisplayOnlyImages/,
    "uiServer 运行时不应跨到仓库根目录 tools 脚本"
  );
}

function test_shortcut_icon_override_script_exists() {
  assert.equal(fs.existsSync(INSTALLER_INCLUDE_PATH), true, "应提供 build/installer.nsh 覆盖默认快捷方式图标");
  const installerInclude = fs.readFileSync(INSTALLER_INCLUDE_PATH, "utf8");
  assert.match(
    installerInclude,
    /!macro customInstall[\s\S]*CreateShortCut "\$newDesktopLink" "\$appExe" "" "\$shortcutIcon"/,
    "安装后桌面快捷方式应显式绑定品牌图标"
  );
  assert.match(
    installerInclude,
    /!macro customInstall[\s\S]*CreateShortCut "\$newStartMenuLink" "\$appExe" "" "\$shortcutIcon"/,
    "安装后开始菜单快捷方式应显式绑定品牌图标"
  );
}

function main() {
  test_nsis_installer_defaults_to_custom_install_dir_with_desktop_shortcut();
  test_brand_icon_assets_exist();
  test_packaged_release_resources_are_included();
  test_packaged_runtime_does_not_depend_on_repo_root_tools();
  test_shortcut_icon_override_script_exists();
  console.log("windows-installer-entrypoint tests passed");
}

main();
