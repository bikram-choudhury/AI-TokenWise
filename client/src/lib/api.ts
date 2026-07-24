import {
  Health,
  LearningResources,
  OptimizationReport,
  SearchHit,
  SessionListItem,
  Suggestion,
  Summary,
  TokenInsights,
  UnifiedSession,
} from "./types";

export interface Range {
  from?: string;
  to?: string;
  source: "all" | "cli" | "vscode";
}

function qs(range: Range, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (range.from) p.set("from", range.from);
  if (range.to) p.set("to", range.to);
  if (range.source && range.source !== "all") p.set("source", range.source);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<Health>("/api/health"),
  refresh: () =>
    fetch("/api/refresh", { method: "POST" }).then((r) => r.json()),
  summary: (range: Range) => get<Summary>(`/api/summary${qs(range)}`),
  sessions: (range: Range, includeEmpty: boolean) =>
    get<SessionListItem[]>(
      `/api/sessions${qs(range, { includeEmpty: String(includeEmpty) })}`
    ),
  session: (source: string, id: string) =>
    get<UnifiedSession>(`/api/sessions/${source}/${encodeURIComponent(id)}`),
  tokens: (range: Range) => get<TokenInsights>(`/api/tokens${qs(range)}`),
  search: (range: Range, q: string) =>
    get<SearchHit[]>(`/api/search${qs(range, { q })}`),
  optimize: (range: Range) => get<OptimizationReport>(`/api/optimize${qs(range)}`),
  sessionSuggestions: (source: string, id: string) =>
    get<Suggestion[]>(`/api/optimize/${source}/${encodeURIComponent(id)}`),
  resources: (topic: string) =>
    get<LearningResources>(`/api/resources?topic=${encodeURIComponent(topic)}`),
};
