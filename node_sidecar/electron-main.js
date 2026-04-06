const {app, BrowserWindow, shell} = require("electron");
const path = require("path");
const {createServer} = require("./src/uiServer");

let mainWindow = null;
let uiServer = null;

async function startUiServer() {
  if (uiServer) {
    return uiServer;
  }
  uiServer = createServer();
  await new Promise((resolve, reject) => {
    uiServer.once("error", reject);
    uiServer.listen(0, "127.0.0.1", resolve);
  });
  return uiServer;
}

function buildWindow(url) {
  const win = new BrowserWindow({
    width: 1320,
    height: 780,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    title: "CS2 管理界面 (Node)",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "electron-preload.js")
    }
  });
  win.loadURL(url);

  win.webContents.setWindowOpenHandler(({url: targetUrl}) => {
    shell.openExternal(targetUrl);
    return {action: "deny"};
  });

  return win;
}

async function bootstrap() {
  await app.whenReady();

  // 开发模式：清除 Chromium 磁盘缓存，确保每次启动都加载最新 UI 文件
  const ses = require("electron").session.defaultSession;
  await ses.clearCache();

  const server = await startUiServer();
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 8787;
  const url = `http://127.0.0.1:${port}`;
  mainWindow = buildWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = buildWindow(url);
    }
  });
}

app.on("window-all-closed", async () => {
  try {
    if (uiServer) {
      await new Promise((resolve) => uiServer.close(resolve));
    }
  } catch (_) {
    // ignore close errors
  } finally {
    uiServer = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[electron] startup failed: ${err && err.message ? err.message : err}`);
  app.quit();
});
