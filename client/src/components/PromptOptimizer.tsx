import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PromptAnalysis, PromptAnalysisReport } from "../lib/types";
import { formatNumber, modelLabel } from "../lib/format";
import { Spinner, EmptyState } from "./ui";

/**
 * Full-screen overlay that shows a session's user prompts alongside a leaner,
 * token-optimized rewrite of each one. Opened from the session drawer.
 */
export function PromptOptimizer({
  source,
  id,
  slug,
  onClose,
}: {
  source: string;
  id: string;
  slug: string;
  onClose: () => void;
}) {
  const [report, setReport] = useState<PromptAnalysisReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .promptAnalysis(source, id)
      .then((r) => alive && (setReport(r), setLoading(false)))
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="optimizer-screen">
      <header className="optimizer-head">
        <div>
          <div className="optimizer-eyebrow">Prompt optimization</div>
          <h2 className="optimizer-title">{slug}</h2>
          <div className="muted">{modelLabel(report?.model ?? "")}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close optimizer">
          ✕
        </button>
      </header>

      <div className="optimizer-body">
        {loading || !report ? (
          <Spinner />
        ) : report.analyses.length === 0 ? (
          <EmptyState
            message="These prompts already look lean"
            hint="No filler, redundant context, or excess whitespace was detected."
          />
        ) : (
          <>
            <div className="optimizer-stats">
              <OptStat k="Prompts analyzed" v={String(report.promptCount)} />
              <OptStat k="Optimizable" v={String(report.optimizableCount)} />
              <OptStat
                k="Est. tokens saved"
                v={formatNumber(report.totalEstSavingsTokens)}
                accent
              />
              <OptStat
                k="Reduction"
                v={`~${
                  report.totalOriginalTokensEst > 0
                    ? Math.round(
                        (report.totalEstSavingsTokens /
                          report.totalOriginalTokensEst) *
                          100
                      )
                    : 0
                }%`}
              />
            </div>

            <div className="optimizer-list">
              {report.analyses.map((a) => (
                <PromptDiff key={a.turnIndex} a={a} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OptStat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="mini-stat">
      <div className="k">{k}</div>
      <div className="v" style={accent ? { color: "var(--accent)" } : undefined}>
        {v}
      </div>
    </div>
  );
}

function PromptDiff({ a }: { a: PromptAnalysis }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a.optimized);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="prompt-diff">
      <div className="prompt-diff-head">
        <span className="prompt-turn">Turn {a.turnIndex + 1}</span>
        {a.estSavingsTokens > 0 && (
          <span className="save-badge">
            ~{a.estSavingsPct}% · {formatNumber(a.estSavingsTokens)} tokens
          </span>
        )}
      </div>

      <div className="prompt-cols">
        <div className="prompt-col">
          <div className="prompt-col-label">
            Original
            <span className="prompt-col-meta">
              ~{formatNumber(a.originalTokensEst)} tok
            </span>
          </div>
          <div className="prompt-text original">{a.original}</div>
        </div>

        <div className="prompt-col">
          <div className="prompt-col-label">
            Optimized
            <span className="prompt-col-meta">
              ~{formatNumber(a.optimizedTokensEst)} tok
            </span>
            <button className="copy-btn" onClick={copy}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <div className="prompt-text optimized">{a.optimized}</div>
        </div>
      </div>

      {a.issues.length > 0 && (
        <div className="prompt-issues">
          {a.issues.map((iss, i) => (
            <div key={i} className="prompt-issue">
              <span className="prompt-issue-label">{iss.label}</span>
              <span className="prompt-issue-detail">{iss.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
