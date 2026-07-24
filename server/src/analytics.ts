import { Source, UnifiedSession, TokenUsage, emptyUsage } from "./types.js";

export interface Summary {
  totalSessions: number;
  sessionsBySource: Record<Source, number>;
  totalTokens: number;
  totalAiu: number;
  cacheHitRate: number;
  usage: TokenUsage;
  topModel: { model: string; count: number } | null;
  preferredInterface: { source: Source | null; cli: number; vscode: number };
  tokensPerDay: { date: string; total: number }[];
  activeDays: number;
}

function accumulate(t: TokenUsage, u: TokenUsage): void {
  t.input += u.input;
  t.output += u.output;
  t.cacheRead += u.cacheRead;
  t.cacheWrite += u.cacheWrite;
  t.reasoning += u.reasoning;
  t.total += u.total;
  t.aiu += u.aiu;
}

export function summarize(sessions: UnifiedSession[]): Summary {
  const usage = emptyUsage();
  const modelCounts = new Map<string, number>();
  const byDay = new Map<string, number>();
  let cli = 0;
  let vscode = 0;

  for (const s of sessions) {
    accumulate(usage, s.usage);
    modelCounts.set(s.model, (modelCounts.get(s.model) ?? 0) + 1);
    if (s.source === "cli") cli++;
    else vscode++;
    const day = s.startedAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + s.usage.total);
  }

  let topModel: Summary["topModel"] = null;
  for (const [model, count] of modelCounts) {
    if (model === "unknown") continue;
    if (!topModel || count > topModel.count) topModel = { model, count };
  }

  // Preferred interface measured by session count.
  let preferredSource: Source | null = null;
  if (cli > 0 || vscode > 0) preferredSource = cli >= vscode ? "cli" : "vscode";

  const tokensPerDay = [...byDay.entries()]
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Cache-hit efficiency: cache-read tokens as a share of all read input
  // (fresh input + cache read). 0 when there is no input activity.
  const readBase = usage.input + usage.cacheRead;
  const cacheHitRate = readBase > 0 ? usage.cacheRead / readBase : 0;

  return {
    totalSessions: sessions.length,
    sessionsBySource: { cli, vscode },
    totalTokens: usage.total,
    totalAiu: usage.aiu,
    cacheHitRate,
    usage,
    topModel,
    preferredInterface: { source: preferredSource, cli, vscode },
    tokensPerDay,
    activeDays: byDay.size,
  };
}

export interface TokenInsights {
  overTime: { date: string; cli: number; vscode: number; total: number }[];
  byModel: { model: string; total: number; input: number; output: number; aiu: number }[];
  byRepo: { repository: string; total: number; sessions: number; aiu: number }[];
  composition: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number };
  bySource: { source: Source; total: number; sessions: number }[];
  promptCategories: { category: string; tokens: number }[];
  totalAiu: number;
}

export function tokenInsights(sessions: UnifiedSession[]): TokenInsights {
  const overTime = new Map<string, { cli: number; vscode: number }>();
  const byModel = new Map<string, { total: number; input: number; output: number; aiu: number }>();
  const byRepo = new Map<string, { total: number; sessions: number; aiu: number }>();
  const composition = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  const bySource = new Map<Source, { total: number; sessions: number }>();
  const promptCat = new Map<string, number>();
  let totalAiu = 0;

  for (const s of sessions) {
    const day = s.startedAt.slice(0, 10);
    const ot = overTime.get(day) ?? { cli: 0, vscode: 0 };
    ot[s.source] += s.usage.total;
    overTime.set(day, ot);

    const bm = byModel.get(s.model) ?? { total: 0, input: 0, output: 0, aiu: 0 };
    bm.total += s.usage.total;
    bm.input += s.usage.input;
    bm.output += s.usage.output;
    bm.aiu += s.usage.aiu;
    byModel.set(s.model, bm);

    const repoKey = (s.repository && s.repository.trim()) || "(no repository)";
    const br = byRepo.get(repoKey) ?? { total: 0, sessions: 0, aiu: 0 };
    br.total += s.usage.total;
    br.sessions += 1;
    br.aiu += s.usage.aiu;
    byRepo.set(repoKey, br);

    totalAiu += s.usage.aiu;

    composition.input += s.usage.input;
    composition.output += s.usage.output;
    composition.cacheRead += s.usage.cacheRead;
    composition.cacheWrite += s.usage.cacheWrite;
    composition.reasoning += s.usage.reasoning;

    const bs = bySource.get(s.source) ?? { total: 0, sessions: 0 };
    bs.total += s.usage.total;
    bs.sessions += 1;
    bySource.set(s.source, bs);

    // Estimate prompt-category token distribution from percentage breakdowns.
    for (const t of s.turns) {
      if (t.promptBreakdown && t.usage) {
        for (const pc of t.promptBreakdown) {
          const tokens = (pc.pct / 100) * t.usage.input;
          promptCat.set(pc.category, (promptCat.get(pc.category) ?? 0) + tokens);
        }
      }
    }
  }

  return {
    overTime: [...overTime.entries()]
      .map(([date, v]) => ({ date, cli: v.cli, vscode: v.vscode, total: v.cli + v.vscode }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .filter((m) => m.total > 0)
      .sort((a, b) => b.total - a.total),
    byRepo: [...byRepo.entries()]
      .map(([repository, v]) => ({ repository, ...v }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total),
    composition,
    bySource: [...bySource.entries()].map(([source, v]) => ({ source, ...v })),
    promptCategories: [...promptCat.entries()]
      .map(([category, tokens]) => ({ category, tokens: Math.round(tokens) }))
      .sort((a, b) => b.tokens - a.tokens),
    totalAiu,
  };
}
