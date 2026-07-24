import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CLI_DB_PATH } from "../config.js";
import {
  UnifiedSession,
  UnifiedTurn,
  TokenUsage,
  emptyUsage,
} from "../types.js";

interface SessionRow {
  id: string;
  cwd: string | null;
  repository: string | null;
  branch: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

interface UsageRow {
  session_id: string;
  turn_index: number;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  request_multiplier: number | null;
  total_nano_aiu: number | null;
}

interface TurnRow {
  session_id: string;
  turn_index: number;
  user_message: string | null;
  assistant_response: string | null;
  timestamp: string | null;
}

/**
 * Open the live CLI DB read-only. Because the DB is in WAL mode and may be
 * actively written, we fall back to copying the db + sidecar files to a temp
 * location if a direct read-only open fails.
 */
function openDb(): DatabaseSync | null {
  if (!fs.existsSync(CLI_DB_PATH)) return null;
  try {
    return new DatabaseSync(CLI_DB_PATH, { readOnly: true });
  } catch {
    try {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenwise-cli-"));
      for (const suffix of ["", "-wal", "-shm"]) {
        const src = CLI_DB_PATH + suffix;
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpDir, "db" + suffix));
      }
      return new DatabaseSync(path.join(tmpDir, "db"), { readOnly: true });
    } catch (err) {
      console.error("[cli-adapter] failed to open DB:", err);
      return null;
    }
  }
}

function usageFromRow(r: UsageRow): TokenUsage {
  const input = r.input_tokens ?? 0;
  const output = r.output_tokens ?? 0;
  const cacheRead = r.cache_read_tokens ?? 0;
  const cacheWrite = r.cache_write_tokens ?? 0;
  const reasoning = r.reasoning_tokens ?? 0;
  // total_nano_aiu is billed cost in nano-AIU (1 AIU = 1e9 nano-AIU).
  const aiu = (r.total_nano_aiu ?? 0) / 1e9;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: input + output,
    aiu,
  };
}

function accumulate(target: TokenUsage, add: TokenUsage): void {
  target.input += add.input;
  target.output += add.output;
  target.cacheRead += add.cacheRead;
  target.cacheWrite += add.cacheWrite;
  target.reasoning += add.reasoning;
  target.total += add.total;
  target.aiu += add.aiu;
}

export function loadCliSessions(): UnifiedSession[] {
  const db = openDb();
  if (!db) return [];
  try {
    const sessions = db
      .prepare(
        `SELECT id, cwd, repository, branch, summary, created_at, updated_at FROM sessions`
      )
      .all() as unknown as SessionRow[];

    const usageCols = new Set(
      (
        db.prepare(`PRAGMA table_info(assistant_usage_events)`).all() as unknown as {
          name: string;
        }[]
      ).map((c) => c.name)
    );
    const hasAiu = usageCols.has("total_nano_aiu");
    const hasMultiplier = usageCols.has("request_multiplier");

    const usageRows = db
      .prepare(
        `SELECT session_id, turn_index, model, input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens, reasoning_tokens,
                ${hasMultiplier ? "request_multiplier" : "NULL AS request_multiplier"},
                ${hasAiu ? "total_nano_aiu" : "NULL AS total_nano_aiu"}
         FROM assistant_usage_events`
      )
      .all() as unknown as UsageRow[];

    const turnRows = db
      .prepare(
        `SELECT session_id, turn_index, user_message, assistant_response, timestamp
         FROM turns ORDER BY session_id, turn_index`
      )
      .all() as unknown as TurnRow[];

    // Aggregate usage per session and per turn, and count models per session.
    const sessionUsage = new Map<string, TokenUsage>();
    const turnUsage = new Map<string, TokenUsage>(); // key: sessionId#turnIndex
    const modelCounts = new Map<string, Map<string, number>>();

    for (const r of usageRows) {
      const u = usageFromRow(r);
      const su = sessionUsage.get(r.session_id) ?? emptyUsage();
      accumulate(su, u);
      sessionUsage.set(r.session_id, su);

      const tKey = `${r.session_id}#${r.turn_index}`;
      const tu = turnUsage.get(tKey) ?? emptyUsage();
      accumulate(tu, u);
      turnUsage.set(tKey, tu);

      if (r.model) {
        const mc = modelCounts.get(r.session_id) ?? new Map<string, number>();
        mc.set(r.model, (mc.get(r.model) ?? 0) + 1);
        modelCounts.set(r.session_id, mc);
      }
    }

    const turnsBySession = new Map<string, TurnRow[]>();
    for (const t of turnRows) {
      const arr = turnsBySession.get(t.session_id) ?? [];
      arr.push(t);
      turnsBySession.set(t.session_id, arr);
    }

    const dominantModel = (sid: string): string => {
      const mc = modelCounts.get(sid);
      if (!mc) return "unknown";
      let best = "unknown";
      let bestN = -1;
      for (const [m, n] of mc) if (n > bestN) ((best = m), (bestN = n));
      return best;
    };

    return sessions.map((s): UnifiedSession => {
      const turns: UnifiedTurn[] = [];
      let idx = 0;
      for (const t of turnsBySession.get(s.id) ?? []) {
        if (t.user_message) {
          turns.push({
            index: idx++,
            role: "user",
            text: t.user_message,
            timestamp: t.timestamp ?? undefined,
          });
        }
        if (t.assistant_response) {
          turns.push({
            index: idx++,
            role: "assistant",
            text: t.assistant_response,
            timestamp: t.timestamp ?? undefined,
            usage: turnUsage.get(`${s.id}#${t.turn_index}`),
          });
        }
      }

      const usage = sessionUsage.get(s.id) ?? emptyUsage();
      const slug =
        (s.summary && s.summary.trim()) ||
        (turns.find((t) => t.role === "user")?.text ?? "").slice(0, 80) ||
        s.id.slice(0, 8);

      return {
        id: s.id,
        source: "cli",
        slug,
        repository: s.repository ?? undefined,
        cwd: s.cwd ?? undefined,
        model: dominantModel(s.id),
        startedAt: s.created_at,
        updatedAt: s.updated_at,
        turns,
        usage,
      };
    });
  } catch (err) {
    console.error("[cli-adapter] query failed:", err);
    return [];
  } finally {
    db.close();
  }
}
