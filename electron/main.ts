import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import fs from 'fs';

const isDev = !app.isPackaged;
const PORT = 4000;

let mainWindow: BrowserWindow | null = null;

// Write to a log file so crashes are visible even when no terminal is attached.
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('logs'), 'main.log'), line);
  } catch { /* ignore log failures */ }
  console.log(msg);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'TokenWise',
    show: false,
  });

  // Dev: load Vite dev server. Production: load Express (which serves the built SPA).
  const url = isDev
    ? 'http://localhost:5173'
    : `http://localhost:${PORT}`;

  log(`Loading URL: ${url}`);
  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow?.webContents.openDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function waitForServer(retries = 30, intervalMs = 500): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      if (res.ok) {
        log('Server is ready');
        return;
      }
    } catch {
      // server not ready yet
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Server did not start on port ${PORT} after ${retries * intervalMs}ms`);
}

app.whenReady().then(async () => {
  log(`App ready — isDev=${isDev} resourcesPath=${app.isPackaged ? process.resourcesPath : 'n/a'}`);

  if (!isDev) {
    // Tell Express where the built client assets are located inside the package
    const staticDir = path.join(process.resourcesPath, 'client', 'dist');
    log(`Static dir: ${staticDir} exists=${fs.existsSync(staticDir)}`);
    process.env.ELECTRON_STATIC_DIR = staticDir;

    // Start the bundled Express server in-process (same Node.js runtime as Electron)
    const serverBundle = path.join(__dirname, 'server.js');
    log(`Loading server bundle: ${serverBundle}`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(serverBundle);

    // Wait until the server is accepting requests before opening the window
    log('Waiting for server...');
    await waitForServer();
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  log(`FATAL: ${message}`);
  dialog.showErrorBox('TokenWise failed to start', message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
