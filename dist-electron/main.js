var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// electron/main.ts
var import_electron = require("electron");
var import_path = __toESM(require("path"));
var import_fs = __toESM(require("fs"));
var isDev = !import_electron.app.isPackaged;
var PORT = 4e3;
var mainWindow = null;
function log(msg) {
  const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`;
  try {
    import_fs.default.appendFileSync(import_path.default.join(import_electron.app.getPath("logs"), "main.log"), line);
  } catch {
  }
  console.log(msg);
}
function createWindow() {
  const iconPath = isDev ? import_path.default.join(import_electron.app.getAppPath(), "assets", "icons", "icon.png") : import_path.default.join(process.resourcesPath, "assets", "icons", "icon.png");
  mainWindow = new import_electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    title: "TokenWise",
    icon: import_fs.default.existsSync(iconPath) ? iconPath : void 0,
    show: false
  });
  const url = isDev ? "http://localhost:5173" : `http://localhost:${PORT}`;
  log(`Loading URL: ${url}`);
  mainWindow.loadURL(url);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow?.webContents.openDevTools();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
async function waitForServer(retries = 30, intervalMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      if (res.ok) {
        log("Server is ready");
        return;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Server did not start on port ${PORT} after ${retries * intervalMs}ms`);
}
import_electron.app.whenReady().then(async () => {
  log(`App ready \u2014 isDev=${isDev} resourcesPath=${import_electron.app.isPackaged ? process.resourcesPath : "n/a"}`);
  if (!isDev) {
    const staticDir = import_path.default.join(process.resourcesPath, "client", "dist");
    log(`Static dir: ${staticDir} exists=${import_fs.default.existsSync(staticDir)}`);
    process.env.ELECTRON_STATIC_DIR = staticDir;
    const serverBundle = import_path.default.join(__dirname, "server.js");
    log(`Loading server bundle: ${serverBundle}`);
    require(serverBundle);
    log("Waiting for server...");
    await waitForServer();
  }
  createWindow();
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  log(`FATAL: ${message}`);
  import_electron.dialog.showErrorBox("TokenWise failed to start", message);
  import_electron.app.quit();
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") import_electron.app.quit();
});
