# TokenWise — Product Roadmap & Specification

> A local-first SPA that unifies chat-session and token-usage insights across
> **copilot-cli** and **VSCode Copilot**, and (later) recommends token
> optimizations.

Status: **MVP built (v0.1)** — Overview, Session Insights, and Token Insights implemented.
Phase 2 (Depth & Cost) implemented: cost/AIU estimation, cache-hit efficiency,
per-repo analytics, cross-session search, and auto-refresh/file-watch.
Phase 3 (Optimization) implemented: heuristic suggestions with per-session
"reduce ~X%" rationale, trend/regression detection, and per-suggestion learning
resources (YouTube + doc, fetched live).
Stack (decided): **React + Vite SPA** + **Node/Express backend** (reads SQLite + JSONL locally).

---

## 1. Vision & Goals

**Problem.** Developers use both copilot-cli and VSCode Copilot but have no unified
view of how many sessions they run, which models they use, or how many tokens
they burn — let alone how to reduce that spend.

**Vision.** One clean dashboard that answers: *"How am I using AI, and how do I
use it more efficiently?"*

**MVP goal.** Trustworthy read-only analytics across both sources, scoped by date range.

**North-star (post-MVP).** Actionable token-optimization suggestions.

**Non-goals (MVP).** No cloud sync, no auth, no multi-user, no writing back to
either data store, no sharing data with third parties (privacy-first, local-only).

---

## 2. Data Sources (verified in this environment)

### 2.1 copilot-cli — SQLite
`~/.copilot/session-store.db` (WAL mode — read via read-only/immutable copy to avoid locks).

| Table | Useful columns |
|---|---|
| `sessions` | `id, cwd, repository, branch, summary, created_at, updated_at` |
| `turns` | `session_id, turn_index, user_message, assistant_response, timestamp` |
| `assistant_usage_events` | `session_id, turn_index, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, request_multiplier, total_nano_aiu, duration_ms, finish_reason, token_details_json, created_at` |
| `checkpoints`, `session_files`, `session_refs` | context/metadata (secondary) |

Per-session granular stream also at `~/.copilot/session-state/<id>/events.jsonl`.

### 2.2 VSCode Copilot — append-only JSONL
`%APPDATA%\Code\User\workspaceStorage\<workspace-hash>\chatSessions\*.jsonl`
(plus `globalStorage\emptyWindowChatSessions`).

- Log format: `kind:0` = initial snapshot; `kind:1` / `kind:2` = incremental deltas
  that must be **folded/replayed** to reconstruct final state.
- Header carries `sessionId, creationDate, initialLocation, selectedModel.metadata`.
- Each response carries:
  - `modelId` (e.g. `copilot/claude-sonnet-4.5`), `details` ("Claude Sonnet 4.5 • 1x")
  - `usage.promptTokens`, `usage.completionTokens`
  - `usage.promptTokenDetails[]` — **category breakdown** (System Instructions,
    Tool Definitions, User Context, …) → foundation for optimization feature
  - `metadata.toolCallRounds[].thinking.tokens`

### 2.3 Source differences to abstract away
| Aspect | copilot-cli | VSCode Copilot |
|---|---|---|
| Format | SQLite (queryable) | Append-only JSONL deltas (replay) |
| Token fields | input/output/cache/reasoning | prompt/completion + category detail |
| History | `turns` rows | folded requests[] |
| Grouping | per session id | per workspace-hash → per session file |

---

## 3. Architecture

```
+--------------------------------------------+
|  React + Vite SPA (tabs, charts, tables)   |
+---------------------^----------------------+
                      | REST/JSON (localhost)
+---------------------+----------------------+
|  Node/Express backend                      |
|  +--------------+   +--------------------+  |
|  | cli-adapter  |   | vscode-adapter     |  |
|  | (SQLite RO)  |   | (JSONL replay)     |  |
|  +------+-------+   +---------+----------+  |
|         +--------> Normalizer <---------+   |
|                       |                     |
|                Analytics/Aggregation        |
+--------------------------------------------+
        reads (read-only) local files
```

### 3.1 Normalized model (source-agnostic)
```ts
type Source = "cli" | "vscode";

interface UnifiedSession {
  id: string;
  source: Source;
  slug: string;          // human label (summary/first prompt/repo+date)
  repository?: string;
  cwd?: string;
  model: string;         // dominant model for the session
  startedAt: string;     // ISO
  updatedAt: string;
  turns: UnifiedTurn[];
  usage: TokenUsage;     // session totals
}

interface UnifiedTurn {
  index: number;
  role: "user" | "assistant";
  text: string;
  model?: string;
  timestamp?: string;
  usage?: TokenUsage;
  promptBreakdown?: { category: string; label: string; pct: number }[];
}

interface TokenUsage {
  input: number; output: number;
  cacheRead?: number; cacheWrite?: number; reasoning?: number;
  total: number;
}
```

### 3.2 Backend API (MVP)
| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | source availability + last-scanned time |
| GET | `/api/summary?from&to&source` | Overview cards metrics |
| GET | `/api/sessions?from&to&source` | table list (slug + token totals) |
| GET | `/api/sessions/:source/:id` | full detail: turns + per-turn usage |
| GET | `/api/tokens?from&to&groupBy` | time-series / by-model / by-repo / by-category (+ AIU) |
| GET | `/api/search?q&from&to&source` | cross-session search (message text + slug/repo/model) |
| GET | `/api/optimize?from&to&source` | optimization report: suggestions, savings, trend, regressions |
| GET | `/api/optimize/:source/:id` | per-session optimization suggestions |
| GET | `/api/resources?topic` | learning resources (YouTube + doc) for a suggestion topic |

Design notes: read-only DB connections; cache a scanned snapshot in memory with a
manual/auto refresh; never mutate source files.

---

## 4. Feature Spec — Tabs

### 4.1 Overview Tab
Global **date-range picker** + optional source filter drive everything.
Cards:
1. **Total sessions** (with CLI vs VSCode split)
2. **Total tokens** (in/out/cache/reasoning breakdown on hover)
3. **Most-used model**
4. **Preferred interface** (CLI vs VSCode by **session count**)

Secondary: mini sparkline of tokens/day, active-days count.

### 4.2 Session Insights Tab
- Table: **left = session slug**, **right = token usage** (sortable; source badge).
  Zero-token sessions hidden by default with a "show empty sessions" toggle.
- Default date range: last 30 days; combined sources with a source filter.
- Row click → **detail panel**: token breakdown (in/out/cache/reasoning) + **full
  discussion history** (user/assistant turns, per-turn tokens, model, timestamps).
- Search/filter by slug/repo/model.

### 4.3 Token Insights Tab
- Tokens over time (line/area, stacked by source).
- Tokens by model (bar).
- Input vs output vs cache vs reasoning (donut/stacked).
- CLI vs VSCode comparison.
- (Phase 2) `promptTokenDetails` category breakdown — *where* prompt tokens go.

---

## 5. Roadmap (phased)

### Phase 0 — Foundation
- Repo scaffold (SPA + Express), shared TS types.
- `cli-adapter` (SQLite RO) + `vscode-adapter` (JSONL replay) -> `UnifiedSession[]`.
- Date-range filtering, source tagging, normalized-JSON contract + fixtures.
- **Exit:** `/api/sessions` returns merged, normalized data from both sources.

### Phase 1 — MVP
- Overview, Session Insights (list + detail + history), Token Insights (core charts).
- Date-range picker, source filter, loading/empty/error states.
- **Exit:** all three tabs functional end-to-end on real local data.

### Phase 2 — Depth & Cost ✅ *implemented*
- `promptTokenDetails` category analytics, cache-hit efficiency.
- Cost/AIU estimation via `request_multiplier` / `total_nano_aiu`.
- Per-repo analytics, cross-session search, auto-refresh/watch.

### Phase 3 — Optimization (north star) ✅ *implemented*
- Heuristics: bloated context, redundant tool definitions, oversized histories,
  low cache reuse, expensive-model-for-simple-task.
- Per-session "reduce tokens by ~X%" suggestions with rationale.
- Trend/regression detection over time.
- Each suggestion links a **learning resource** (YouTube video + article) fetched
  live from YouTube/DuckDuckGo. *Note:* this is a deliberate, user-approved
  exception to the local-only non-goal — only the topic string is sent, never
  session/token data; results are cached in memory.

### Phase 4 — Polish & Distribution
- Export (CSV/PDF), saved filters, budgets/alerts, packaging.

---

## 6. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| CLI DB locked (WAL, live writes) | Read-only/immutable connection or copy-then-read |
| VSCode JSONL delta format changes | Version-tolerant folder + adapter tests on fixtures |
| Token fields differ per source | Normalizer with explicit null-handling; document gaps |
| Large logs (10MB+ files) | Stream-parse; cache aggregates; paginate |
| Privacy | 100% local, read-only, no third-party egress |

---

## 7. Product Decisions

### 7.1 Resolved
1. **Default view:** CLI + VSCode **combined by default**, with a filter to narrow to a single source.
2. **Default date range:** **Last 30 days** on first load.
3. **"Preferred interface" metric:** measured by **session count** (CLI vs VSCode).
4. **Zero-token sessions:** **hidden by default** in Session Insights, with a toggle to show them.

### 7.2 Still open
5. Slug definition per source (CLI `summary` vs VSCode first user prompt) — proposed:
   CLI uses `sessions.summary` (fallback: first user message); VSCode uses first user
   prompt (fallback: `sessionId` short form).
6. Multi-editor scope later (VSCode Insiders / Cursor / other forks)?
7. ~~Refresh model: manual refresh button vs file-watch auto-refresh for MVP?~~
   **Resolved:** both — manual "Rescan" button plus an optional file-watch
   auto-refresh toggle (server watches sources; client polls `scannedAt`).
