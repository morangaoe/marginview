import { useState } from "react";
import { request, useApi } from "../lib/useApi";
import StateView from "../components/StateView";
import "../styles/extra-pages.css";

type Source = {
  id: string; url: string; productName: string; intervalHours: number;
  mode: "automatic" | "manual_only"; lastCheckedAt: string | null; lastStatus: "ok" | "failed" | null; lastError?: string;
};

export default function CompetitorSources() {
  const { data, error, loading, reload } = useApi<Source[]>("/scraping/sources");
  const [url, setUrl] = useState("");
  const [productId, setProductId] = useState("");
  const [intervalHours, setIntervalHours] = useState(12);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setMsg(null);
    try { new URL(url); } catch { return setMsg("Enter a full URL, starting with https://"); }
    if (!productId.trim()) return setMsg("Enter the product or SKU ID this source tracks.");
    setBusy(true);
    try {
      // Server runs the compliance check (robots + terms) and may return mode "manual_only".
      await request("/scraping/sources", { method: "POST", body: JSON.stringify({ url, productId, intervalHours }) });
      setUrl(""); setProductId("");
      reload();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function remove(s: Source) {
    if (!window.confirm(`Stop tracking ${s.url}?`)) return;
    try { await request(`/scraping/sources/${s.id}`, { method: "DELETE" }); reload(); }
    catch (e) { setMsg((e as Error).message); }
  }

  const state = (s: Source) => {
    if (s.mode === "manual_only") return <span className="mv-badge">Manual entry only</span>;
    if (s.lastStatus === "failed") return <span className="mv-badge warn">Last check failed{s.lastError ? `: ${s.lastError}` : ""}</span>;
    if (s.lastStatus === "ok") return <span className="mv-badge">Working</span>;
    return <span className="mv-badge">Not checked yet</span>;
  };

  return (
    <div className="mv-page">
      <h1>Tracked competitor sources</h1>
      <p className="mv-sub">
        Pages we check for competitor prices. We only collect the price, stock status and currency shown publicly. Sites that don't allow
        automated access switch to manual entry.
      </p>
      <div className="mv-row">
        <div className="mv-field"><label htmlFor="cs-url">Competitor page URL</label>
          <input id="cs-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></div>
        <div className="mv-field"><label htmlFor="cs-pid">Product or SKU ID</label>
          <input id="cs-pid" value={productId} onChange={(e) => setProductId(e.target.value)} /></div>
        <div className="mv-field"><label htmlFor="cs-int">Check every</label>
          <select id="cs-int" value={intervalHours} onChange={(e) => setIntervalHours(Number(e.target.value))}>
            {[1, 6, 12, 24].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""}</option>)}
          </select></div>
        <button className="mv-btn" onClick={add} disabled={busy}>Add source</button>
      </div>
      {msg && <p className="mv-error" role="alert">{msg}</p>}
      <StateView loading={loading} error={error} onRetry={reload} isEmpty={!data || data.length === 0}
        emptyTitle="No tracked competitors yet" emptyHint="Add a competitor page above to start comparing prices.">
        <div className="mv-table-wrap">
          <table className="mv-table">
            <thead><tr><th>Source</th><th>Product</th><th>Every</th><th>Last checked</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id}>
                  <td style={{ wordBreak: "break-all" }}>{s.url}</td><td>{s.productName}</td><td>{s.intervalHours}h</td>
                  <td>{s.lastCheckedAt ? new Date(s.lastCheckedAt).toLocaleString() : "Never"}</td>
                  <td>{state(s)}</td>
                  <td><button className="mv-btn danger" onClick={() => remove(s)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StateView>
    </div>
  );
}
