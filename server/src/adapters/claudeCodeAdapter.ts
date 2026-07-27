import fs from "node:fs";
import path from "node:path";
import { claudeProjectsDir } from "../config.js";
import { UnifiedSession, UnifiedTurn, TokenUsage, emptyUsage } from "../types.js";

/**
 * Claude Code stores conversation transcripts as append-only JSONL, one file
 * per session, under `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`.
 *
 * Each line is a JSON object. Relevant shapes (fields are defensive/optional):
 *   { type:"user"|"assistant", sessionId, cwd, gitBranch, timestamp,
 *     message:{ role, model?, content: string | Block[], usage?:{...} } }
 * Assistant usage: { input_tokens, output_tokens,
 *                    cache_creation_input_tokens, cache_read_input_tokens }
 */

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeMessage {
  role?: string;
  model?: string;
  content?: unknown;
  usage?: ClaudeUsage;
}

interface ClaudeLine {
  type?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  message?: ClaudeMessage;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") out.push(b.text);
    else if (b.type === "tool_use" && typeof b.name === "string") out.push(`\`${b.name}\``);
    else if (b.type === "tool_result" && typeof b.content === "string") out.push(b.content);
  }
  return out.join("").trim();
}

function usageFrom(u: ClaudeUsage | undefined): TokenUsage {
  const input = u?.input_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? 0;
  return { input, output, cacheRead, cacheWrite, reasoning: 0, total: input + output, aiu: 0 };
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
  const modelCounts = new Map<string, number>();
  let sessionId = path.basename(file, ".jsonl");
  let cwd: string | undefined;
  let branch: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let idx = 0;

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let d: ClaudeLine;
    try {
      d = JSON.parse(line) as ClaudeLine;
    } catch {
      continue;
    }
    if (d.sessionId) sessionId = d.sessionId;
    if (d.cwd) cwd = d.cwd;
    if (d.gitBranch) branch = d.gitBranch;
    const ts = d.timestamp;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    if (d.type !== "user" && d.type !== "assistant") continue;
    const text = extractText(d.message?.content);

    if (d.type === "user") {
      if (text) turns.push({ index: idx++, role: "user", text, timestamp: ts });
      continue;
    }

    // assistant
    const model = d.message?.model || "unknown";
    modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    const u = usageFrom(d.message?.usage);
    usage = {
      input: usage.input + u.input,
      output: usage.output + u.output,
      cacheRead: usage.cacheRead + u.cacheRead,
      cacheWrite: usage.cacheWrite + u.cacheWrite,
      reasoning: 0,
      total: usage.total + u.total,
      aiu: 0,
    };
    turns.push({ index: idx++, role: "assistant", text, model, timestamp: ts, usage: u });
  }

  if (turns.length === 0) return null;

  let dominant = "unknown";
  let bestN = -1;
  for (const [m, n] of modelCounts) if (n > bestN) ((dominant = m), (bestN = n));

  const created = firstTs ?? new Date().toISOString();
  const slug =
    (turns.find((t) => t.role === "user")?.text ?? "").slice(0, 80) || sessionId.slice(0, 8);
  const repository = branch || (cwd ? path.basename(cwd) : undefined);

  return {
    id: sessionId,
    source: "claude",
    slug,
    repository,
    cwd,
    model: dominant,
    startedAt: created,
    updatedAt: lastTs ?? created,
    turns,
    usage,
  };
}

export function loadClaudeSessions(root: string = claudeProjectsDir()): UnifiedSession[] {
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
      console.error("[claude-adapter] failed to parse", f, err);
    }
  }
  return sessions;
}
