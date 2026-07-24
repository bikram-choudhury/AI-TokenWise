import os from "node:os";
import path from "node:path";

const home = os.homedir();

export const CLI_DB_PATH = path.join(home, ".copilot", "session-store.db");

export function vscodeWorkspaceStorageDir(): string {
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  return path.join(appData, "Code", "User", "workspaceStorage");
}

export function vscodeGlobalStorageDir(): string {
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  return path.join(appData, "Code", "User", "globalStorage");
}

export const PORT = Number(process.env.PORT) || 4000;
