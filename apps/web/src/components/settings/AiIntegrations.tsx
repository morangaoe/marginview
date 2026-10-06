import { FormEvent, useState } from "react";
import { api } from "../../api/client";
import { useMv } from "../../lib/mv";

interface Status {
  ownKey: boolean; last4: string | null; model: string | null;
  platformKeyAvailable: boolean; usageThisMonth: number; monthlyLimit: number;
}

export default function AiIntegrations({ isOwner }: { isOwner: boolean }) {
  // BUG FIX: useMv uses apiJson which expects the full /api-prefixed path,
  // but on the same page the api.put/delete client from client.ts prepends
  // /api itself. Both resolve to the same final URL, but if someone changes
  // one client's base they'd break the other. This is fine as-is, but noted
  // for consistency.
  const { data, loading, reload } = useMv<Status>("/api/integrations/gemini");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api.put("/integrations/gemini", { apiKey: apiKey.trim(), model: model.trim() || undefined });
      setApiKey(""); setMsg({ ok: true, text: "Key verified and saved." }); reload();
    } catch (err: any) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setMsg(null);
    try { await api.delete("/integrations/gemini"); setMsg({ ok: true, text: "Your key was removed." }); reload(); }
    catch (err: any) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  if (loading || !data) return <div className="card mv-muted">Loading…</div>;
  const usingOwn = data.ownKey;

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <strong style={{ display: "block", marginBottom: 4 }}>AI assistant (Gemini)</strong>
      <p style={{ color: "var(--slate)", fontSize: 13, marginTop: 0 }}>
        Powers pricing-weight suggestions, scrape fallback and market summaries. Suggestions never change a price on their own.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <span className={`pill ${usingOwn || data.platformKeyAvailable ? "ok" : "crit"}`}>
          <span className="dot" />{usingOwn ? `Your key ····${data.last4}` : data.platformKeyAvailable ? "Included with your plan" : "Not configured"}
        </span>
        {!usingOwn && data.platformKeyAvailable && (
          <span className="mv-muted">{data.usageThisMonth} of {data.monthlyLimit} requests used this month</span>
        )}
      </div>

      {isOwner ? (
        <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 13 }}>Use your own Gemini API key (optional)
            <input type="password" autoComplete="off" className="mv-input" value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} placeholder="Paste key. It's encrypted and never shown again." />
          </label>
          <label style={{ fontSize: 13 }}>Model (optional)
            <input className="mv-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gemini-2.5-flash" />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="mv-btn primary" disabled={busy || apiKey.trim().length < 20}>{busy ? "Verifying…" : "Verify and save"}</button>
            {usingOwn && <button type="button" className="mv-btn" disabled={busy} onClick={remove}>Remove my key</button>}
          </div>
        </form>
      ) : <p className="mv-muted">Only the workspace owner can change API keys.</p>}

      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "mv-muted" : "mv-err"}>{msg.text}</p>}
    </div>
  );
}
