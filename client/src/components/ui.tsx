import { ReactNode } from "react";
import { Source } from "../lib/types";
import { sourceLabel } from "../lib/format";

export function StatCard({
  label,
  value,
  foot,
  icon,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="card card-pad stat">
      {icon && <div className="icon">{icon}</div>}
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function SourceChip({ source }: { source: Source }) {
  return (
    <span className={`chip ${source}`}>
      <span className="dot" />
      {sourceLabel(source)}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="loading">
      <div className="spinner" />
    </div>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="big">🪶</div>
      <div style={{ fontWeight: 600, color: "var(--text-dim)" }}>{message}</div>
      {hint && <div style={{ marginTop: 6, fontSize: 12.5 }}>{hint}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

export function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="item">
      <span className="sw" style={{ background: color }} />
      {label}
    </span>
  );
}
