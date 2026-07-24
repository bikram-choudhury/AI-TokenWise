import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { api, Range } from "../lib/api";
import { OptimizationReport } from "../lib/types";
import { StatCard, Spinner, Card, EmptyState } from "../components/ui";
import { SuggestionCard } from "../components/SuggestionCard";
import { formatTokens, formatNumber, formatAiu, formatDay } from "../lib/format";

const tooltipStyle = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text)",
  fontSize: 12,
  boxShadow: "var(--shadow)",
};

export function Optimization({ range }: { range: Range }) {
  const [data, setData] = useState<OptimizationReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.optimize(range).then((d) => alive && (setData(d), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [range.from, range.to, range.source]);

  if (loading || !data) return <Spinner />;

  return (
    <>
      <div className="grid cards" style={{ marginBottom: 20 }}>
        <StatCard
          label="Potential Savings"
          value={`~${data.totalEstSavingsPct}%`}
          icon="✂️"
          foot={<span>{formatTokens(data.totalEstSavingsTokens)} tokens of {formatTokens(data.totalTokens)}</span>}
        />
        <StatCard
          label="Est. Cost Savings"
          value={`${formatAiu(data.totalEstSavingsAiu)} AIU`}
          icon="💸"
          foot={<span>across flagged sessions</span>}
        />
        <StatCard
          label="Suggestions"
          value={formatNumber(data.suggestions.length)}
          icon="💡"
          foot={<span>{data.byHeuristic.length} heuristics triggered</span>}
        />
        <StatCard
          label="Regressions"
          value={formatNumber(data.regressions.length)}
          icon="📈"
          foot={<span>{data.regressions.length ? "usage trending up" : "no upward trend"}</span>}
        />
      </div>

      {data.regressions.length > 0 && (
        <Card className="card-pad" style={{ marginBottom: 20 }}>
          <div className="section-title">Trend & regression alerts</div>
          {data.regressions.map((r) => (
            <div key={r.metric} className={`regression sev-${r.severity}`}>
              <span className={`sev-dot sev-${r.severity}`} />
              {r.message}
            </div>
          ))}
        </Card>
      )}

      <div className="chart-grid" style={{ marginBottom: 20 }}>
        <Card className="card-pad chart-card" style={{ gridColumn: "1 / -1" } as React.CSSProperties}>
          <div className="section-title">
            Avg input tokens per session
            <span className="section-sub">rising = growing context / history</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.trend} margin={{ left: -10, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="gOpt" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--danger)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" minTickGap={24} />
              <YAxis tickFormatter={(v) => formatTokens(v as number)} tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" width={48} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [formatNumber(v as number), "Avg input"]} />
              <Area type="monotone" dataKey="avgInputPerSession" stroke="var(--danger)" strokeWidth={2} fill="url(#gOpt)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {data.byHeuristic.length > 0 && (
        <div className="grid cards" style={{ marginBottom: 20 }}>
          {data.byHeuristic.map((h) => (
            <div key={h.heuristic} className="card card-pad stat">
              <div className="label">{h.title}</div>
              <div className="value" style={{ fontSize: 20 }}>{formatTokens(h.estSavingsTokens)}</div>
              <div className="foot">
                <span>{h.count} session{h.count === 1 ? "" : "s"}{h.estSavingsAiu > 0 ? ` · ${formatAiu(h.estSavingsAiu)} AIU` : ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">
        Suggestions
        <span className="section-sub">{data.suggestions.length} across your sessions</span>
      </div>

      {data.suggestions.length === 0 ? (
        <EmptyState message="No optimization opportunities found" hint="Your sessions look efficient for this range." />
      ) : (
        <div className="suggestion-list">
          {data.suggestions.map((s, i) => (
            <SuggestionCard key={`${s.sessionId}-${s.heuristic}-${i}`} s={s} showSession />
          ))}
        </div>
      )}
    </>
  );
}
