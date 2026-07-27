import fs from "node:fs";
import path from "node:path";
import { codexSessionsDir } from "../config.js";
import { UnifiedSession, UnifiedTurn, TokenUsage, emptyUsage } from "../types.js";

/**
 * OpenAI Codex CLI stores rollout logs as JSONL under
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`.
 *
 * Each line is `{ timestamp, type, payload }` (older builds inline the payload
 * at the top level). Relevant records (all fields defensive/optional):
 *   type:"session_meta"  payload:{ id, timestamp, cwd }
 *   type:"turn_context"  payload:{ model, cwd }
 *   type:"response_item" payload:{ type:"message", role, content:[{type,text}] }
 *   type:"event_msg"     payload:{ type:"token_count", info:{ total_token_usage:{...} } }
 * `total_token_usage` is cumulative, so per-turn usage is derived as a delta.
 */

interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

function normalize(u: CodexTokenUsage | undefined): TokenUsage {
  const rawInput = u?.input_tokens ?? 0;
  const cacheRead = u?.cached_input_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const reasoning = u?.reasoning_output_tokens ?? 0;
  const input = Math.max(0, rawInput - cacheRead);
  return { input, output, cacheRead, cacheWrite: 0, reasoning, total: input + output, aiu: 0 };
}

function diff(cur: TokenUsage, prev: TokenUsage): TokenUsage {
  const d = {
    input: Math.max(0, cur.input - prev.input),
    output: Math.max(0, cur.output - prev.output),
    cacheRead: Math.max(0, cur.cacheRead - prev.cacheRead),
    cacheWrite: 0,
    reasoning: Math.max(0, cur.reasoning - prev.reasoning),
    total: 0,
    aiu: 0,
  };
  d.total = d.input + d.output;
  return d;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if ((b.type === "input_text" || b.type === "output_text" || b.type === "text") && typeof b.text === "string") {
      out.push(b.text);
    }
  }
  return out.join("").trim();
}

function walkJsonl(dir: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(full, acc);
    else if (e.isFile() && e.name.endsWith(".jsonl")) acc.push(full);
  }
}

function buildSession(file: string): UnifiedSession | null {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }

  const turns: UnifiedTurn[] = [];
  let usage = emptyUsage();
  let prevCumulative = emptyUsage();
  const modelCounts = new Map<string, number>();
  let sessionId = path.basename(file, ".jsonl");
  let cwd: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let idx = 0;
  let lastAssistant: UnifiedTurn | null = null;
  let curModel = "unknown";

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = (d.type as string) || "";
    const payload = (d.payload && typeof d.payload === "object" ? d.payload : d) as Record<string, unknown>;
    const ts = (d.timestamp as string) || (payload.timestamp as string) || undefined;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    if (type === "session_meta") {
      if (typeof payload.id === "string") sessionId = payload.id;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      continue;
    }
    if (type === "turn_context") {
      if (typeof payload.model === "string") curModel = payload.model;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      continue;
    }

    const pType = (payload.type as string) || "";

    if (pType === "message") {
      const role = payload.role as string;
      const text = extractText(payload.content);
      if (role === "user") {
        if (text) turns.push({ index: idx++, role: "user", text, timestamp: ts });
      } else if (role === "assistant") {
        modelCounts.set(curModel, (modelCounts.get(curModel) ?? 0) + 1);
        const t: UnifiedTurn = { index: idx++, role: "assistant", text, model: curModel, timestamp: ts };
        turns.push(t);
        lastAssistant = t;
      }
      continue;
    }

    if (pType === "token_count") {
      const info = payload.info as Record<string, unknown> | undefined;
      const total = info?.total_token_usage as CodexTokenUsage | undefined;
      if (total) {
        const cumulative = normalize(total);
        const delta = diff(cumulative, prevCumulative);
        prevCumulative = cumulative;
        usage = {
          input: usage.input + delta.input,
          output: usage.output + delta.output,
          cacheRead: usage.cacheRead + delta.cacheRead,
          cacheWrite: 0,
          reasoning: usage.reasoning + delta.reasoning,
          total: usage.total + delta.total,
          aiu: 0,
        };
        if (lastAssistant) lastAssistant.usage = delta;
      }
    }
  }

  if (turns.length === 0) return null;

  let dominant = "unknown";
  let bestN = -1;
  for (const [m, n] of modelCounts) if (n > bestN) ((dominant = m), (bestN = n));

  const created = firstTs ?? new Date().toISOString();
  const slug =
    (turns.find((t) => t.role === "user")?.text ?? "").slice(0, 80) || sessionId.slice(0, 8);

  return {
    id: sessionId,
    source: "openai",
    slug,
    repository: cwd ? path.basename(cwd) : undefined,
    cwd,
    model: dominant,
    startedAt: created,
    updatedAt: lastTs ?? created,
    turns,
    usage,
  };
}

export function loadOpenaiSessions(root: string = codexSessionsDir()): UnifiedSession[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  walkJsonl(root, files);

  const sessions: UnifiedSession[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    try {
      const s = buildSession(f);
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        sessions.push(s);
      }
    } catch (err) {
      console.error("[openai-adapter] failed to parse", f, err);
    }
  }
  return sessions;
}
