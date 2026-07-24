import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { api, Range } from "../lib/api";
import { TokenInsights as TI } from "../lib/types";
import { Card, Spinner, EmptyState } from "../components/ui";
import { formatTokens, formatNumber, formatAiu, modelLabel, formatDay, sourceLabel } from "../lib/format";

const tooltipStyle = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text)",
  fontSize: 12,
  boxShadow: "var(--shadow)",
};

const CAT_COLORS = ["var(--accent)", "var(--vscode)", "var(--success)", "var(--cli)", "var(--accent-2)", "var(--danger)"];

export function Tokens({ range }: { range: Range }) {
  const [data, setData] = useState<TI | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.tokens(range).then((d) => alive && (setData(d), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [range.from, range.to, range.source]);

  if (loading || !data) return <Spinner />;
  if (data.overTime.length === 0) return <EmptyState message="No token data in this range" />;

  const comp = data.composition;
  const compData = [
    { name: "Input", value: comp.input },
    { name: "Output", value: comp.output },
    { name: "Cache read", value: comp.cacheRead },
    { name: "Cache write", value: comp.cacheWrite },
    { name: "Reasoning", value: comp.reasoning },
  ].filter((d) => d.value > 0);

  return (
    <div className="chart-grid">
      <Card className="card-pad chart-card" style={{ gridColumn: "1 / -1" } as React.CSSProperties}>
        <div className="section-title">Tokens over time · CLI vs VSCode</div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.overTime} margin={{ left: -10, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="gCli" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--cli)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--cli)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gVsc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--vscode)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--vscode)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" minTickGap={24} />
            <YAxis tickFormatter={(v) => formatTokens(v as number)} tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" width={48} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [formatNumber(v as number), sourceLabel(n as string)]} />
            <Area type="monotone" dataKey="cli" stackId="1" stroke="var(--cli)" strokeWidth={2} fill="url(#gCli)" />
            <Area type="monotone" dataKey="vscode" stackId="1" stroke="var(--vscode)" strokeWidth={2} fill="url(#gVsc)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Card className="card-pad chart-card">
        <div className="section-title">
          Tokens by model
          {data.totalAiu > 0 && <span className="section-sub">{formatAiu(data.totalAiu)} AIU total</span>}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.byModel} layout="vertical" margin={{ left: 20, right: 12 }}>
            <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => formatTokens(v as number)} tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" />
            <YAxis type="category" dataKey="model" tickFormatter={modelLabel} tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" width={110} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent-soft)" }} formatter={(v) => [formatNumber(v as number), "Tokens"]} />
            <Bar dataKey="total" fill="var(--accent)" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card className="card-pad chart-card">
        <div className="section-title">Usage composition</div>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={compData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
              {compData.map((_, i) => (
                <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} stroke="var(--bg-elev)" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatNumber(v as number)} />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-dim)" }} />
          </PieChart>
        </ResponsiveContainer>
      </Card>

      {data.byRepo.length > 0 && (
        <Card className="card-pad chart-card" style={{ gridColumn: "1 / -1" } as React.CSSProperties}>
          <div className="section-title">
            Tokens by repository
            <span className="section-sub">top {Math.min(data.byRepo.length, 12)} repos</span>
          </div>
          <ResponsiveContainer width="100%" height={Math.min(data.byRepo.length, 12) * 34 + 30}>
            <BarChart data={data.byRepo.slice(0, 12)} layout="vertical" margin={{ left: 20, right: 12 }}>
              <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => formatTokens(v as number)} tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" />
              <YAxis type="category" dataKey="repository" tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" width={180} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "var(--accent-soft)" }}
                formatter={(v, _n, item) => {
                  const p = (item && (item as { payload?: { sessions?: number; aiu?: number } }).payload) || {};
                  const extra = p.aiu && p.aiu > 0 ? ` · ${formatAiu(p.aiu)} AIU` : "";
                  return [`${formatNumber(v as number)} · ${p.sessions ?? 0} sessions${extra}`, "Tokens"];
                }}
              />
              <Bar dataKey="total" fill="var(--vscode)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {data.promptCategories.length > 0 && (
        <Card className="card-pad chart-card" style={{ gridColumn: "1 / -1" } as React.CSSProperties}>
          <div className="section-title">
            Prompt token breakdown
            <span className="section-sub">where input tokens are spent (VSCode)</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.promptCategories} margin={{ left: -6, right: 8, top: 8 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="category" tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" />
              <YAxis tickFormatter={(v) => formatTokens(v as number)} tick={{ fontSize: 11, fill: "var(--text-faint)" }} stroke="var(--border)" width={48} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent-soft)" }} formatter={(v) => [formatNumber(v as number), "Tokens"]} />
              <Bar dataKey="tokens" fill="var(--accent-2)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}
