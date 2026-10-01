import { useCallback, useEffect, useState } from "react";
import { mv, money } from "../../lib/mv";
import CompetitorUrlInput, { saveCompetitorTargets, type CompetitorEntry } from "./CompetitorUrlInput";
import "../../styles/modules.css";

interface Target {
  id: string; competitorName: string; sourceId: string; url: string;
  complianceStatus: string; lastPriceCents: number | null; lastScrapedAt: string | null;
}

export default function CompetitorTargetsModal({ variantId, title, onClose }: { variantId: string; title: string; onClose: () => void }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [pending, setPending] = useState<CompetitorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await mv<{ targets: Target[] }>("GET", `/api/competitors?variantId=${encodeURIComponent(variantId)}`);
      setTargets(r.targets); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [variantId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function savePending() {
    setBusy("save"); setError(null);
    try { await saveCompetitorTargets(variantId, pending); setPending([]); setNotice("Competitor URLs saved."); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function checkNow(t: Target) {
    setBusy(t.id); setError(null);
    try { await mv("POST", "/api/scraper/run", { sourceId: t.sourceId }); setNotice(`Price check queued for ${t.competitorName}. Reopen this window in a minute.`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function remove(t: Target) {
    setBusy(t.id); setError(null);
    try { await mv("DELETE", `/api/competitors/${t.id}`); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-modal" role="dialog" aria-modal="true" aria-label={`Competitors for ${title}`} onClick={(e) => e.stopPropagation()}>
        <div className="mv-row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Competitors for {title}</h2>
          <button className="mv-btn" onClick={onClose}>Close</button>
        </div>
        {error && <p className="mv-err" role="alert">{error}</p>}
        {notice && <p className="mv-muted" role="status">{notice}</p>}

        {loading ? <p className="mv-muted">Loading…</p> : targets.length === 0 ? <p className="mv-muted">No competitor URLs tracked yet.</p> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {targets.map((t) => (
              <li key={t.id} className="mv-row" style={{ justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{t.competitorName}</strong> <span className="mv-muted">{money(t.lastPriceCents)}</span>
                  <div className="mv-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{t.url}</div>
                </div>
                <div className="mv-row">
                  <button className="mv-btn" disabled={busy === t.id || t.complianceStatus === "manual_only"} onClick={() => checkNow(t)}>Check price now</button>
                  <button className="mv-btn" disabled={busy === t.id} onClick={() => remove(t)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <CompetitorUrlInput value={pending} onChange={setPending} searchHint={title} />
        <div className="mv-row" style={{ justifyContent: "flex-end" }}>
          <button className="mv-btn primary" disabled={!pending.length || busy === "save"} onClick={savePending}>
            {busy === "save" ? "Saving…" : `Save ${pending.length || ""} competitor URL${pending.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
