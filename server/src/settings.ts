import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

export type DetectionConfidence = "high" | "medium" | "low";

export interface DetectionCandidate {
  provider: Source;
  path: string;
  kind: "file" | "directory";
  confidence: DetectionConfidence;
  reason: string;
  matchCount: number;
  sample: string[];
}

export interface SourceDetection {
  provider: Source;
  candidates: DetectionCandidate[];
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

function appDataDir(): string {
  return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
}

function localAppDataDir(): string {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
}

function pushUnique(paths: string[], next: string): void {
  const trimmed = next.trim();
  if (trimmed && !paths.includes(trimmed)) paths.push(trimmed);
}

function envCandidates(provider: Source): string[] {
  const vars: Record<Source, string[]> = {
    cli: ["COPILOT_HOME"],
    vscode: ["VSCODE_PORTABLE", "VSCODE_APPDATA"],
    claude: ["CLAUDE_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_DATA_DIR"],
    openai: ["CODEX_HOME", "OPENAI_HOME", "OPENAI_CONFIG_DIR"],
  };

  const out: string[] = [];
  for (const key of vars[provider]) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    if (provider === "cli") pushUnique(out, path.join(value, "session-store.db"));
    else if (provider === "vscode") {
      pushUnique(out, value);
      pushUnique(out, path.join(value, "User", "workspaceStorage"));
      pushUnique(out, path.join(value, "User", "globalStorage"));
    } else if (provider === "claude") {
      pushUnique(out, value);
      pushUnique(out, path.join(value, "projects"));
    } else {
      pushUnique(out, value);
      pushUnique(out, path.join(value, "sessions"));
    }
  }
  return out;
}

function defaultCandidates(provider: Source): string[] {
  const out: string[] = [];
  if (provider === "cli") pushUnique(out, CLI_DB_PATH);
  if (provider === "vscode") {
    pushUnique(out, vscodeWorkspaceStorageDir());
    pushUnique(out, vscodeGlobalStorageDir());
  }
  if (provider === "claude") {
    pushUnique(out, claudeProjectsDir());
    pushUnique(out, path.join(appDataDir(), "Claude"));
    pushUnique(out, path.join(localAppDataDir(), "Claude"));
  }
  if (provider === "openai") {
    pushUnique(out, codexSessionsDir());
    pushUnique(out, path.join(os.homedir(), ".openai"));
    pushUnique(out, path.join(appDataDir(), "OpenAI"));
    pushUnique(out, path.join(localAppDataDir(), "OpenAI"));
  }
  return out;
}

function findFiles(root: string, options: { suffix: string; maxDepth: number; maxMatches: number; include?: (file: string) => boolean }): string[] {
  const out: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (out.length >= options.maxMatches || depth > options.maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (out.length >= options.maxMatches) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(options.suffix)) continue;
      if (options.include && !options.include(full)) continue;
      out.push(full);
    }
  };

  walk(root, 0);
  return out;
}

function addCandidate(acc: DetectionCandidate[], next: DetectionCandidate | null): void {
  if (!next) return;
  if (acc.some((candidate) => candidate.path === next.path)) return;
  acc.push(next);
}

function analyzeCliPath(candidatePath: string): DetectionCandidate | null {
  const stat = validatePath(candidatePath);
  if (!stat.exists || stat.kind !== "file") return null;
  if (path.basename(candidatePath).toLowerCase() !== "session-store.db") return null;
  return {
    provider: "cli",
    path: candidatePath,
    kind: "file",
    confidence: "high",
    reason: "Found copilot-cli SQLite session database",
    matchCount: 1,
    sample: [candidatePath],
  };
}

function analyzeVscodePath(candidatePath: string): DetectionCandidate | null {
  const stat = validatePath(candidatePath);
  if (!stat.exists || stat.kind !== "directory") return null;
  const jsonl = findFiles(candidatePath, {
    suffix: ".jsonl",
    maxDepth: 4,
    maxMatches: 8,
    include: (file) => /chatSessions|emptyWindowChatSessions/i.test(file),
  });
  if (jsonl.length > 0) {
    return {
      provider: "vscode",
      path: candidatePath,
      kind: "directory",
      confidence: "high",
      reason: "Found VS Code chat session logs",
      matchCount: jsonl.length,
      sample: jsonl.slice(0, 3),
    };
  }
  if (/workspaceStorage|globalStorage/i.test(candidatePath)) {
    return {
      provider: "vscode",
      path: candidatePath,
      kind: "directory",
      confidence: "medium",
      reason: "VS Code storage directory exists but no session logs were found yet",
      matchCount: 0,
      sample: [],
    };
  }
  return null;
}

function analyzeJsonlDirectory(provider: Source, candidatePath: string, reason: string): DetectionCandidate | null {
  const stat = validatePath(candidatePath);
  if (!stat.exists || stat.kind !== "directory") return null;
  const jsonl = findFiles(candidatePath, { suffix: ".jsonl", maxDepth: 4, maxMatches: 8 });
  if (jsonl.length > 0) {
    return {
      provider,
      path: candidatePath,
      kind: "directory",
      confidence: "high",
      reason,
      matchCount: jsonl.length,
      sample: jsonl.slice(0, 3),
    };
  }
  return {
    provider,
    path: candidatePath,
    kind: "directory",
    confidence: "medium",
    reason: `${reason}; directory exists but no session logs were found yet`,
    matchCount: 0,
    sample: [],
  };
}

function scanNamedDirs(roots: string[], pattern: RegExp, maxDepth: number): string[] {
  const matches: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || matches.length >= 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= 8) break;
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (pattern.test(entry.name)) matches.push(full);
      walk(full, depth + 1);
    }
  };

  for (const root of roots) {
    if (fs.existsSync(root)) walk(root, 0);
  }
  return matches;
}

function discoverFamilyStorageRoots(): string[] {
  const base = appDataDir();
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/(^Code($| )|Cursor|Windsurf|VSCodium)/i.test(entry.name)) continue;
    pushUnique(out, path.join(base, entry.name, "User", "workspaceStorage"));
    pushUnique(out, path.join(base, entry.name, "User", "globalStorage"));
  }
  return out;
}

function ranked(candidates: DetectionCandidate[]): DetectionCandidate[] {
  const score = (candidate: DetectionCandidate) => {
    const confidence = candidate.confidence === "high" ? 0 : candidate.confidence === "medium" ? 1 : 2;
    return confidence * 1000 - candidate.matchCount;
  };
  return [...candidates].sort((a, b) => score(a) - score(b) || a.path.localeCompare(b.path));
}

export function detectSource(provider: Source): SourceDetection {
  const candidates: DetectionCandidate[] = [];

  for (const configured of loadSettings().sources.filter((source) => source.provider === provider)) {
    if (provider === "cli") addCandidate(candidates, analyzeCliPath(configured.path));
    if (provider === "vscode") addCandidate(candidates, analyzeVscodePath(configured.path));
    if (provider === "claude") addCandidate(candidates, analyzeJsonlDirectory(provider, configured.path, "Found Claude Code session directory"));
    if (provider === "openai") addCandidate(candidates, analyzeJsonlDirectory(provider, configured.path, "Found OpenAI/Codex session directory"));
  }

  for (const candidatePath of [...envCandidates(provider), ...defaultCandidates(provider)]) {
    if (provider === "cli") addCandidate(candidates, analyzeCliPath(candidatePath));
    if (provider === "vscode") addCandidate(candidates, analyzeVscodePath(candidatePath));
    if (provider === "claude") addCandidate(candidates, analyzeJsonlDirectory(provider, candidatePath, "Found Claude Code session directory"));
    if (provider === "openai") addCandidate(candidates, analyzeJsonlDirectory(provider, candidatePath, "Found OpenAI/Codex session directory"));
  }

  if (provider === "vscode") {
    for (const candidatePath of discoverFamilyStorageRoots()) {
      addCandidate(candidates, analyzeVscodePath(candidatePath));
    }
  }

  if (provider === "claude") {
    const roots = [os.homedir(), appDataDir(), localAppDataDir()];
    for (const dir of scanNamedDirs(roots, /claude|anthropic/i, 2)) {
      addCandidate(candidates, analyzeJsonlDirectory(provider, dir, "Found Claude-related directory with session logs"));
      addCandidate(candidates, analyzeJsonlDirectory(provider, path.join(dir, "projects"), "Found Claude projects directory"));
    }
  }

  if (provider === "openai") {
    const roots = [os.homedir(), appDataDir(), localAppDataDir()];
    for (const dir of scanNamedDirs(roots, /codex|openai/i, 2)) {
      addCandidate(candidates, analyzeJsonlDirectory(provider, dir, "Found OpenAI-related directory with session logs"));
      addCandidate(candidates, analyzeJsonlDirectory(provider, path.join(dir, "sessions"), "Found Codex sessions directory"));
    }
  }

  return { provider, candidates: ranked(candidates).slice(0, 8) };
}
