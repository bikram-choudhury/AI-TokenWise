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
import { Summary } from "../lib/types";
import { StatCard, Spinner, Card, LegendItem } from "../components/ui";
import {
  formatTokens,
  formatNumber,
  formatAiu,
  modelLabel,
  sourceLabel,
  formatDay,
} from "../lib/format";

const tooltipStyle = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text)",
  fontSize: 12,
  boxShadow: "var(--shadow)",
};

export function Overview({ range }: { range: Range }) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.summary(range).then((s) => alive && (setData(s), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [range.from, range.to, range.source]);

  if (loading || !data) return <Spinner />;

  const pref = data.preferredInterface;
  const prefLabel = pref.source ? sourceLabel(pref.source) : "—";

  const comp = data.usage;
  const compParts = [
    { key: "Input", val: comp.input, color: "var(--accent)" },
    { key: "Output", val: comp.output, color: "var(--success)" },
    { key: "Cache read", val: comp.cacheRead, color: "var(--vscode)" },
    { key: "Cache write", val: comp.cacheWrite, color: "var(--accent-2)" },
    { key: "Reasoning", val: comp.reasoning, color: "var(--cli)" },
  ];
  const compTotal = compParts.reduce((a, b) => a + b.val, 0) || 1;

  return (
    <>
      <div className="grid cards" style={{ marginBottom: 20 }}>
        <StatCard
          label="Total Sessions"
          value={formatNumber(data.totalSessions)}
          icon="💬"
          foot={
            <>
              <span className="chip cli">
                <span className="dot" />
                {data.sessionsBySource.cli} CLI
              </span>
              <span className="chip vscode">
                <span className="dot" />
                {data.sessionsBySource.vscode} VSCode
              </span>
            </>
          }
        />
        <StatCard
          label="Total Tokens"
          value={formatTokens(data.totalTokens)}
          icon="🔢"
          foot={<span>{formatNumber(data.totalTokens)} tokens</span>}
        />
        <StatCard
          label="Est. Cost"
          value={`${formatAiu(data.totalAiu)} AIU`}
          icon="💰"
          foot={
            <span>
              {data.totalAiu > 0
                ? `${Math.round(data.cacheHitRate * 100)}% cache hit rate`
                : "no billed usage (CLI-only)"}
            </span>
          }
        />
        <StatCard
          label="Top Model"
          value={data.topModel ? modelLabel(data.topModel.model) : "—"}
          icon="🧠"
          foot={data.topModel ? <span>{data.topModel.count} sessions</span> : undefined}
        />
        <StatCard
          label="Preferred Interface"
          value={prefLabel}
          icon="⚡"
          foot={<span>by session count · {pref.cli} vs {pref.vscode}</span>}
        />
      </div>

      <div className="chart-grid">
        <Card className="card-pad chart-card">
          <div className="section-title">
            Tokens per day
            <span className="section-sub">{data.activeDays} active days</span>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={data.tokensPerDay} margin={{ left: -10, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="gTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDay}
                tick={{ fontSize: 11, fill: "var(--text-faint)" }}
                stroke="var(--border)"
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v) => formatTokens(v as number)}
                tick={{ fontSize: 11, fill: "var(--text-faint)" }}
                stroke="var(--border)"
                width={48}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [formatNumber(v as number), "Tokens"]}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke="var(--accent)"
                strokeWidth={2}
                fill="url(#gTokens)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="card-pad chart-card">
          <div className="section-title">Token composition</div>
          <div style={{ display: "flex", height: 22, borderRadius: 8, overflow: "hidden", marginTop: 20 }}>
            {compParts.map((p) =>
              p.val > 0 ? (
                <div
                  key={p.key}
                  title={`${p.key}: ${formatNumber(p.val)}`}
                  style={{ width: `${(p.val / compTotal) * 100}%`, background: p.color }}
                />
              ) : null
            )}
          </div>
          <div className="legend" style={{ marginTop: 18 }}>
            {compParts.map((p) => (
              <div key={p.key} className="item">
                <LegendItem color={p.color} label={p.key} />
                <span className="muted">{formatTokens(p.val)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 22, fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.7 }}>
            Cache reuse:{" "}
            <b style={{ color: "var(--text)" }}>{Math.round(data.cacheHitRate * 100)}%</b>{" "}
            of read input tokens served from cache.
          </div>
        </Card>
      </div>
    </>
  );
}
