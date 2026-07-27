export type Source = "cli" | "vscode" | "claude" | "openai";

export const SOURCES: Source[] = ["cli", "vscode", "claude", "openai"];

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  aiu: number;
}

export interface PromptCategory {
  category: string;
  label: string;
  pct: number;
}

export interface UnifiedTurn {
  index: number;
  role: "user" | "assistant";
  text: string;
  model?: string;
  timestamp?: string;
  usage?: TokenUsage;
  promptBreakdown?: PromptCategory[];
}

export interface SessionListItem {
  id: string;
  source: Source;
  slug: string;
  model: string;
  repository?: string;
  startedAt: string;
  updatedAt: string;
  turnCount: number;
  usage: TokenUsage;
}

export interface UnifiedSession extends Omit<SessionListItem, "turnCount"> {
  cwd?: string;
  turns: UnifiedTurn[];
}

export interface Summary {
  totalSessions: number;
  sessionsBySource: Record<Source, number>;
  totalTokens: number;
  totalAiu: number;
  cacheHitRate: number;
  usage: TokenUsage;
  topModel: { model: string; count: number } | null;
  preferredInterface: { source: Source | null; counts: Record<Source, number> };
  tokensPerDay: { date: string; total: number }[];
  activeDays: number;
}

export interface TokenInsights {
  overTime: { date: string; cli: number; vscode: number; claude: number; openai: number; total: number }[];
  byModel: { model: string; total: number; input: number; output: number; aiu: number }[];
  byRepo: { repository: string; total: number; sessions: number; aiu: number }[];
  composition: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
  };
  bySource: { source: Source; total: number; sessions: number }[];
  promptCategories: { category: string; tokens: number }[];
  totalAiu: number;
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

export interface Health {
  ok: boolean;
  scannedAt: string;
  sources: Record<Source, number>;
  errors: string[];
}

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
  estSavingsPct: number;
  estSavingsAiu: number;
  topic: string;
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

export interface ResourceLink {
  title: string;
  url: string;
  source: string;
}

export interface PromptIssue {
  label: string;
  detail: string;
  savedChars: number;
}

export interface PromptAnalysis {
  turnIndex: number;
  original: string;
  optimized: string;
  originalChars: number;
  optimizedChars: number;
  originalTokensEst: number;
  optimizedTokensEst: number;
  estSavingsTokens: number;
  estSavingsPct: number;
  issues: PromptIssue[];
}

export interface PromptAnalysisReport {
  sessionId: string;
  source: Source;
  slug: string;
  model: string;
  promptCount: number;
  optimizableCount: number;
  totalOriginalTokensEst: number;
  totalEstSavingsTokens: number;
  analyses: PromptAnalysis[];
}

export interface LearningResources {
  topic: string;
  video: ResourceLink | null;
  doc: ResourceLink | null;
  fetchedAt: string;
}

export interface SourceConfig {
  id: string;
  provider: Source;
  label: string;
  path: string;
  enabled: boolean;
}

export interface Settings {
  sources: SourceConfig[];
}

export interface ProviderInfo {
  id: Source;
  label: string;
}

export interface SettingsResponse {
  settings: Settings;
  providers: ProviderInfo[];
}

export interface PathValidation {
  path: string;
  exists: boolean;
  kind: "file" | "directory" | "missing";
}


