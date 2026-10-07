import { useState } from "react";
import { mv } from "../../lib/mv";
import CompetitorSearchBar, { type Listing } from "./CompetitorSearchBar";

/** `pageToken` (from market search) lets the API swap a Google Shopping link for the seller's own page. */
export interface CompetitorEntry { competitorName: string; url: string; pageToken?: string }

/** Persist entries once the product exists (idempotent: re-saving the same URL is a no-op). */
export async function saveCompetitorTargets(variantId: string, entries: CompetitorEntry[]) {
  await Promise.all(entries.map((e) => mv("POST", "/api/competitors", { variantId, ...e })));
}

export default function CompetitorUrlInput({ value, onChange, searchHint = "" }: {
  value: CompetitorEntry[]; onChange: (v: CompetitorEntry[]) => void; searchHint?: string;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function add(entry: CompetitorEntry): boolean {
    try {
      const u = new URL(entry.url);
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch { setError("Enter a full product URL starting with http:// or https://"); return false; }
    if (value.some((v) => v.url === entry.url)) { setError("That URL is already tracked."); return false; }
    setError(null);
    onChange([...value, entry]);
    return true;
  }

  function addManual() {
    if (add({ competitorName: name.trim(), url: url.trim() })) { setUrl(""); setName(""); }
  }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); if (url.trim()) addManual(); } };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <label style={{ fontWeight: 600 }}>Competitor target URLs</label>
      <div className="mv-row">
        <input className="mv-input" style={{ flex: "0 1 150px" }} placeholder="Competitor" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
        <input className="mv-input" style={{ flex: 1, minWidth: 160 }} placeholder="https://competitor.com/product" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={onEnter} />
        <button type="button" className="mv-btn" onClick={addManual} disabled={!url.trim()}>Add</button>
      </div>
      {error && <p className="mv-err" role="alert">{error}</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {value.map((v) => (
          <li key={v.url} className="mv-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {v.competitorName || new URL(v.url).hostname}{" "}
              <span className="mv-muted">{v.pageToken && /google\./.test(v.url) ? "seller page will be looked up on save" : v.url}</span>
            </span>
            <button type="button" className="mv-btn" onClick={() => onChange(value.filter((x) => x.url !== v.url))} aria-label={`Remove ${v.url}`}>Remove</button>
          </li>
        ))}
      </ul>
      <button type="button" className="mv-btn" onClick={() => setShowSearch((s) => !s)} aria-expanded={showSearch}>
        {showSearch ? "Hide market search" : "Find competitor listings"}
      </button>
      {showSearch && <CompetitorSearchBar initialQuery={searchHint} trackedUrls={value.map((v) => v.url)} onTrack={(l: Listing) => add({ competitorName: l.merchant, url: l.url ?? l.googleUrl ?? "", pageToken: l.pageToken ?? undefined })} />}
    </div>
  );
}
