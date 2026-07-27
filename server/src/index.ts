import express from "express";
import cors from "cors";
import path from "node:path";
import { PORT } from "./config.js";
import {
  refresh,
  getSnapshot,
  filterSessions,
  findSession,
  searchSessions,
  sourceAvailability,
  startWatching,
  restartWatching,
  Filter,
} from "./store.js";
import { summarize, tokenInsights } from "./analytics.js";
import {
  optimizationReport,
  suggestionsForSession,
  analyzePromptsForSession,
} from "./optimize.js";
import { getResources } from "./resources.js";
import {
  detectSource,
  loadSettings,
  saveSettings,
  validatePath,
  PROVIDER_LABELS,
  Settings,
} from "./settings.js";
import { Source, SOURCES } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());

function parseFilter(q: express.Request["query"]): Filter {
  const source = (q.source as string) || "all";
  return {
    from: (q.from as string) || undefined,
    to: (q.to as string) || undefined,
    source: (SOURCES.includes(source as Source) ? source : "all") as Source | "all",
  };
}

app.get("/api/health", (_req, res) => {
  const snap = getSnapshot();
  res.json({
    ok: true,
    scannedAt: snap.scannedAt,
    sources: sourceAvailability(),
    errors: snap.errors,
  });
});

app.post("/api/refresh", (_req, res) => {
  const snap = refresh();
  res.json({ ok: true, scannedAt: snap.scannedAt, count: snap.sessions.length });
});

app.get("/api/summary", (req, res) => {
  const sessions = filterSessions(parseFilter(req.query));
  res.json(summarize(sessions));
});

app.get("/api/sessions", (req, res) => {
  const includeEmpty = req.query.includeEmpty === "true";
  let sessions = filterSessions(parseFilter(req.query));
  if (!includeEmpty) sessions = sessions.filter((s) => s.usage.total > 0);
  res.json(
    sessions
      .map((s) => ({
        id: s.id,
        source: s.source,
        slug: s.slug,
        model: s.model,
        repository: s.repository,
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        turnCount: s.turns.length,
        usage: s.usage,
      }))
      .sort((a, b) => b.usage.total - a.usage.total)
  );
});

app.get("/api/sessions/:source/:id", (req, res) => {
  const session = findSession(req.params.source, req.params.id);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json(session);
});

app.get("/api/tokens", (req, res) => {
  const sessions = filterSessions(parseFilter(req.query));
  res.json(tokenInsights(sessions));
});

app.get("/api/search", (req, res) => {
  const q = (req.query.q as string) || "";
  res.json(searchSessions(parseFilter(req.query), q));
});

app.get("/api/optimize", (req, res) => {
  const sessions = filterSessions(parseFilter(req.query));
  res.json(optimizationReport(sessions));
});

app.get("/api/optimize/:source/:id", (req, res) => {
  const session = findSession(req.params.source, req.params.id);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json(suggestionsForSession(session));
});

app.get("/api/optimize/prompts/:source/:id", (req, res) => {
  const session = findSession(req.params.source, req.params.id);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json(analyzePromptsForSession(session));
});

app.get("/api/resources", async (req, res) => {
  const topic = (req.query.topic as string) || "";
  if (!topic.trim()) {
    res.status(400).json({ error: "topic required" });
    return;
  }
  try {
    res.json(await getResources(topic));
  } catch {
    res.json({ topic, video: null, doc: null, fetchedAt: new Date().toISOString() });
  }
});

app.get("/api/settings", (_req, res) => {
  res.json({
    settings: loadSettings(),
    providers: SOURCES.map((id) => ({ id, label: PROVIDER_LABELS[id] })),
  });
});

app.put("/api/settings", (req, res) => {
  const body = req.body as Settings;
  if (!body || !Array.isArray(body.sources)) {
    res.status(400).json({ error: "sources array required" });
    return;
  }
  const saved = saveSettings(body);
  const snap = refresh();
  restartWatching();
  res.json({ settings: saved, count: snap.sessions.length, sources: sourceAvailability() });
});

app.post("/api/settings/validate", (req, res) => {
  const p = (req.body?.path as string) ?? "";
  res.json(validatePath(p));
});

app.get("/api/settings/detect/:provider", (req, res) => {
  const provider = req.params.provider as Source;
  if (!SOURCES.includes(provider)) {
    res.status(400).json({ error: "unknown provider" });
    return;
  }
  res.json(detectSource(provider));
});

app.listen(PORT, () => {
  const snap = refresh();
  startWatching();
  console.log(`[tokenwise] server on http://localhost:${PORT}`);
  console.log(
    `[tokenwise] loaded ${snap.sessions.length} sessions across ${SOURCES.length} providers` +
      (snap.errors.length ? ` with errors: ${snap.errors.join("; ")}` : "")
  );
});

// Electron production: serve the built React SPA so the BrowserWindow can load it.
// ELECTRON_STATIC_DIR is set by electron/main.ts before requiring this bundle.
const staticDir = process.env.ELECTRON_STATIC_DIR;
if (staticDir) {
  app.use(express.static(staticDir));
  // For any non-API path, return index.html so React Router works correctly.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}
