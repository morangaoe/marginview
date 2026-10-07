import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../types/inventory";
import { getLeadToken, publicApi } from "../lib/lead";
import { money } from "../lib/mv";
import { EmailGate } from "./EmailGate";

interface Result { title: string; merchant: string; url: string | null; googleUrl: string | null; priceCents: number | null; currency: string; thumbnail: string | null }
interface SearchResponse {
  query: string; results: Result[]; remaining: number; unlocked: boolean;
  stats: { medianCents: number; minCents: number; maxCents: number; count: number; currency: string } | null;
}

/** Competitor search for visitors without an account: 2 free searches, more once they give an email. */
export function FreeMarketSearch() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<"email" | "signup" | null>(null);

  async function search() {
    if (q.trim().length < 3) return;
    setBusy(true); setError(null); setGate(null);
    try {
      setData(await publicApi<SearchResponse>(`/api/public/search?q=${encodeURIComponent(q.trim())}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setGate(getLeadToken() ? "signup" : "email");
      else setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <section className="card" style={{ background: "var(--card)", display: "grid", gap: 14 }} aria-labelledby="free-search-h">
      <div>
        <h2 id="free-search-h" style={{ fontSize: 18, margin: 0 }}>Check any product against the market</h2>
        <p style={{ color: "var(--slate)", fontSize: 13, margin: "4px 0 0" }}>
          The same competitor search that runs inside Marginview. No account needed.
        </p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void search(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name or EAN" aria-label="Search the market" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn primary" disabled={busy || q.trim().length < 3}>{busy ? "Searching…" : "Search market"}</button>
      </form>

      {error && <div role="alert" style={{ color: "var(--critical)", fontSize: 13 }}>{error}</div>}
      {gate === "email" && (
        <EmailGate source="market_search" title="Unlock more free searches"
          body="Enter your email to get 5 free searches a day and the free price audit." onUnlocked={() => void search()} />
      )}
      {gate === "signup" && (
        <div className="card">
          <div style={{ fontWeight: 600 }}>You've used today's free searches</div>
          <p style={{ color: "var(--slate)", fontSize: 13 }}>Start a free trial for unlimited searches, tracking and alerts.</p>
          <Link to="/signup" className="btn primary">Start free trial</Link>
        </div>
      )}

      {data && !gate && (
        <>
          {data.results.length === 0 && <p style={{ color: "var(--slate)", margin: 0 }}>No listings found. Try the EAN or fewer keywords.</p>}
          {data.stats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
              {([["Market median", data.stats.medianCents], ["Lowest", data.stats.minCents], ["Highest", data.stats.maxCents]] as const).map(([l, v]) => (
                <div key={l}><div style={{ color: "var(--slate)", fontSize: 12 }}>{l}</div><div className="mv-stat">{money(v, data.stats!.currency)}</div></div>
              ))}
            </div>
          )}
          {data.results.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Listing</th><th>Seller</th><th>Price</th></tr></thead>
                <tbody>
                  {data.results.map((r, i) => {
                    const href = r.url ?? r.googleUrl;
                    return (
                      <tr key={i}>
                        <td style={{ maxWidth: 360 }}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{r.title}</a> : r.title}</td>
                        <td>{r.merchant}</td>
                        <td className="mono">{money(r.priceCents, r.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ color: "var(--slate)", fontSize: 12 }}>
            {data.remaining > 0 ? `${data.remaining} free search${data.remaining === 1 ? "" : "es"} left today. ` : "That was your last free search today. "}
            <Link to="/signup">Track these prices automatically</Link>
          </div>
        </>
      )}
    </section>
  );
}
