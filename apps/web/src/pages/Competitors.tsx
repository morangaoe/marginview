import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { money, mv } from "../lib/mv";
import { listingHref, type Listing } from "../components/inventory/CompetitorSearchBar";

interface Variant { variant_id: string; sku: string; name: string }
interface Summary { summary: string; positioning: string; mismatched: number[] }
interface TrackResponse { id: string; sourceId: string; url: string; complianceStatus: string; complianceReason: string }
interface Similar {
  variant: { id: string; sku: string; name: string; priceCents: number; currency: string };
  band: { pct: number; minCents: number; maxCents: number };
  query: string;
  stats: { found: number; noPrice: number; otherCurrency: number; outsideBand: number; inBand: number };
  results: Array<Listing & { diffPct: number }>;
}

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
  const [similar, setSimilar] = useState<Similar | null>(null);
  const [similarBusy, setSimilarBusy] = useState(false);
  const [similarErr, setSimilarErr] = useState<string | null>(null);

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

  // Stats use the most common currency only, so mixed-currency results don't skew the median.
  const stats = useMemo(() => {
    const priced = (results ?? []).filter((r) => r.priceCents !== null);
    if (!priced.length) return null;
    const counts = new Map<string, number>();
    for (const r of priced) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
    const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const p = priced.filter((r) => r.currency === currency).map((r) => r.priceCents!);
    return { min: Math.min(...p), max: Math.max(...p), med: median(p)!, n: p.length, currency };
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

  async function findSimilar() {
    if (!target) return setSimilarErr("Add a product in Inventory first, then pick it here.");
    setSimilarBusy(true); setSimilarErr(null);
    try {
      setSimilar(await mv<Similar>("GET", `/api/competitors/similar?variantId=${encodeURIComponent(target)}`));
    } catch (e) { setSimilarErr((e as Error).message); setSimilar(null); }
    finally { setSimilarBusy(false); }
  }

  /** Market results often only carry a Google link; the API swaps it for the seller's page via pageToken. */
  async function track(l: Listing, key: string) {
    if (!target) return setError("Add a product in Inventory first, then pick it here.");
    setTracking(key); setError(null); setNotice(null);
    try {
      const created = await mv<TrackResponse>("POST", "/api/competitors", {
        variantId: target, competitorName: l.merchant, url: l.url ?? undefined, pageToken: l.pageToken ?? undefined,
      });
      const host = new URL(created.url).hostname.replace(/^www\./, "");
      if (created.complianceStatus === "manual_only") {
        setNotice(`Tracking ${l.merchant} (${host}) for manual entry only. ${created.complianceReason}`);
        return;
      }
      try {
        await mv("POST", "/api/scraper/run", { sourceId: created.sourceId });
        setNotice(`Tracking ${l.merchant} (${host}). First price check queued; see Competitor sources for the result.`);
      } catch (e) {
        // Show the real reason (e.g. the queue isn't configured) instead of pretending it's scheduled.
        setNotice(`Tracking ${l.merchant} (${host}), but the first check couldn't start: ${(e as Error).message}`);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setTracking(null); }
  }

  const bad = new Set(ai?.mismatched ?? []);

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Competitors</h1>
      <p className="mv-muted" style={{ marginTop: 0 }}>Search any product to see what the market charges, then track the listings that matter.</p>

      <section className="card" style={{ marginBottom: 20, display: "grid", gap: 10 }} aria-labelledby="similar-h">
        <div>
          <h2 id="similar-h" style={{ fontSize: 16, margin: 0 }}>Similar products</h2>
          <p className="mv-muted" style={{ margin: "2px 0 0" }}>Five random market listings priced within 20% of your current price.</p>
        </div>
        <div className="mv-row">
          <select value={target} onChange={(e) => { setTarget(e.target.value); setSimilar(null); }} className="mv-input" style={{ flex: 1, minWidth: 200 }} aria-label="Your product">
            {variants.length === 0 && <option value="">No products yet</option>}
            {variants.map((v) => <option key={v.variant_id} value={v.variant_id}>{v.sku} · {v.name}</option>)}
          </select>
          <button className="mv-btn primary" onClick={findSimilar} disabled={similarBusy || !target}>
            {similarBusy ? "Searching…" : similar ? "Shuffle" : "Find similar products"}
          </button>
        </div>
        {similarErr && <p className="mv-err" role="alert" style={{ margin: 0 }}>{similarErr}</p>}
        {similar && (
          <>
            <p className="mv-muted" style={{ margin: 0 }}>
              Your price {money(similar.variant.priceCents, similar.variant.currency)} · band {money(similar.band.minCents, similar.variant.currency)} to {money(similar.band.maxCents, similar.variant.currency)} ·{" "}
              {similar.stats.inBand} of {similar.stats.found} listings in range
              {similar.stats.otherCurrency > 0 && `, ${similar.stats.otherCurrency} in another currency`}
              {similar.stats.noPrice > 0 && `, ${similar.stats.noPrice} without a price`}
            </p>
            {similar.results.length === 0 ? (
              <p className="mv-muted" style={{ margin: 0 }}>No listings for "{similar.query}" fall within 20% of your price.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {similar.results.map((r, i) => {
                  const key = `similar-${i}`;
                  const href = listingHref(r);
                  return (
                    <li key={key} className="mv-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <div className="mv-row" style={{ minWidth: 0, flex: 1, flexWrap: "nowrap" }}>
                        {r.thumbnail && <img src={r.thumbnail} alt="" width={40} height={40} style={{ objectFit: "contain", flexShrink: 0 }} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {href ? <a href={href} target="_blank" rel="noopener noreferrer">{r.title}</a> : r.title}
                          </div>
                          <div className="mv-muted">
                            {r.merchant} · {money(r.priceCents, r.currency)} · {r.diffPct > 0 ? "+" : ""}{r.diffPct.toFixed(0)}% vs yours
                          </div>
                        </div>
                      </div>
                      <button className="mv-btn" disabled={tracking === key} onClick={() => track(r, key)}>{tracking === key ? "Adding…" : "Track"}</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

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
            {([["Market median", money(stats.med, stats.currency)], ["Lowest", money(stats.min, stats.currency)], ["Highest", money(stats.max, stats.currency)], ["Listings with price", String(stats.n)]] as const).map(([l, v]) => (
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
                  const key = `search-${i}`;
                  const href = listingHref(r);
                  const comparable = r.priceCents !== null && r.currency === stats.currency;
                  const diff = comparable && stats.med ? ((r.priceCents! - stats.med) / stats.med) * 100 : null;
                  return (
                    <tr key={key} style={{ opacity: bad.has(i) ? 0.4 : 1 }}>
                      <td style={{ maxWidth: 360 }}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{r.title}</a> : r.title}</td>
                      <td>{r.merchant}</td>
                      <td>{money(r.priceCents, r.currency)}</td>
                      <td>{diff === null ? "-" : `${diff > 0 ? "+" : ""}${diff.toFixed(0)}%`}</td>
                      <td><button className="mv-btn" disabled={tracking === key || !target} onClick={() => track(r, key)}>{tracking === key ? "Adding…" : "Track"}</button></td>
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
