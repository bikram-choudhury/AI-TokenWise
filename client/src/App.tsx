import { useEffect, useState } from "react";
import "./index.css";
import "./App.css";
import { ThemeProvider, useTheme } from "./theme";
import { Toolbar } from "./components/Toolbar";
import { Overview } from "./tabs/Overview";
import { Sessions } from "./tabs/Sessions";
import { Tokens } from "./tabs/Tokens";
import { Optimization } from "./tabs/Optimization";
import { api, Range } from "./lib/api";
import { Health } from "./lib/types";
import { isoDaysAgo, today } from "./lib/format";

type Tab = "overview" | "sessions" | "tokens" | "optimization";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "▨" },
  { id: "sessions", label: "Session Insights", icon: "☰" },
  { id: "tokens", label: "Token Insights", icon: "◔" },
  { id: "optimization", label: "Optimization", icon: "✦" },
];

function AppInner() {
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>({
    from: isoDaysAgo(30),
    to: today(),
    source: "all",
  });
  const [health, setHealth] = useState<Health | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [auto, setAuto] = useState(false);

  const loadHealth = () => api.health().then(setHealth);
  useEffect(() => {
    loadHealth();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await api.refresh();
    await loadHealth();
    setNonce((n) => n + 1);
    setRefreshing(false);
  };

  // Auto-refresh: the server watches local data and updates its snapshot's
  // scannedAt. Poll health; when scannedAt changes, remount the active tab.
  useEffect(() => {
    if (!auto) return;
    let last = health?.scannedAt;
    const id = setInterval(async () => {
      const h = await api.health();
      setHealth(h);
      if (last && h.scannedAt !== last) setNonce((n) => n + 1);
      last = h.scannedAt;
    }, 5000);
    return () => clearInterval(id);
  }, [auto]);

  // Force remount of active tab on rescan via key.
  const rangeKey = `${range.from}|${range.to}|${range.source}|${nonce}`;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span>
          TokenWise
          <span className="sub">chat &amp; token insights</span>
        </div>

        <div className="topbar-spacer" />

        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <button className="icon-btn" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <main className="content">
        {health?.errors && health.errors.length > 0 && (
          <div className="banner">⚠ {health.errors.join(" · ")}</div>
        )}

        <Toolbar
          range={range}
          onChange={setRange}
          onRefresh={onRefresh}
          refreshing={refreshing}
          auto={auto}
          onToggleAuto={() => setAuto((v) => !v)}
          right={
            health && (
              <span className="muted" style={{ marginLeft: "auto" }}>
                {health.sources.cli + health.sources.vscode} sessions indexed
              </span>
            )
          }
        />

        {tab === "overview" && <Overview key={rangeKey} range={range} />}
        {tab === "sessions" && <Sessions key={rangeKey} range={range} />}
        {tab === "tokens" && <Tokens key={rangeKey} range={range} />}
        {tab === "optimization" && <Optimization key={rangeKey} range={range} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
