import { Range } from "../lib/api";
import { isoDaysAgo, today } from "../lib/format";
import { SOURCES } from "../lib/types";

interface Props {
  range: Range;
  onChange: (r: Range) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  scannedAt?: string;
  auto?: boolean;
  onToggleAuto?: () => void;
  right?: React.ReactNode;
}

const PRESETS: { label: string; days: number | null }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
];

export function Toolbar({ range, onChange, onRefresh, refreshing, auto, onToggleAuto, right }: Props) {
  const setPreset = (days: number | null) => {
    onChange({ ...range, from: days ? isoDaysAgo(days) : undefined, to: days ? today() : undefined });
  };

  const activePreset = (): string | null => {
    if (!range.from) return "All";
    for (const p of PRESETS) {
      if (p.days && range.from === isoDaysAgo(p.days)) return p.label;
    }
    return null;
  };
  const active = activePreset();

  return (
    <div className="toolbar">
      <div className="segmented">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className={active === p.label ? "active" : ""}
            onClick={() => setPreset(p.days)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label>From</label>
        <input
          type="date"
          value={range.from ?? ""}
          max={range.to ?? today()}
          onChange={(e) => onChange({ ...range, from: e.target.value || undefined })}
        />
      </div>
      <div className="field">
        <label>To</label>
        <input
          type="date"
          value={range.to ?? ""}
          max={today()}
          onChange={(e) => onChange({ ...range, to: e.target.value || undefined })}
        />
      </div>

      <div className="segmented">
        {(["all", ...SOURCES] as const).map((s) => (
          <button
            key={s}
            className={range.source === s ? "active" : ""}
            onClick={() => onChange({ ...range, source: s })}
          >
            {s === "all"
              ? "All"
              : s === "cli"
              ? "CLI"
              : s === "vscode"
              ? "VSCode"
              : s === "claude"
              ? "Claude"
              : "OpenAI"}
          </button>
        ))}
      </div>

      <button className="ghost-btn" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? "Rescanning…" : "↻ Rescan"}
      </button>

      {onToggleAuto && (
        <button
          className={`ghost-btn ${auto ? "active" : ""}`}
          onClick={onToggleAuto}
          title="Auto-refresh when local data changes"
        >
          {auto ? "● Auto on" : "○ Auto"}
        </button>
      )}

      {right}
    </div>
  );
}
