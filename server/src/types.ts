export type Source = "cli" | "vscode";

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  /** Estimated billed AIU (AI units) derived from total_nano_aiu / 1e9. CLI-only; 0 for VSCode. */
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

export interface UnifiedSession {
  id: string;
  source: Source;
  slug: string;
  repository?: string;
  cwd?: string;
  model: string;
  startedAt: string;
  updatedAt: string;
  turns: UnifiedTurn[];
  usage: TokenUsage;
}

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, aiu: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    reasoning: a.reasoning + b.reasoning,
    total: a.total + b.total,
    aiu: a.aiu + b.aiu,
  };
}
