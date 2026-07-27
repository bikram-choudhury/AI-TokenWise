import fs from "node:fs";
import path from "node:path";
import { loadCliSessions } from "./adapters/cliAdapter.js";
import { loadVscodeSessions } from "./adapters/vscodeAdapter.js";
import { loadClaudeSessions } from "./adapters/claudeCodeAdapter.js";
import { loadOpenaiSessions } from "./adapters/openaiAdapter.js";
import { enabledSources, SourceConfig } from "./settings.js";
import { Source, UnifiedSession, emptySourceCounts } from "./types.js";

interface Snapshot {
  sessions: UnifiedSession[];
  scannedAt: string;
  errors: string[];
}

let snapshot: Snapshot | null = null;

function loadForSource(cfg: SourceConfig): UnifiedSession[] {
  switch (cfg.provider) {
    case "cli":
      return loadCliSessions(cfg.path);
    case "vscode":
      return loadVscodeSessions([cfg.path]);
    case "claude":
      return loadClaudeSessions(cfg.path);
    case "openai":
      return loadOpenaiSessions(cfg.path);
    default:
      return [];
  }
}

export function refresh(): Snapshot {
  const errors: string[] = [];
  const all: UnifiedSession[] = [];
  const seen = new Set<string>();

  for (const cfg of enabledSources()) {
    try {
      for (const s of loadForSource(cfg)) {
        const key = `${s.source}:${s.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(s);
      }
    } catch (err) {
      errors.push(`${cfg.provider} (${cfg.label}): ${(err as Error).message}`);
    }
  }

  const sessions = all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  snapshot = { sessions, scannedAt: new Date().toISOString(), errors };
  return snapshot;
}

export function getSnapshot(): Snapshot {
  return snapshot ?? refresh();
}

export interface Filter {
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive)
  source?: Source | "all";
}

export function filterSessions(filter: Filter): UnifiedSession[] {
  const { from, to, source } = filter;
  const fromMs = from ? new Date(from).getTime() : -Infinity;
  // `to` is inclusive of the whole day
  const toMs = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity;
  return getSnapshot().sessions.filter((s) => {
    if (source && source !== "all" && s.source !== source) return false;
    const t = new Date(s.startedAt).getTime();
    return t >= fromMs && t <= toMs;
  });
}

export function findSession(source: string, id: string): UnifiedSession | undefined {
  return getSnapshot().sessions.find((s) => s.source === source && s.id === id);
}

export interface SearchHit {
  id: string;
  source: Source;
  slug: string;
  model: string;
  repository?: string;
  startedAt: string;
  matchCount: number;
  snippet: string;
}

/**
 * Cross-session content search: matches the query (case-insensitive) against
 * message text within each session, plus slug/repo/model metadata. Returns the
 * best snippet and a per-session match count.
 */
export function searchSessions(filter: Filter, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (const s of filterSessions(filter)) {
    let matchCount = 0;
    let snippet = "";

    const metaHit =
      s.slug.toLowerCase().includes(q) ||
      (s.repository?.toLowerCase().includes(q) ?? false) ||
      s.model.toLowerCase().includes(q);

    for (const t of s.turns) {
      const idx = t.text.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      matchCount++;
      if (!snippet) {
        const start = Math.max(0, idx - 40);
        snippet =
          (start > 0 ? "…" : "") +
          t.text.slice(start, idx + q.length + 60).replace(/\s+/g, " ").trim() +
          "…";
      }
    }

    if (matchCount > 0 || metaHit) {
      hits.push({
        id: s.id,
        source: s.source,
        slug: s.slug,
        model: s.model,
        repository: s.repository,
        startedAt: s.startedAt,
        matchCount,
        snippet: snippet || s.slug,
      });
    }
  }

  return hits.sort((a, b) => b.matchCount - a.matchCount).slice(0, 100);
}

export function sourceAvailability(): Record<Source, number> {
  const snap = getSnapshot();
  const counts = emptySourceCounts();
  for (const s of snap.sessions) counts[s.source] += 1;
  return counts;
}

let watchTimer: NodeJS.Timeout | null = null;
const watchers: fs.FSWatcher[] = [];

/**
 * Watch the local data sources and rebuild the snapshot when files change.
 * Debounced so bursts of WAL/JSONL writes trigger a single rescan.
 */
export function startWatching(): void {
  if (watchers.length) return; // already watching

  const scheduleRefresh = () => {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      try {
        const snap = refresh();
        console.log(`[tokenwise] auto-refresh: ${snap.sessions.length} sessions`);
      } catch (err) {
        console.error("[tokenwise] auto-refresh failed:", err);
      }
    }, 1500);
  };

  const dirs = new Set<string>();
  for (const cfg of enabledSources()) {
    const p = cfg.path;
    if (!p) continue;
    try {
      // Watch directories directly; for a file (e.g. the CLI db) watch its parent.
      const dir = fs.existsSync(p) && fs.statSync(p).isDirectory() ? p : path.dirname(p);
      dirs.add(dir);
    } catch {
      dirs.add(path.dirname(p));
    }
  }

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const w = fs.watch(dir, { recursive: true }, scheduleRefresh);
      w.on("error", () => {});
      watchers.push(w);
    } catch {
      // recursive watch unsupported on some platforms; fall back to flat watch
      try {
        watchers.push(fs.watch(dir, scheduleRefresh));
      } catch {
        /* ignore unwatchable dir */
      }
    }
  }
}

/** Tear down and re-establish watchers (e.g. after settings change). */
export function restartWatching(): void {
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  watchers.length = 0;
  startWatching();
}

