import { useState } from "react";
import { mv, money } from "../../lib/mv";

/**
 * One market-search result. `url` is the seller's own page when SerpAPI returned it;
 * otherwise only `googleUrl` is set and `pageToken` lets the API look up the seller's page.
 */
export interface Listing {
  title: string; merchant: string; url: string | null; googleUrl: string | null; pageToken: string | null;
  priceCents: number | null; currency: string; thumbnail: string | null;
}

/** Best link to open in a browser for a listing. */
export const listingHref = (l: Listing) => l.url ?? l.googleUrl ?? undefined;

export default function CompetitorSearchBar({ initialQuery = "", trackedUrls = [], onTrack }: {
  initialQuery?: string; trackedUrls?: string[]; onTrack: (l: Listing) => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<Listing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (q.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      const r = await mv<{ results: Listing[] }>("GET", `/api/search/competitors?q=${encodeURIComponent(q.trim())}`);
      setResults(r.results);
    } catch (err) { setError((err as Error).message); setResults(null); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="mv-row">
        <input
          className="mv-input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
          placeholder="Product name or EAN" aria-label="Search competitor listings"
        />
        <button type="button" className="mv-btn primary" disabled={busy || q.trim().length < 3} onClick={() => void search()}>
          {busy ? "Searching…" : "Search market"}
        </button>
      </div>
      {error && <p className="mv-err" role="alert">{error}</p>}
      {results?.length === 0 && <p className="mv-muted">No listings found. Try the EAN or fewer keywords.</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {results?.map((r, i) => {
          const tracked = trackedUrls.includes(r.url ?? r.googleUrl ?? "");
          return (
            <li key={`${i}-${r.url ?? r.googleUrl}`} className="mv-card mv-row" style={{ padding: 12, justifyContent: "space-between" }}>
              <div className="mv-row" style={{ minWidth: 0, flex: 1 }}>
                {r.thumbnail && <img src={r.thumbnail} alt="" width={44} height={44} style={{ objectFit: "contain" }} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                  <div className="mv-muted">{r.merchant} · {money(r.priceCents, r.currency)}</div>
                </div>
              </div>
              <button type="button" className="mv-btn" disabled={tracked} onClick={() => onTrack(r)}>{tracked ? "Tracked" : "Track URL"}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
