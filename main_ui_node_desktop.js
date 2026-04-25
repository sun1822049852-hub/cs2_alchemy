const {spawn} = require("child_process");
const path = require("path");
const fs = require("fs");
const {buildDesktopLauncherEnv} = require("./node_sidecar/src/devDesktopLaunchEnv");

const sidecarDir = path.resolve(__dirname, "node_sidecar");
const electronMain = path.join(sidecarDir, "electron-main.js");
const electronBinWin = path.join(sidecarDir, "node_modules", ".bin", "electron.cmd");
const electronBinPosix = path.join(sidecarDir, "node_modules", ".bin", "electron");
const electronBin = process.platform === "win32" ? electronBinWin : electronBinPosix;

function hasNodeInspectorFlag(value) {
  return /^--inspect(?:-brk)?(?:=.*)?$/i.test(String(value || "").trim());
}

function resolveDesktopLauncherMode({baseEnv = process.env, execArgv = process.execArgv} = {}) {
  const args = Array.isArray(execArgv) ? execArgv : [];
  if (args.some(hasNodeInspectorFlag)) {
    return "dev";
  }
  const nodeOptions = String(baseEnv && baseEnv.NODE_OPTIONS || "").trim();
  if (nodeOptions && nodeOptions.split(/\s+/).some(hasNodeInspectorFlag)) {
    return "dev";
  }
  return "release";
}

if (!fs.existsSync(electronMain)) {
  // eslint-disable-next-line no-console
  console.error("Missing file: node_sidecar/electron-main.js");
  process.exit(1);
}

if (!fs.existsSync(electronBin)) {
  // eslint-disable-next-line no-console
  console.error("Electron is not installed. Run: cd node_sidecar && npm install");
  process.exit(1);
}

function startDesktopLauncher({baseEnv = process.env, spawnImpl = spawn, execArgv = process.execArgv} = {}) {
  const isWin = process.platform === "win32";
  return spawnImpl(electronBin, [electronMain], {
    cwd: sidecarDir,
    stdio: "inherit",
    shell: isWin,
    env: buildDesktopLauncherEnv(baseEnv, {
      projectRoot: __dirname,
      mode: resolveDesktopLauncherMode({baseEnv, execArgv})
    })
  });
}

if (require.main === module) {
  const child = startDesktopLauncher();
  child.on("exit", (code) => {
    process.exit(code || 0);
  });
}

module.exports = {
  startDesktopLauncher,
  resolveDesktopLauncherMode
};
