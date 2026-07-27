import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  SETTINGS_PATH,
  tokenwiseDir,
  CLI_DB_PATH,
  vscodeWorkspaceStorageDir,
  vscodeGlobalStorageDir,
  claudeProjectsDir,
  codexSessionsDir,
} from "./config.js";
import { Source } from "./types.js";

export interface SourceConfig {
  id: string;
  provider: Source;
  label: string;
  /** Absolute path to the file or directory this source reads from. */
  path: string;
  enabled: boolean;
}

export interface Settings {
  sources: SourceConfig[];
}

export const PROVIDER_LABELS: Record<Source, string> = {
  cli: "copilot-cli",
  vscode: "VSCode Copilot",
  claude: "Claude Code",
  openai: "OpenAI (Codex)",
};

function defaultSources(): SourceConfig[] {
  const mk = (provider: Source, label: string, p: string): SourceConfig => ({
    id: randomUUID(),
    provider,
    label,
    path: p,
    enabled: true,
  });
  return [
    mk("cli", "copilot-cli (default)", CLI_DB_PATH),
    mk("vscode", "VSCode workspace storage", vscodeWorkspaceStorageDir()),
    mk("vscode", "VSCode global storage", vscodeGlobalStorageDir()),
    mk("claude", "Claude Code (default)", claudeProjectsDir()),
    mk("openai", "OpenAI Codex (default)", codexSessionsDir()),
  ];
}

function defaultSettings(): Settings {
  return { sources: defaultSources() };
}

let cache: Settings | null = null;

function isValidSource(s: unknown): s is SourceConfig {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    (o.provider === "cli" || o.provider === "vscode" || o.provider === "claude" || o.provider === "openai") &&
    typeof o.label === "string" &&
    typeof o.path === "string" &&
    typeof o.enabled === "boolean"
  );
}

export function loadSettings(): Settings {
  if (cache) return cache;
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
      const sources = Array.isArray(raw?.sources) ? raw.sources.filter(isValidSource) : [];
      cache = { sources };
      return cache;
    }
  } catch (err) {
    console.error("[settings] failed to read, using defaults:", err);
  }
  cache = defaultSettings();
  saveSettings(cache);
  return cache;
}

export function saveSettings(settings: Settings): Settings {
  const clean: Settings = {
    sources: (settings.sources ?? [])
      .filter(isValidSource)
      .map((s) => ({ ...s, path: s.path.trim(), label: s.label.trim() || PROVIDER_LABELS[s.provider] })),
  };
  try {
    fs.mkdirSync(tokenwiseDir(), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(clean, null, 2), "utf-8");
  } catch (err) {
    console.error("[settings] failed to write:", err);
  }
  cache = clean;
  return clean;
}

/** Only the sources that are enabled and have a non-empty path. */
export function enabledSources(): SourceConfig[] {
  return loadSettings().sources.filter((s) => s.enabled && s.path.trim());
}

export interface PathValidation {
  path: string;
  exists: boolean;
  kind: "file" | "directory" | "missing";
}

export function validatePath(p: string): PathValidation {
  const trimmed = (p ?? "").trim();
  try {
    const stat = fs.statSync(trimmed);
    return { path: trimmed, exists: true, kind: stat.isDirectory() ? "directory" : "file" };
  } catch {
    return { path: trimmed, exists: false, kind: "missing" };
  }
}
