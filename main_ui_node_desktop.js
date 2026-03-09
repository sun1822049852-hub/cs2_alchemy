const {spawn} = require("child_process");
const path = require("path");
const fs = require("fs");

const sidecarDir = path.resolve(__dirname, "node_sidecar");
const electronMain = path.join(sidecarDir, "electron-main.js");
const electronBinWin = path.join(sidecarDir, "node_modules", ".bin", "electron.cmd");
const electronBinPosix = path.join(sidecarDir, "node_modules", ".bin", "electron");
const electronBin = process.platform === "win32" ? electronBinWin : electronBinPosix;

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

const isWin = process.platform === "win32";
const child = spawn(electronBin, [electronMain], {
  cwd: sidecarDir,
  stdio: "inherit",
  shell: isWin
});

child.on("exit", (code) => {
  process.exit(code || 0);
});
