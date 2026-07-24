import { Source, UnifiedSession } from "./types.js";

export type Severity = "low" | "medium" | "high";

export interface Suggestion {
  heuristic: string;
  sessionId: string;
  source: Source;
  slug: string;
  model: string;
  title: string;
  rationale: string;
  severity: Severity;
  estSavingsTokens: number;
  estSavingsPct: number; // relative to this session's total tokens
  estSavingsAiu: number;
  topic: string; // search topic for the learning resource
}

export interface OptimizationReport {
  suggestions: Suggestion[];
  byHeuristic: {
    heuristic: string;
    title: string;
    count: number;
    estSavingsTokens: number;
    estSavingsAiu: number;
    topic: string;
  }[];
  totalTokens: number;
  totalEstSavingsTokens: number;
  totalEstSavingsAiu: number;
  totalEstSavingsPct: number;
  trend: { date: string; sessions: number; totalTokens: number; avgInputPerSession: number }[];
  regressions: { metric: string; message: string; changePct: number; severity: Severity }[];
}

const EXPENSIVE_MODEL = /opus|gpt-5|o1|o3/i;

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function sev(score: number, med: number, high: number): Severity {
  if (score >= high) return "high";
  if (score >= med) return "medium";
  return "low";
}

/** Average percentage a prompt-breakdown category occupies across a session's turns. */
function avgCategoryPct(s: UnifiedSession, match: RegExp): number {
  let sum = 0;
  let n = 0;
  for (const t of s.turns) {
    if (!t.promptBreakdown) continue;
    for (const b of t.promptBreakdown) {
      if (match.test(b.category) || match.test(b.label)) {
        sum += b.pct;
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 0;
}

export function suggestionsForSession(s: UnifiedSession): Suggestion[] {
  const out: Suggestion[] = [];
  const u = s.usage;
  const assistantTurns = s.turns.filter((t) => t.role === "assistant").length || 1;
  const inOutRatio = u.input / Math.max(u.output, 1);
  const readBase = u.input + u.cacheRead;
  const cacheHitRate = readBase > 0 ? u.cacheRead / readBase : 0;

  const base = {
    sessionId: s.id,
    source: s.source,
    slug: s.slug,
    model: s.model,
  };

  // 1. Bloated context — input dwarfs output on a large session.
  if (u.input > 40_000 && inOutRatio > 6) {
    const save = Math.round(u.input * 0.25);
    out.push({
      ...base,
      heuristic: "bloated-context",
      title: "Trim bloated context",
      rationale: `Input is ${inOutRatio.toFixed(1)}× the output (${u.input.toLocaleString()} in vs ${u.output.toLocaleString()} out). Much of that context is likely unused. Pruning it could cut ~25% of input tokens.`,
      severity: sev(inOutRatio, 10, 20),
      estSavingsTokens: save,
      estSavingsPct: pct(save, u.total),
      estSavingsAiu: u.aiu * 0.25 * (u.input / Math.max(u.total, 1)),
      topic: "how to reduce LLM prompt context size and token usage",
    });
  }

  // 2. Redundant tool definitions (VSCode prompt breakdown).
  const toolPct = avgCategoryPct(s, /tool/i);
  if (toolPct > 15 && u.input > 20_000) {
    const trimmable = (toolPct - 10) / 100;
    const save = Math.round(u.input * trimmable);
    out.push({
      ...base,
      heuristic: "redundant-tool-definitions",
      title: "Prune redundant tool definitions",
      rationale: `Tool definitions average ${toolPct.toFixed(0)}% of your prompt tokens. Disabling unused tools/MCP servers could trim that toward ~10% and save roughly ${save.toLocaleString()} input tokens.`,
      severity: sev(toolPct, 20, 30),
      estSavingsTokens: save,
      estSavingsPct: pct(save, u.total),
      estSavingsAiu: u.aiu * trimmable * (u.input / Math.max(u.total, 1)),
      topic: "reduce tool definition tokens in AI coding assistant prompts",
    });
  }

  // 3. Oversized history — long session resending full history each turn.
  if (assistantTurns >= 15 && u.input > 80_000) {
    const save = Math.round(u.input * 0.3);
    out.push({
      ...base,
      heuristic: "oversized-history",
      title: "Shorten oversized conversation history",
      rationale: `${assistantTurns} assistant turns accumulated ${u.input.toLocaleString()} input tokens — history is likely resent every turn. Starting fresh sessions or summarizing older turns could save ~30% of input.`,
      severity: sev(assistantTurns, 25, 50),
      estSavingsTokens: save,
      estSavingsPct: pct(save, u.total),
      estSavingsAiu: u.aiu * 0.3 * (u.input / Math.max(u.total, 1)),
      topic: "manage long chat conversation history to save LLM tokens",
    });
  }

  // 4. Low cache reuse — large CLI input with little cache hit (cost inefficiency).
  if (s.source === "cli" && readBase > 50_000 && cacheHitRate < 0.25) {
    const target = 0.5;
    const gained = Math.round((target - cacheHitRate) * readBase);
    out.push({
      ...base,
      heuristic: "low-cache-reuse",
      title: "Improve prompt cache reuse",
      rationale: `Only ${Math.round(cacheHitRate * 100)}% of read input came from cache. Keeping a stable prompt prefix and avoiding mid-session edits could lift reuse toward ~50%, re-serving ~${gained.toLocaleString()} tokens from cache at lower cost.`,
      severity: sev((0.5 - cacheHitRate) * 100, 20, 35),
      estSavingsTokens: gained,
      estSavingsPct: pct(gained, u.total),
      estSavingsAiu: u.aiu * 0.15,
      topic: "prompt caching how to improve cache hit rate LLM cost",
    });
  }

  // 5. Expensive model on a simple task.
  if (EXPENSIVE_MODEL.test(s.model) && assistantTurns <= 3 && u.output < 4_000) {
    out.push({
      ...base,
      heuristic: "expensive-model-simple-task",
      title: "Use a cheaper model for simple tasks",
      rationale: `A short ${assistantTurns}-turn session (${u.output.toLocaleString()} output tokens) ran on ${s.model}. A smaller/cheaper model would likely handle this at a fraction of the cost${u.aiu > 0 ? ` (~${u.aiu.toFixed(2)} AIU here)` : ""}.`,
      severity: u.aiu > 1 ? "high" : "medium",
      estSavingsTokens: 0,
      estSavingsPct: 0,
      estSavingsAiu: u.aiu * 0.6,
      topic: "when to use cheaper AI model vs expensive model for simple tasks",
    });
  }

  return out;
}

const TITLES: Record<string, string> = {
  "bloated-context": "Bloated context",
  "redundant-tool-definitions": "Redundant tool definitions",
  "oversized-history": "Oversized history",
  "low-cache-reuse": "Low cache reuse",
  "expensive-model-simple-task": "Expensive model for simple task",
};

function detectRegressions(
  sessions: UnifiedSession[]
): OptimizationReport["regressions"] {
  const withTokens = sessions.filter((s) => s.usage.total > 0);
  if (withTokens.length < 6) return [];
  const sorted = [...withTokens].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const mid = Math.floor(sorted.length / 2);
  const early = sorted.slice(0, mid);
  const late = sorted.slice(mid);

  const avg = (arr: UnifiedSession[], pick: (s: UnifiedSession) => number) =>
    arr.reduce((a, s) => a + pick(s), 0) / (arr.length || 1);

  const metrics: { metric: string; label: string; pick: (s: UnifiedSession) => number; unit: string }[] = [
    { metric: "avgInputPerSession", label: "Avg input tokens/session", pick: (s) => s.usage.input, unit: "tokens" },
    { metric: "avgTokensPerSession", label: "Avg total tokens/session", pick: (s) => s.usage.total, unit: "tokens" },
    { metric: "avgAiuPerSession", label: "Avg cost/session", pick: (s) => s.usage.aiu, unit: "AIU" },
  ];

  const regressions: OptimizationReport["regressions"] = [];
  for (const m of metrics) {
    const e = avg(early, m.pick);
    const l = avg(late, m.pick);
    if (e <= 0) continue;
    const changePct = Math.round(((l - e) / e) * 100);
    if (changePct >= 20) {
      regressions.push({
        metric: m.metric,
        message: `${m.label} rose ${changePct}% in the recent half of this range (${Math.round(e).toLocaleString()} → ${Math.round(l).toLocaleString()} ${m.unit}).`,
        changePct,
        severity: changePct >= 60 ? "high" : changePct >= 35 ? "medium" : "low",
      });
    }
  }
  return regressions;
}

export function optimizationReport(sessions: UnifiedSession[]): OptimizationReport {
  const suggestions: Suggestion[] = [];
  for (const s of sessions) suggestions.push(...suggestionsForSession(s));

  suggestions.sort(
    (a, b) => b.estSavingsTokens - a.estSavingsTokens || b.estSavingsAiu - a.estSavingsAiu
  );

  const byHeuristicMap = new Map<
    string,
    { count: number; estSavingsTokens: number; estSavingsAiu: number; topic: string }
  >();
  for (const g of suggestions) {
    const e = byHeuristicMap.get(g.heuristic) ?? {
      count: 0,
      estSavingsTokens: 0,
      estSavingsAiu: 0,
      topic: g.topic,
    };
    e.count++;
    e.estSavingsTokens += g.estSavingsTokens;
    e.estSavingsAiu += g.estSavingsAiu;
    byHeuristicMap.set(g.heuristic, e);
  }

  const totalTokens = sessions.reduce((a, s) => a + s.usage.total, 0);
  const totalEstSavingsTokens = suggestions.reduce((a, g) => a + g.estSavingsTokens, 0);
  const totalEstSavingsAiu = suggestions.reduce((a, g) => a + g.estSavingsAiu, 0);

  // Trend: tokens/day + avg input per session/day.
  const byDay = new Map<string, { sessions: number; totalTokens: number; input: number }>();
  for (const s of sessions) {
    const day = s.startedAt.slice(0, 10);
    const e = byDay.get(day) ?? { sessions: 0, totalTokens: 0, input: 0 };
    e.sessions++;
    e.totalTokens += s.usage.total;
    e.input += s.usage.input;
    byDay.set(day, e);
  }

  return {
    suggestions,
    byHeuristic: [...byHeuristicMap.entries()]
      .map(([heuristic, v]) => ({
        heuristic,
        title: TITLES[heuristic] ?? heuristic,
        count: v.count,
        estSavingsTokens: Math.round(v.estSavingsTokens),
        estSavingsAiu: v.estSavingsAiu,
        topic: v.topic,
      }))
      .sort((a, b) => b.estSavingsTokens - a.estSavingsTokens),
    totalTokens,
    totalEstSavingsTokens: Math.round(totalEstSavingsTokens),
    totalEstSavingsAiu: totalEstSavingsAiu,
    totalEstSavingsPct: pct(totalEstSavingsTokens, totalTokens),
    trend: [...byDay.entries()]
      .map(([date, v]) => ({
        date,
        sessions: v.sessions,
        totalTokens: v.totalTokens,
        avgInputPerSession: Math.round(v.input / (v.sessions || 1)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    regressions: detectRegressions(sessions),
  };
}
