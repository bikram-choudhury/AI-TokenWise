import { useState } from "react";
import { LearningResources, Suggestion } from "../lib/types";
import { api } from "../lib/api";
import { formatNumber, formatAiu } from "../lib/format";

function SavingsBadge({ s }: { s: Suggestion }) {
  if (s.estSavingsTokens > 0) {
    return (
      <span className="save-badge">
        ~{s.estSavingsPct}% · {formatNumber(s.estSavingsTokens)} tokens
      </span>
    );
  }
  if (s.estSavingsAiu > 0) {
    return <span className="save-badge">~{formatAiu(s.estSavingsAiu)} AIU</span>;
  }
  return <span className="save-badge">efficiency</span>;
}

export function SuggestionCard({ s, showSession = false }: { s: Suggestion; showSession?: boolean }) {
  const [res, setRes] = useState<LearningResources | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const learn = async () => {
    if (res) {
      setOpen((v) => !v);
      return;
    }
    setLoading(true);
    setOpen(true);
    try {
      setRes(await api.resources(s.topic));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`suggestion sev-${s.severity}`}>
      <div className="suggestion-head">
        <span className={`sev-dot sev-${s.severity}`} />
        <span className="suggestion-title">{s.title}</span>
        <SavingsBadge s={s} />
      </div>
      {showSession && <div className="muted suggestion-session">{s.slug}</div>}
      <div className="suggestion-rationale">{s.rationale}</div>

      <div className="suggestion-actions">
        <button className="link-btn" onClick={learn}>
          {loading ? "Finding resources…" : open ? "Hide resources" : "📺 Learn how"}
        </button>
      </div>

      {open && !loading && res && (
        <div className="learn-links">
          {res.video ? (
            <a className="learn-link" href={res.video.url} target="_blank" rel="noreferrer">
              <span className="learn-icon">▶</span>
              <span>
                <span className="learn-title">{res.video.title}</span>
                <span className="learn-src">{res.video.source}</span>
              </span>
            </a>
          ) : null}
          {res.doc ? (
            <a className="learn-link" href={res.doc.url} target="_blank" rel="noreferrer">
              <span className="learn-icon">📄</span>
              <span>
                <span className="learn-title">{res.doc.title}</span>
                <span className="learn-src">{res.doc.source}</span>
              </span>
            </a>
          ) : null}
          {!res.video && !res.doc && (
            <span className="muted">No resources found — try again later.</span>
          )}
        </div>
      )}
    </div>
  );
}
