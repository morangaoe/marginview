import { useState } from "react";
import { request, useApi } from "../lib/useApi";
import StateView from "../components/StateView";
import "../styles/extra-pages.css";

// Shape returned by GET /api/scraping/sources
type Source = {
  id: string;
  url: string;
  compliance_status: string;
  scrape_interval_minutes: number;
  last_checked_at: string | null;
  last_status: "ok" | "failed" | null;
  competitor_product_id: string;
  competitor_name: string;
  price_selector: string | null;
  sku: string;
  product_name: string;
  latest_price_cents: number | null;
  latest_currency: string | null;
  latest_observed_at: string | null;
  validation_flag: string | null;
};

const INTERVALS = [
  { minutes: 60, label: "1 hour" },
  { minutes: 360, label: "6 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "24 hours" },
];

function money(cents: number, currency: string | null) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export default function CompetitorSources() {
  const { data, error, loading, reload } = useApi<Source[]>("/scraping/sources");
  const [url, setUrl] = useState("");
  const [competitorName, setCompetitorName] = useState("");
  const [variantId, setVariantId] = useState("");
  const [selector, setSelector] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(720);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function add() {
    setMsg(null);
    setNotice(null);
    try {
      new URL(url);
    } catch {
      return setMsg("Enter a full URL, starting with https://");
    }
    if (!competitorName.trim()) return setMsg("Enter the competitor's name.");
    if (!/^[0-9a-f-]{36}$/i.test(variantId.trim())) {
      return setMsg("Enter the product variant ID. It's a 36-character code, shown at the end of the product's Pricing page address.");
    }
    setBusy(true);
    try {
      // The server runs the robots.txt compliance check and may register the source as manual-only.
      const r = await request<{ message: string }>("/scraping/sources", {
        method: "POST",
        body: JSON.stringify({
          url,
          competitorName: competitorName.trim(),
          productVariantId: variantId.trim(),
          priceSelector: selector.trim() || undefined,
          scrapeIntervalMinutes: intervalMinutes,
        }),
      });
      setNotice(r.message);
      setUrl("");
      setCompetitorName("");
      setVariantId("");
      setSelector("");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function checkNow(s: Source) {
    setMsg(null);
    setNotice(null);
    setChecking(s.id);
    try {
      const r = await request<{ extracted: { priceCents: number | null; currency?: string }; validationFlag: string }>(
        `/scraping/sources/${s.id}/run`,
        { method: "POST" }
      );
      if (r.extracted.priceCents == null) {
        setNotice("The check ran but found no price. Check the price selector.");
      } else {
        const flag = r.validationFlag && r.validationFlag !== "ok" ? ` (flagged: ${r.validationFlag})` : "";
        setNotice(`Price found: ${money(r.extracted.priceCents, r.extracted.currency ?? s.latest_currency)}${flag}`);
      }
      reload();
    } catch (e) {
      setMsg((e as Error).message);
      reload();
    } finally {
      setChecking(null);
    }
  }

  async function enterPrice(s: Source) {
    const v = window.prompt(`Enter ${s.competitor_name}'s current price for ${s.product_name}`);
    if (!v) return;
    const cents = Math.round(parseFloat(v.replace(/[^0-9.]/g, "")) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return setMsg("Enter a price greater than zero, like 19.99.");
    setMsg(null);
    try {
      await request("/scraping/manual-entry", {
        method: "POST",
        body: JSON.stringify({
          competitorProductId: s.competitor_product_id,
          priceCents: cents,
          currency: s.latest_currency || "USD",
        }),
      });
      setNotice("Price saved and labelled as manually entered.");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const status = (s: Source) => {
    if (s.compliance_status !== "automated_allowed") return <span className="mv-badge">Manual entry only</span>;
    if (s.last_status === "failed") return <span className="mv-badge warn">Last check failed</span>;
    if (s.last_status === "ok") return <span className="mv-badge">Working</span>;
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
        <div className="mv-field">
          <label htmlFor="cs-url">Competitor page URL</label>
          <input id="cs-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </div>
        <div className="mv-field">
          <label htmlFor="cs-name">Competitor name</label>
          <input id="cs-name" value={competitorName} onChange={(e) => setCompetitorName(e.target.value)} />
        </div>
        <div className="mv-field">
          <label htmlFor="cs-var">Product variant ID</label>
          <input id="cs-var" value={variantId} onChange={(e) => setVariantId(e.target.value)} />
        </div>
        <div className="mv-field">
          <label htmlFor="cs-sel">Price selector (optional)</label>
          <input id="cs-sel" value={selector} onChange={(e) => setSelector(e.target.value)} placeholder="p.price_color" />
        </div>
        <div className="mv-field">
          <label htmlFor="cs-int">Check every</label>
          <select id="cs-int" value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
            {INTERVALS.map((i) => (
              <option key={i.minutes} value={i.minutes}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
        <button className="mv-btn" onClick={add} disabled={busy}>
          Add source
        </button>
      </div>

      {msg && (
        <p className="mv-error" role="alert">
          {msg}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}

      <StateView
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={!data || data.length === 0}
        emptyTitle="No tracked competitors yet"
        emptyHint="Add a competitor page above to start comparing prices."
      >
        <div className="mv-table-wrap">
          <table className="mv-table">
            <thead>
              <tr>
                <th>Competitor</th>
                <th>Product</th>
                <th>Latest price</th>
                <th>Every</th>
                <th>Last checked</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((s) => {
                const manual = s.compliance_status !== "automated_allowed";
                return (
                  <tr key={s.id}>
                    <td>
                      {s.competitor_name}
                      <br />
                      <small style={{ wordBreak: "break-all" }}>{s.url}</small>
                    </td>
                    <td>
                      {s.product_name}
                      <br />
                      <small>{s.sku}</small>
                    </td>
                    <td>
                      {s.latest_price_cents == null ? "None yet" : money(s.latest_price_cents, s.latest_currency)}
                      {s.validation_flag && s.validation_flag !== "ok" && (
                        <>
                          {" "}
                          <span className="mv-badge warn">Needs review</span>
                        </>
                      )}
                      {s.latest_observed_at && (
                        <>
                          <br />
                          <small>{new Date(s.latest_observed_at).toLocaleString()}</small>
                        </>
                      )}
                    </td>
                    <td>{s.scrape_interval_minutes >= 60 ? `${s.scrape_interval_minutes / 60}h` : `${s.scrape_interval_minutes}m`}</td>
                    <td>{s.last_checked_at ? new Date(s.last_checked_at).toLocaleString() : "Never"}</td>
                    <td>{status(s)}</td>
                    <td>
                      {manual ? (
                        <button className="mv-btn secondary" onClick={() => enterPrice(s)}>
                          Enter price
                        </button>
                      ) : (
                        <button className="mv-btn secondary" onClick={() => checkNow(s)} disabled={checking === s.id}>
                          {checking === s.id ? "Checking..." : "Check now"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </StateView>
    </div>
  );
}
