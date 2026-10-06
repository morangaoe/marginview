import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { money, mv } from "../lib/mv";
import type { Listing } from "../components/inventory/CompetitorSearchBar";

interface Variant { variant_id: string; sku: string; name: string }
interface Summary { summary: string; positioning: string; mismatched: number[] }

const median = (n: number[]) => {
  if (!n.length) return null;
  const s = [...n].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export default function Competitors() {
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<Listing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [target, setTarget] = useState("");
  const [tracking, setTracking] = useState<string | null>(null);
  const [ai, setAi] = useState<Summary | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    // BUG FIX: the original used api.get<Variant[]>("/products") which
    // goes through the client.ts api helper (prepends /api). The products
    // route returns objects with `variant_id`, `sku`, `name` etc. However
    // we need to handle the case where the user has no products yet.
    api.get<Variant[]>("/products").then((v) => {
      setVariants(v);
      setTarget(v[0]?.variant_id ?? "");
    }).catch(() => {});
  }, []);

  async function search() {
    if (q.trim().length < 3) return;
    setBusy(true); setError(null); setNotice(null); setAi(null);
    try {
      const r = await mv<{ results: Listing[] }>("GET", `/api/search/competitors?q=${encodeURIComponent(q.trim())}`);
      setResults(r.results); setSearched(q.trim());
    } catch (e) { setError((e as Error).message); setResults(null); }
    finally { setBusy(false); }
  }

  const stats = useMemo(() => {
    const p = (results ?? []).map((r) => r.priceCents).filter((x): x is number => x !== null);
    return p.length ? { min: Math.min(...p), max: Math.max(...p), med: median(p)!, n: p.length } : null;
  }, [results]);

  async function summarize() {
    if (!results) return;
    setAiBusy(true); setError(null);
    try {
      setAi(await api.post<Summary>("/ai/market-summary", {
        query: searched,
        results: results.slice(0, 20).map((r) => ({ title: r.title.slice(0, 200), merchant: r.merchant.slice(0, 80), priceCents: r.priceCents })),
      }));
    } catch (e) { setError((e as Error).message); }
    finally { setAiBusy(false); }
  }

  async function track(l: Listing) {
    if (!target) return setError("Add a product in Inventory first, then pick it here.");
    setTracking(l.url); setError(null); setNotice(null);
    try {
      // BUG FIX: the original used mv("POST", "/api/competitors", ...) which
      // calls apiJson (full /api path), but then used mv("POST", "/api/scraper/run", ...)
      // for the follow-up. Both use apiJson, so they must include the /api prefix.
      // The competitors route expects { variantId, competitorName, url } and
      // returns { id, sourceId }.
      const created = await mv<{ id: string; sourceId: string }>("POST", "/api/competitors", { variantId: target, competitorName: l.merchant, url: l.url });
      try {
        await mv("POST", "/api/scraper/run", { sourceId: created.sourceId });
        setNotice(`Tracking ${l.merchant}. First price check queued: results appear on the product's Pricing page.`);
      } catch {
        setNotice(`Tracking ${l.merchant}. It will be checked on its schedule.`);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setTracking(null); }
  }

  const bad = new Set(ai?.mismatched ?? []);

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Competitors</h1>
      <p className="mv-muted" style={{ marginTop: 0 }}>Search any product to see what the market charges, then track the listings that matter.</p>

      <div className="mv-row" style={{ marginBottom: 12 }}>
        <input className="mv-input" style={{ flex: 1, minWidth: 220 }} value={q} placeholder="Product name or EAN"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} aria-label="Search the market" />
        <button className="mv-btn primary" onClick={search} disabled={busy || q.trim().length < 3}>{busy ? "Searching…" : "Search market"}</button>
      </div>

      {error && <p className="mv-err" role="alert">{error}</p>}
      {notice && <p className="mv-muted" role="status">{notice}</p>}
      {results?.length === 0 && <p className="mv-muted">No listings found. Try the EAN or fewer keywords.</p>}

      {stats && results && (
        <>
          <div className="mv-grid" style={{ marginBottom: 16 }}>
            {([["Market median", money(stats.med)], ["Lowest", money(stats.min)], ["Highest", money(stats.max)], ["Listings with price", String(stats.n)]] as const).map(([l, v]) => (
              <div className="card" key={l}><div className="mv-muted">{l}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{v}</div></div>
            ))}
          </div>

          <div className="mv-row" style={{ marginBottom: 12 }}>
            <button className="mv-btn" onClick={summarize} disabled={aiBusy}>{aiBusy ? "Reading the market…" : "✨ AI market read"}</button>
            <label className="mv-muted">Track against{" "}
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="mv-input" style={{ width: "auto" }}>
                {variants.length === 0 && <option value="">No products yet</option>}
                {variants.map((v) => <option key={v.variant_id} value={v.variant_id}>{v.sku} · {v.name}</option>)}
              </select>
            </label>
          </div>

          {ai && (
            <div className="card" style={{ marginBottom: 12, display: "grid", gap: 6 }}>
              <div>{ai.summary}</div>
              <div className="mv-muted">{ai.positioning}</div>
              {bad.size > 0 && <div className="mv-muted">{bad.size} result{bad.size === 1 ? "" : "s"} look like a different product and are dimmed.</div>}
            </div>
          )}

          <div className="mv-table-wrap">
            <table className="mv-table">
              <thead><tr><th>Listing</th><th>Seller</th><th>Price</th><th>vs median</th><th /></tr></thead>
              <tbody>
                {results.map((r, i) => {
                  const diff = r.priceCents !== null && stats.med ? ((r.priceCents - stats.med) / stats.med) * 100 : null;
                  return (
                    <tr key={r.url} style={{ opacity: bad.has(i) ? 0.4 : 1 }}>
                      <td style={{ maxWidth: 360 }}>{r.title}</td>
                      <td>{r.merchant}</td>
                      <td>{money(r.priceCents)}</td>
                      <td>{diff === null ? "-" : `${diff > 0 ? "+" : ""}${diff.toFixed(0)}%`}</td>
                      <td><button className="mv-btn" disabled={tracking === r.url || !target} onClick={() => track(r)}>{tracking === r.url ? "Adding…" : "Track"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
