# TokenWise

A local-first SPA that unifies **chat-session and token-usage insights** across
**copilot-cli** and **VSCode Copilot**. Read-only, private, runs entirely on your machine.

> See [`docs/PRODUCT_ROADMAP.md`](docs/PRODUCT_ROADMAP.md) for the full spec & roadmap.

## Features (MVP)

- **Overview** — summary cards: total sessions (CLI vs VSCode split), total tokens,
  top model, preferred interface (by session count), tokens/day, token composition & cache reuse.
- **Session Insights** — sortable table (session slug ↔ token usage) with a detail
  drawer showing token breakdown + the full discussion history. Zero-token sessions
  hidden by default (toggle to show).
- **Token Insights** — tokens over time (CLI vs VSCode), tokens by model, usage
  composition, and the VSCode prompt-token category breakdown.
- Global **date-range picker** (default: last 30 days) + **source filter**, **dark/light** theme, and a **Rescan** button.

## Data sources (read-only)

| Source | Location | Format |
|---|---|---|
| copilot-cli | `~/.copilot/session-store.db` | SQLite (opened read-only) |
| VSCode Copilot | `%APPDATA%/Code/User/workspaceStorage/<hash>/chatSessions/*.jsonl` | Append-only mutation log |

## Stack

- **Client:** React + Vite + TypeScript, Recharts, CSS-variable theming.
- **Server:** Node/Express + TypeScript, `node:sqlite` (built-in), no native builds.

## Getting started

```bash
# from the repo root
npm run install:all      # installs root + server + client deps

npm run dev              # runs server (:4000) and client (:5173) together
```

Then open http://localhost:5173. The Vite dev server proxies `/api/*` to the backend.

### Run individually

```bash
npm run dev:server       # http://localhost:4000
npm run dev:client       # http://localhost:5173
```

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | source availability + last scan time |
| POST | `/api/refresh` | rescan both stores |
| GET | `/api/summary?from&to&source` | Overview metrics |
| GET | `/api/sessions?from&to&source&includeEmpty` | session list (slug + tokens) |
| GET | `/api/sessions/:source/:id` | full session detail + history |
| GET | `/api/tokens?from&to&source` | token analytics |
| GET | `/api/optimize?from&to&source` | optimization report (session heuristics) |
| GET | `/api/optimize/:source/:id` | per-session optimization suggestions |
| GET | `/api/optimize/prompts/:source/:id` | per-prompt bloat analysis + est. token savings |

## Roadmap

Post-MVP: cost/AIU estimation, deeper prompt-category analytics, and **token
optimization suggestions** (bloated context, redundant tool defs, cache reuse).
See the roadmap doc for details.
