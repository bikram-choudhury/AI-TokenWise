import { useEffect, useState } from "react";
import { api, Range } from "../lib/api";
import { SearchHit, SessionListItem, Suggestion, UnifiedSession } from "../lib/types";
import { Card, Spinner, SourceChip, EmptyState } from "../components/ui";
import { SuggestionCard } from "../components/SuggestionCard";
import {
  formatTokens,
  formatNumber,
  formatDate,
  formatAiu,
  modelLabel,
} from "../lib/format";

export function Sessions({ range }: { range: Range }) {
  const [rows, setRows] = useState<SessionListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [selected, setSelected] = useState<{ source: string; id: string } | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.sessions(range, includeEmpty).then((r) => alive && (setRows(r), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [range.from, range.to, range.source, includeEmpty]);

  // Debounce the search query.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Cross-session content + metadata search when a query is present.
  useEffect(() => {
    if (!debounced) {
      setHits(null);
      return;
    }
    let alive = true;
    setSearching(true);
    api.search(range, debounced).then((h) => alive && (setHits(h), setSearching(false)));
    return () => {
      alive = false;
    };
  }, [debounced, range.from, range.to, range.source]);

  const isSearch = debounced.length > 0;
  const shownCount = isSearch ? hits?.length ?? 0 : rows?.length ?? 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div className="section-title" style={{ margin: 0 }}>
          Sessions
          <span className="section-sub">{shownCount} shown</span>
        </div>
        <input
          className="search-input"
          type="search"
          placeholder="Search slug, repo, model, or message text…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: "1 1 240px", minWidth: 200 }}
        />
        {!isSearch && (
          <label className="toggle-row">
            Show empty sessions
            <button
              className={`switch ${includeEmpty ? "on" : ""}`}
              onClick={() => setIncludeEmpty((v) => !v)}
              aria-label="Toggle empty sessions"
            />
          </label>
        )}
      </div>

      {isSearch ? (
        searching || !hits ? (
          <Spinner />
        ) : hits.length === 0 ? (
          <EmptyState message={`No sessions match “${debounced}”`} hint="Try a different term or widen the date range." />
        ) : (
          <Card>
            <table className="table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Source</th>
                  <th>Model</th>
                  <th className="right">Matches</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={`${h.source}-${h.id}`} onClick={() => setSelected({ source: h.source, id: h.id })}>
                    <td>
                      <div className="slug-cell">
                        <span className="slug-text">{h.slug}</span>
                      </div>
                      <div className="muted">{h.snippet}</div>
                    </td>
                    <td>
                      <SourceChip source={h.source} />
                    </td>
                    <td>{modelLabel(h.model)}</td>
                    <td className="right">
                      <span className="token-strong">{h.matchCount || "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : loading || !rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No sessions in this range" hint="Try a wider date range or toggle empty sessions." />
      ) : (
        <Card>
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Source</th>
                <th>Model</th>
                <th className="right">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.source}-${r.id}`} onClick={() => setSelected({ source: r.source, id: r.id })}>
                  <td>
                    <div className="slug-cell">
                      <span className="slug-text">{r.slug}</span>
                    </div>
                    <div className="muted">
                      {formatDate(r.startedAt)} · {r.turnCount} turns
                    </div>
                  </td>
                  <td>
                    <SourceChip source={r.source} />
                  </td>
                  <td>{modelLabel(r.model)}</td>
                  <td className="right">
                    <span className="token-strong">{formatTokens(r.usage.total)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && (
        <SessionDrawer
          source={selected.source}
          id={selected.id}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function SessionDrawer({ source, id, onClose }: { source: string; id: string; onClose: () => void }) {
  const [session, setSession] = useState<UnifiedSession | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    let alive = true;
    setSession(null);
    setSuggestions([]);
    api.session(source, id).then((s) => alive && setSession(s));
    api.sessionSuggestions(source, id).then((s) => alive && setSuggestions(s)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [source, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const u = session?.usage;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {session ? <SourceChip source={session.source} /> : <span />}
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="drawer-title">{session?.slug ?? "Loading…"}</div>
          {session && (
            <div className="muted">
              {modelLabel(session.model)} · {formatDate(session.startedAt)}
              {session.repository ? ` · ${session.repository}` : ""}
            </div>
          )}
        </div>

        <div className="drawer-body">
          {!session ? (
            <Spinner />
          ) : (
            <>
              <div className="mini-stats">
                <MiniStat k="Total" v={formatTokens(u!.total)} />
                <MiniStat k="Input" v={formatTokens(u!.input)} />
                <MiniStat k="Output" v={formatTokens(u!.output)} />
                {u!.cacheRead > 0 && <MiniStat k="Cache read" v={formatTokens(u!.cacheRead)} />}
                {u!.reasoning > 0 && <MiniStat k="Reasoning" v={formatTokens(u!.reasoning)} />}
                {u!.aiu > 0 && <MiniStat k="Est. cost" v={`${formatAiu(u!.aiu)} AIU`} />}
              </div>

              {suggestions.length > 0 && (
                <>
                  <div className="section-title">
                    Optimization suggestions
                    <span className="section-sub">{suggestions.length} for this session</span>
                  </div>
                  <div className="suggestion-list" style={{ marginBottom: 22 }}>
                    {suggestions.map((s, i) => (
                      <SuggestionCard key={`${s.heuristic}-${i}`} s={s} />
                    ))}
                  </div>
                </>
              )}

              <div className="section-title">
                Discussion history
                <span className="section-sub">{session.turns.length} turns</span>
              </div>

              {session.turns.map((t) => (
                <div key={t.index} className={`turn ${t.role}`}>
                  <div className="turn-head">
                    <span>{t.role === "user" ? "🧑 You" : "🤖 Assistant"}</span>
                    {t.model && <span className="muted">· {modelLabel(t.model)}</span>}
                  </div>
                  <div className="turn-text">{t.text || <span className="muted">(no text)</span>}</div>
                  {t.usage && t.usage.total > 0 && (
                    <div className="turn-usage">
                      <span>in {formatNumber(t.usage.input)}</span>
                      <span>out {formatNumber(t.usage.output)}</span>
                      {t.usage.cacheRead > 0 && <span>cache {formatNumber(t.usage.cacheRead)}</span>}
                      {t.usage.reasoning > 0 && <span>reasoning {formatNumber(t.usage.reasoning)}</span>}
                    </div>
                  )}
                  {t.promptBreakdown && t.promptBreakdown.length > 0 && (
                    <div className="turn-usage">
                      {t.promptBreakdown.map((p, i) => (
                        <span key={i}>
                          {p.label}: {p.pct}%
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function MiniStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="mini-stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
