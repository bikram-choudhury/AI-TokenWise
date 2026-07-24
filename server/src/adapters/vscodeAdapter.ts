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
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    promptTokenDetails?: Array<{ category?: string; label?: string; percentageOfPrompt?: number }>;
  };
  details?: string;
}

function isRequestList(v: unknown): v is RawRequest[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof v[0] === "object" &&
    v[0] !== null &&
    "requestId" in (v[0] as object) &&
    "message" in (v[0] as object)
  );
}

/**
 * Reconstruct the final request list from the append-only mutation log.
 * kind:0 = snapshot (header + requests[])
 * kind:2 list with requestId+message = new request(s) appended
 * kind:2 list otherwise = response parts appended to the current request
 * kind:1 dict with usage = usage/metadata patch for the current request
 * kind:1 string = session title
 */
function foldSession(file: string): { title?: string; header: any; requests: RawRequest[] } | null {
  let header: any = null;
  let requests: RawRequest[] = [];
  let current: RawRequest | null = null;
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

    if (kind === 0) {
      header = v;
      requests = Array.isArray(v?.requests) ? [...v.requests] : [];
      current = requests.length ? requests[requests.length - 1] : null;
    } else if (kind === 2 && isRequestList(v)) {
      for (const r of v) requests.push(r);
      current = requests[requests.length - 1];
    } else if (kind === 2 && Array.isArray(v) && current) {
      current.response = (current.response ?? []).concat(v);
    } else if (kind === 1 && v && typeof v === "object" && !Array.isArray(v) && "usage" in v && current) {
      current.usage = v.usage;
      if (typeof v.details === "string") current.details = v.details;
    } else if (kind === 1 && typeof v === "string" && title === undefined) {
      title = v;
    }
  }

  if (!header) return null;
  return { title, header, requests };
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
  const input = r.usage?.promptTokens ?? 0;
  const output = r.usage?.completionTokens ?? 0;
  return { input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: input + output, aiu: 0 };
}

function promptBreakdown(r: RawRequest): PromptCategory[] | undefined {
  const details = r.usage?.promptTokenDetails;
  if (!Array.isArray(details) || details.length === 0) return undefined;
  return details.map((d) => ({
    category: d.category ?? "Other",
    label: d.label ?? d.category ?? "Other",
    pct: d.percentageOfPrompt ?? 0,
  }));
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

export function loadVscodeSessions(): UnifiedSession[] {
  const roots = [vscodeWorkspaceStorageDir(), vscodeGlobalStorageDir()];
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
