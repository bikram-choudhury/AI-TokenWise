import { Source, UnifiedSession } from "./types.js";
import type { Severity } from "./optimize.js";

/**
 * Per-prompt (input) optimization analysis.
 *
 * The session-level heuristics in `optimize.ts` work off aggregate token
 * counters. This module instead inspects the *text of each user prompt* to spot
 * concrete, actionable bloat — oversized pastes, context repeated across turns,
 * duplicated lines, filler words and whitespace waste — and estimates how many
 * input tokens trimming each one would save.
 *
 * Token counts are estimates: we approximate ~4 characters per token, the usual
 * rule of thumb for English + code. This is deliberately tokenizer-free so the
 * app keeps zero native/runtime dependencies.
 */

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface PromptIssue {
  kind:
    | "large-paste"
    | "redundant-context"
    | "duplicate-lines"
    | "verbose"
    | "filler"
    | "whitespace";
  label: string;
  detail: string;
  severity: Severity;
  estSavingsTokens: number;
}

export interface PromptAnalysis {
  turnIndex: number;
  preview: string;
  estTokens: number;
  estSavingsTokens: number;
  estSavingsPct: number;
  issues: PromptIssue[];
  topic: string;
}

export interface SessionPromptReport {
  sessionId: string;
  source: Source;
  slug: string;
  model: string;
  promptCount: number;
  totalPromptTokens: number;
  totalEstSavingsTokens: number;
  totalEstSavingsPct: number;
  analyses: PromptAnalysis[];
}

const TOPICS: Record<PromptIssue["kind"], string> = {
  "large-paste": "reference files instead of pasting large code and logs into AI prompts",
  "redundant-context": "avoid repeating the same context across LLM chat turns to save tokens",
  "duplicate-lines": "remove duplicated content from AI prompts to reduce tokens",
  verbose: "how to write concise effective prompts for AI coding assistants",
  filler: "concise prompt writing remove filler and politeness words for LLMs",
  whitespace: "how to reduce LLM prompt context size and token usage",
};

function sevFromSavings(tokens: number): Severity {
  if (tokens >= 1500) return "high";
  if (tokens >= 400) return "medium";
  return "low";
}

/** Filler / politeness phrases that add tokens without changing intent. */
const FILLER_PATTERNS: RegExp[] = [
  /\b(please|kindly)\b/gi,
  /\bthank(s| you)?\b/gi,
  /\b(could|would|can) you (please )?/gi,
  /\bi (was|am|'m) (just )?(wondering|hoping|thinking) (if |whether |about )?/gi,
  /\bif (it'?s|it is) not too much trouble\b/gi,
  /\b(basically|actually|really|very|just|simply|obviously|literally)\b/gi,
  /\bas (i|you) (mentioned|said|noted) (earlier|before|above|previously)\b/gi,
];

/** Split text into runs of consecutive non-blank lines. */
function lineRuns(text: string): string[][] {
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      if (cur.length) runs.push(cur);
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function normalizeBlock(lines: string[]): string {
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).join("\n");
}

const LARGE_RUN_LINES = 40; // a "large paste" (code/log dump)
const KEEP_LINES = 15; // how much of a large paste is usually worth keeping
const BLOCK_MIN_LINES = 6; // minimum size to count as a repeatable context block
const BLOCK_MIN_CHARS = 240;

function whitespaceWaste(text: string): number {
  const collapsed = text
    .replace(/[ \t]+\n/g, "\n") // trailing spaces
    .replace(/\n{3,}/g, "\n\n") // 3+ blank lines -> 1 blank line
    .replace(/[ \t]{2,}/g, " "); // runs of spaces/tabs
  return Math.max(0, text.length - collapsed.length);
}

function duplicateLineWaste(text: string): number {
  const seen = new Set<string>();
  let waste = 0;
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (l.length < 24) continue; // ignore short/structural lines
    if (seen.has(l)) waste += l.length + 1;
    else seen.add(l);
  }
  return waste;
}

/**
 * Analyze a single prompt in isolation. `repeatedBlocks` maps a normalized
 * block signature to how many user turns in the session contain it, so we can
 * flag context that is re-pasted across turns.
 */
function analyzePrompt(
  turnIndex: number,
  text: string,
  repeatedBlocks: Map<string, { count: number; firstTurn: number }>
): PromptAnalysis | null {
  if (!text || !text.trim()) return null;

  const estTokens = estimateTokens(text);
  const issues: PromptIssue[] = [];

  const runs = lineRuns(text);

  // 1. Large paste — a big code/log dump that could be trimmed or referenced.
  let pasteWasteChars = 0;
  let largestPaste = 0;
  for (const run of runs) {
    if (run.length >= LARGE_RUN_LINES) {
      const extra = run.slice(KEEP_LINES).join("\n");
      pasteWasteChars += Math.round(extra.length * 0.6);
      largestPaste = Math.max(largestPaste, run.length);
    }
  }
  if (pasteWasteChars > 0) {
    const save = estimateTokens(String("x".repeat(pasteWasteChars)));
    issues.push({
      kind: "large-paste",
      label: "Large paste",
      detail: `A ${largestPaste}-line block was pasted inline. Trimming to the relevant ~${KEEP_LINES} lines (or referencing the file/path) could drop most of it.`,
      severity: sevFromSavings(save),
      estSavingsTokens: save,
    });
  }

  // 2. Redundant context — a block that already appeared in an earlier turn.
  let redundantChars = 0;
  for (const run of runs) {
    const joined = run.join("\n");
    if (run.length < BLOCK_MIN_LINES || joined.length < BLOCK_MIN_CHARS) continue;
    const sig = normalizeBlock(run);
    const rep = repeatedBlocks.get(sig);
    if (rep && rep.count > 1 && turnIndex > rep.firstTurn) redundantChars += joined.length;
  }
  if (redundantChars > 0) {
    const save = estimateTokens(String("x".repeat(redundantChars)));
    issues.push({
      kind: "redundant-context",
      label: "Repeated context",
      detail:
        "This prompt re-pastes context that already appears in another turn of the session. Once it's in the conversation you rarely need to send it again.",
      severity: sevFromSavings(save),
      estSavingsTokens: save,
    });
  }

  // 3. Duplicate lines within this prompt.
  const dupChars = duplicateLineWaste(text);
  if (dupChars > 120) {
    const save = estimateTokens(String("x".repeat(dupChars)));
    issues.push({
      kind: "duplicate-lines",
      label: "Duplicated lines",
      detail: "Several substantial lines repeat verbatim inside this prompt.",
      severity: sevFromSavings(save),
      estSavingsTokens: save,
    });
  }

  // 4. Verbose prose — a long, mostly-text prompt that could be tightened.
  const pasteTokens = runs
    .filter((r) => r.length >= LARGE_RUN_LINES)
    .reduce((a, r) => a + estimateTokens(r.join("\n")), 0);
  const proseTokens = estTokens - pasteTokens;
  if (proseTokens > 500) {
    const save = Math.round(proseTokens * 0.15);
    issues.push({
      kind: "verbose",
      label: "Verbose wording",
      detail: `The prose part of this prompt is ~${proseTokens.toLocaleString()} tokens. Getting straight to the ask usually trims ~15%.`,
      severity: sevFromSavings(save),
      estSavingsTokens: save,
    });
  }

  // 5. Filler / politeness words.
  let fillerChars = 0;
  for (const re of FILLER_PATTERNS) {
    const matches = text.match(re);
    if (matches) for (const m of matches) fillerChars += m.length;
  }
  if (fillerChars > 40) {
    const save = estimateTokens(String("x".repeat(fillerChars)));
    if (save > 0) {
      issues.push({
        kind: "filler",
        label: "Filler words",
        detail: "Politeness and filler phrases add tokens without changing what the model does.",
        severity: sevFromSavings(save),
        estSavingsTokens: save,
      });
    }
  }

  // 6. Whitespace waste.
  const wsChars = whitespaceWaste(text);
  if (wsChars > 120) {
    const save = estimateTokens(String("x".repeat(wsChars)));
    issues.push({
      kind: "whitespace",
      label: "Whitespace",
      detail: "Extra blank lines and trailing spaces can be collapsed.",
      severity: "low",
      estSavingsTokens: save,
    });
  }

  if (issues.length === 0) return null;

  issues.sort((a, b) => b.estSavingsTokens - a.estSavingsTokens);

  // Cap combined savings so overlapping heuristics can't exceed what's realistic.
  const rawSavings = issues.reduce((a, i) => a + i.estSavingsTokens, 0);
  const estSavingsTokens = Math.min(rawSavings, Math.round(estTokens * 0.7));

  const preview = text.replace(/\s+/g, " ").trim().slice(0, 120);

  return {
    turnIndex,
    preview,
    estTokens,
    estSavingsTokens,
    estSavingsPct: estTokens > 0 ? Math.round((estSavingsTokens / estTokens) * 100) : 0,
    issues,
    topic: TOPICS[issues[0].kind],
  };
}

export function analyzeSessionPrompts(s: UnifiedSession): SessionPromptReport {
  const userTurns = s.turns.filter((t) => t.role === "user" && t.text && t.text.trim());

  // First pass: record how many turns each large block appears in, and the
  // earliest turn — so only the *repeats* are flagged as redundant.
  const blockCounts = new Map<string, { count: number; firstTurn: number }>();
  for (const t of userTurns) {
    const seenHere = new Set<string>();
    for (const run of lineRuns(t.text)) {
      const joined = run.join("\n");
      if (run.length < BLOCK_MIN_LINES || joined.length < BLOCK_MIN_CHARS) continue;
      const sig = normalizeBlock(run);
      if (seenHere.has(sig)) continue;
      seenHere.add(sig);
      const prev = blockCounts.get(sig);
      if (prev) prev.count++;
      else blockCounts.set(sig, { count: 1, firstTurn: t.index });
    }
  }

  const analyses: PromptAnalysis[] = [];
  let totalPromptTokens = 0;
  for (const t of userTurns) {
    totalPromptTokens += estimateTokens(t.text);
    const a = analyzePrompt(t.index, t.text, blockCounts);
    if (a) analyses.push(a);
  }

  analyses.sort((a, b) => b.estSavingsTokens - a.estSavingsTokens);

  const totalEstSavingsTokens = analyses.reduce((a, x) => a + x.estSavingsTokens, 0);

  return {
    sessionId: s.id,
    source: s.source,
    slug: s.slug,
    model: s.model,
    promptCount: userTurns.length,
    totalPromptTokens,
    totalEstSavingsTokens,
    totalEstSavingsPct:
      totalPromptTokens > 0 ? Math.round((totalEstSavingsTokens / totalPromptTokens) * 100) : 0,
    analyses,
  };
}
