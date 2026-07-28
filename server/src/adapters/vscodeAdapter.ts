import fs from "node:fs";
import path from "node:path";
import { vscodeWorkspaceStorageDir, vscodeGlobalStorageDir } from "../config.js";
import {
  UnifiedSession,
  UnifiedTurn,
  TokenUsage,
  PromptCategory,
  emptyUsage,
} from "../types.js";

interface RawRequest {
  requestId?: string;
  timestamp?: number;
  modelId?: string;
  message?: { text?: string };
  response?: any[];
  completionTokens?: number;
  result?: {
    metadata?: {
      promptTokens?: number;
      outputTokens?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  details?: string;
}

/**
 * Apply a single JSON-patch mutation to `root`, creating intermediate
 * containers as needed. When `append` is true, `value` (an array) is
 * concatenated onto the array at the target path.
 */
function applyPatch(
  root: any,
  keyPath: Array<string | number>,
  value: unknown,
  append: boolean
): void {
  if (keyPath.length === 0) return;
  let node = root;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const key = keyPath[i];
    if (node[key] === undefined || node[key] === null) {
      node[key] = typeof keyPath[i + 1] === "number" ? [] : {};
    }
    node = node[key];
  }
  const last = keyPath[keyPath.length - 1];
  if (append) {
    const existing = Array.isArray(node[last]) ? node[last] : [];
    node[last] = existing.concat(Array.isArray(value) ? value : [value]);
  } else {
    node[last] = value;
  }
}

/**
 * Reconstruct the final session state from the append-only mutation log.
 * The log is a JSON-patch stream:
 *   kind:0 = full snapshot of the session state (`v`)
 *   kind:1 = set the value at path `k` to `v` (e.g. requests[i].completionTokens)
 *   kind:2 = append the array `v` onto the array at path `k`
 *            (e.g. append a new request to requests, or response parts to
 *             requests[i].response)
 * Older logs used kind:1 with a bare string `v` (no `k`) for the title.
 */
function foldSession(file: string): { title?: string; header: any; requests: RawRequest[] } | null {
  let state: any = null;
  let title: string | undefined;

  let content: string;
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const kind = d.kind;
    const v = d.v;
    const k: Array<string | number> | undefined = Array.isArray(d.k) ? d.k : undefined;

    if (kind === 0) {
      state = v && typeof v === "object" ? v : {};
      continue;
    }
    if (state === null) state = {};

    if (kind === 1 && k && k.length > 0) {
      applyPatch(state, k, v, false);
    } else if (kind === 2 && k && k.length > 0) {
      applyPatch(state, k, v, true);
    } else if (kind === 1 && !k && typeof v === "string" && title === undefined) {
      title = v;
    }
  }

  if (!state) return null;
  if (typeof state.customTitle === "string" && title === undefined) title = state.customTitle;
  const requests: RawRequest[] = Array.isArray(state.requests) ? state.requests : [];
  return { title, header: state, requests };
}

function extractResponseText(parts: any[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  const out: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    if (p.kind === "markdownContent") {
      const val = p.content?.value ?? p.value;
      if (typeof val === "string") out.push(val);
    } else if (p.kind === "inlineReference" && p.inlineReference?.name) {
      out.push(`\`${p.inlineReference.name}\``);
    } else if (typeof p.value === "string" && p.kind !== "thinking") {
      out.push(p.value);
    }
  }
  return out.join("").trim();
}

function requestUsage(r: RawRequest): TokenUsage {
  const meta = r.result?.metadata;
  const input = typeof meta?.promptTokens === "number" ? meta.promptTokens : 0;
  const output =
    typeof r.completionTokens === "number"
      ? r.completionTokens
      : typeof meta?.outputTokens === "number"
        ? meta.outputTokens
        : 0;
  return { input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: input + output, aiu: 0 };
}

function promptBreakdown(_r: RawRequest): PromptCategory[] | undefined {
  return undefined;
}

function stripModel(modelId?: string): string {
  if (!modelId) return "unknown";
  return modelId.includes("/") ? modelId.split("/").pop()! : modelId;
}

function buildSession(file: string): UnifiedSession | null {
  const folded = foldSession(file);
  if (!folded) return null;
  const { header, requests, title } = folded;

  const sessionId: string = header.sessionId ?? path.basename(file, ".jsonl");
  const created = header.creationDate ? new Date(header.creationDate).toISOString() : new Date().toISOString();

  const turns: UnifiedTurn[] = [];
  let usage = emptyUsage();
  const modelCounts = new Map<string, number>();
  let idx = 0;
  let lastTs = created;

  for (const r of requests) {
    const model = stripModel(r.modelId);
    modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    const ts = r.timestamp ? new Date(r.timestamp).toISOString() : undefined;
    if (ts) lastTs = ts;

    const userText = r.message?.text ?? "";
    if (userText) {
      turns.push({ index: idx++, role: "user", text: userText, timestamp: ts });
    }

    const u = requestUsage(r);
    usage = {
      input: usage.input + u.input,
      output: usage.output + u.output,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: usage.total + u.total,
      aiu: 0,
    };

    const respText = extractResponseText(r.response);
    turns.push({
      index: idx++,
      role: "assistant",
      text: respText,
      model,
      timestamp: ts,
      usage: u,
      promptBreakdown: promptBreakdown(r),
    });
  }

  let dominant = "unknown";
  let bestN = -1;
  for (const [m, n] of modelCounts) if (n > bestN) ((dominant = m), (bestN = n));

  const slug =
    (requests.find((r) => r.message?.text)?.message?.text ?? "").slice(0, 80) ||
    (title && title.trim()) ||
    sessionId.slice(0, 8);

  return {
    id: sessionId,
    source: "vscode",
    slug,
    startedAt: created,
    updatedAt: lastTs,
    model: dominant,
    turns,
    usage,
  };
}

export function loadVscodeSessions(
  roots: string[] = [vscodeWorkspaceStorageDir(), vscodeGlobalStorageDir()]
): UnifiedSession[] {
  const files: string[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const chatDir = path.join(root, entry, "chatSessions");
      const directDir = path.join(root, entry); // globalStorage/emptyWindowChatSessions/*.json
      for (const dir of [chatDir, directDir]) {
        if (!fs.existsSync(dir)) continue;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(dir);
        } catch {
          continue;
        }
        if (!stat.isDirectory()) continue;
        try {
          for (const f of fs.readdirSync(dir)) {
            if (f.endsWith(".jsonl")) files.push(path.join(dir, f));
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

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
      console.error("[vscode-adapter] failed to parse", f, err);
    }
  }
  return sessions;
}
