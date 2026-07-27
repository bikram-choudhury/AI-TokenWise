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

/** Claude Code stores per-project session transcripts as JSONL. */
export function claudeProjectsDir(): string {
  return path.join(home, ".claude", "projects");
}

/** OpenAI Codex CLI stores rollout session logs as JSONL. */
export function codexSessionsDir(): string {
  return path.join(home, ".codex", "sessions");
}

/** Directory where TokenWise persists its own settings. */
export function tokenwiseDir(): string {
  return path.join(home, ".tokenwise");
}

export const SETTINGS_PATH = path.join(home, ".tokenwise", "settings.json");

export const PORT = Number(process.env.PORT) || 4000;
