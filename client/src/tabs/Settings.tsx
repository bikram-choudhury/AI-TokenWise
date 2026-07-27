import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { DetectionCandidate, ProviderInfo, Source, SourceConfig } from "../lib/types";
import { Card, Spinner } from "../components/ui";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

interface RowState extends SourceConfig {
  status?: "ok" | "missing" | "checking";
  detecting?: boolean;
  detected?: DetectionCandidate[];
}

export function Settings({ onSaved }: { onSaved?: () => void }) {
  const [rows, setRows] = useState<RowState[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((res) => {
      setRows(res.settings.sources);
      setProviders(res.providers);
      setLoading(false);
      res.settings.sources.forEach((s) => checkPath(s.id, s.path));
    });
  }, []);

  const update = (id: string, patch: Partial<RowState>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const applyDetectedPath = async (id: string, candidate: DetectionCandidate) => {
    update(id, { path: candidate.path, detected: [candidate] });
    await checkPath(id, candidate.path);
  };

  const checkPath = async (id: string, path: string) => {
    if (!path.trim()) {
      update(id, { status: "missing" });
      return;
    }
    update(id, { status: "checking" });
    const v = await api.validatePath(path);
    update(id, { status: v.exists ? "ok" : "missing" });
  };

  const addRow = () => {
    const provider: Source = (providers[0]?.id as Source) ?? "cli";
    setRows((rs) => [
      ...rs,
      { id: uid(), provider, label: "", path: "", enabled: true },
    ]);
  };

  const detect = async (id: string, provider: Source) => {
    update(id, { detecting: true, detected: [] });
    const res = await api.detectSource(provider);
    update(id, { detecting: false, detected: res.candidates });
    if (res.candidates[0]) await applyDetectedPath(id, res.candidates[0]);
  };

  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id));

  const save = async () => {
    setSaving(true);
    const clean = rows.map(({ status, ...s }) => s);
    await api.saveSettings({ sources: clean });
    setSaving(false);
    setSavedAt(new Date().toLocaleTimeString());
    onSaved?.();
  };

  if (loading) return <Spinner />;

  return (
    <Card className="card-pad">
      <div className="settings-head">
        <div className="section-title">Data sources</div>
        <div className="spacer" />
        <button className="ghost-btn" onClick={addRow}>
          + Add source
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 12.5 }}>
        Register the file or directory each AI tool writes its session logs to. TokenWise reads
        these paths (read-only) to build your analytics. Settings persist to{" "}
        <code>~/.tokenwise/settings.json</code>.
      </p>

      {rows.map((r) => (
        <div key={r.id} className={`source-row ${r.enabled ? "" : "disabled"}`}>
          <select
            value={r.provider}
            onChange={(e) => update(r.id, { provider: e.target.value as Source, detected: [] })}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Label"
            value={r.label}
            onChange={(e) => update(r.id, { label: e.target.value })}
          />

          <div className="path-cell">
            <input
              type="text"
              placeholder="Absolute path to file or folder"
              value={r.path}
              onChange={(e) => update(r.id, { path: e.target.value, status: undefined })}
              onBlur={(e) => checkPath(r.id, e.target.value)}
            />
            {r.status === "ok" && <span className="path-status ok">✓ path found</span>}
            {r.status === "missing" && <span className="path-status missing">✕ not found</span>}
            {r.status === "checking" && <span className="path-status">checking…</span>}
            {r.detected && r.detected.length > 0 && (
              <div className="detect-list">
                {r.detected.map((candidate) => (
                  <button
                    key={candidate.path}
                    className="detect-chip"
                    onClick={() => applyDetectedPath(r.id, candidate)}
                    title={candidate.path}
                  >
                    {candidate.confidence} · {candidate.matchCount} match{candidate.matchCount === 1 ? "" : "es"}
                  </button>
                ))}
                <div className="detect-reason">{r.detected[0].reason}</div>
              </div>
            )}
          </div>

          <button className="ghost-btn" onClick={() => detect(r.id, r.provider)} disabled={r.detecting}>
            {r.detecting ? "Detecting…" : "Auto-detect"}
          </button>

          <button
            className={`toggle-btn ${r.enabled ? "on" : ""}`}
            onClick={() => update(r.id, { enabled: !r.enabled })}
            title="Enable / disable this source"
          >
            {r.enabled ? "● Enabled" : "○ Disabled"}
          </button>

          <button className="remove-btn" onClick={() => removeRow(r.id)} title="Remove">
            ✕
          </button>
        </div>
      ))}

      {rows.length === 0 && (
        <p className="muted" style={{ fontSize: 12.5 }}>
          No sources configured. Add one to start pulling data.
        </p>
      )}

      <div className="settings-actions">
        <button className="primary-btn" onClick={save} disabled={saving}>
          {saving ? "Saving & rescanning…" : "Save & rescan"}
        </button>
        {savedAt && <span className="settings-saved">Saved at {savedAt}</span>}
      </div>
    </Card>
  );
}
