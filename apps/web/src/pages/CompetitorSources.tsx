import { useMemo, useState } from "react";
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
  last_status: "ok" | "failed" | "pending" | null;
  last_failure_reason: string | null;
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

// One row per location from GET /api/inventory/levels, so dedupe by variant
type Level = { variant_id: string; sku: string; product_name: string };

// Shape from GET /api/scraper/jobs/:id
type Job = {
  status: "queued" | "running" | "succeeded" | "failed";
  priceCents: number | null;
  currency: string | null;
  failureReason: string | null;
};

const INTERVALS = [
  { minutes: 60, label: "1 hour" },
  { minutes: 360, label: "6 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "24 hours" },
];

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "NZD", "KES", "INR", "JPY"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function money(cents: number, currency: string | null) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/** Polls a queued run until it finishes. Gives up after about a minute. */
async function waitForJob(jobId: string): Promise<Job> {
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const job = await request<Job>(`/scraper/jobs/${jobId}`);
    if (job.status === "succeeded" || job.status === "failed") return job;
  }
  throw new Error("The check is still running. Refresh the page in a minute to see the result.");
}

export default function CompetitorSources() {
  const { data, error, loading, reload } = useApi<Source[]>("/scraping/sources");
  const levels = useApi<Level[]>("/inventory/levels");

  const [url, setUrl] = useState("");
  const [competitorName, setCompetitorName] = useState("");
  const [skuPick, setSkuPick] = useState("");
  const [selector, setSelector] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(720);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Manual price modal (replaces window.prompt)
  const [manualFor, setManualFor] = useState<Source | null>(null);
  const [manualPrice, setManualPrice] = useState("");
  const [manualCurrency, setManualCurrency] = useState("USD");
  const [manualErr, setManualErr] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  const products = useMemo(() => {
    const seen = new Map<string, Level>();
    for (const l of levels.data ?? []) if (!seen.has(l.variant_id)) seen.set(l.variant_id, l);
    return [...seen.values()];
  }, [levels.data]);
  const label = (p: Level) => `${p.sku} — ${p.product_name}`;

  async function add() {
    setMsg(null);
    setNotice(null);
    try {
      new URL(url);
    } catch {
      return setMsg("Enter a full URL, starting with https://");
    }
    if (!competitorName.trim()) return setMsg("Enter the competitor's name.");
    const product = products.find((p) => label(p) === skuPick || p.sku === skuPick);
    if (!product) return setMsg("Pick a product from the list. Start typing its SKU to find it.");

    setBusy(true);
    try {
      const r = await request<{ message: string }>("/scraping/sources", {
        method: "POST",
        body: JSON.stringify({
          url,
          competitorName: competitorName.trim(),
          productVariantId: product.variant_id,
          priceSelector: selector.trim() || undefined,
          scrapeIntervalMinutes: intervalMinutes,
        }),
      });
      setNotice(r.message);
      setUrl("");
      setCompetitorName("");
      setSkuPick("");
      setSelector("");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Goes through the queue, so it gets retries, credits and failure tracking.
  async function checkNow(s: Source) {
    setMsg(null);
    setNotice(null);
    setChecking(s.id);
    try {
      const { jobId } = await request<{ jobId: string }>("/scraper/run", {
        method: "POST",
        body: JSON.stringify({ sourceId: s.id }),
      });
      const job = await waitForJob(jobId);
      if (job.status === "succeeded" && job.priceCents != null) {
        setNotice(`Price found: ${money(job.priceCents, job.currency ?? s.latest_currency)}`);
      } else {
        setMsg(job.failureReason ?? "The check finished without a price. Check the price selector.");
      }
      reload();
    } catch (e) {
      setMsg((e as Error).message);
      reload();
    } finally {
      setChecking(null);
    }
  }

  async function changeInterval(s: Source, minutes: number) {
    setMsg(null);
    try {
      await request(`/scraping/sources/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ scrapeIntervalMinutes: minutes }),
      });
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  function openManual(s: Source) {
    setManualFor(s);
    setManualPrice("");
    setManualCurrency(s.latest_currency || "USD");
    setManualErr(null);
  }

  async function saveManual() {
    if (!manualFor) return;
    const amount = Number(manualPrice);
    if (!Number.isFinite(amount) || amount <= 0) return setManualErr("Enter a price greater than zero, like 19.99.");
    setManualBusy(true);
    setManualErr(null);
    try {
      await request("/scraping/manual-entry", {
        method: "POST",
        body: JSON.stringify({
          competitorProductId: manualFor.competitor_product_id,
          priceCents: Math.round(amount * 100),
          currency: manualCurrency,
        }),
      });
      setManualFor(null);
      setNotice("Price saved and labelled as manually entered.");
      reload();
    } catch (e) {
      setManualErr((e as Error).message);
    } finally {
      setManualBusy(false);
    }
  }

  const isManual = (s: Source) => s.compliance_status !== "automated_allowed";

  const status = (s: Source) => {
    if (isManual(s)) return <span className="mv-badge">Manual entry only</span>;
    if (s.last_status === "failed") return <span className="mv-badge warn">Last check failed</span>;
    if (s.last_status === "ok") return <span className="mv-badge">Working</span>;
    return <span className="mv-badge">Not checked yet</span>;
  };

  return (
    <div className="mv-page">
      <h1>Tracked competitor sources</h1>
      <p className="mv-sub">
        Pages we check for competitor prices. We only collect the price, stock status and currency shown publicly.
        Sites that don't allow automated access switch to manual entry.
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
          <label htmlFor="cs-sku">Your product (SKU)</label>
          <input
            id="cs-sku"
            list="cs-sku-list"
            value={skuPick}
            onChange={(e) => setSkuPick(e.target.value)}
            placeholder="Start typing a SKU"
          />
          <datalist id="cs-sku-list">
            {products.map((p) => <option key={p.variant_id} value={label(p)} />)}
          </datalist>
        </div>
        <div className="mv-field">
          <label htmlFor="cs-sel">Price selector (optional)</label>
          <input id="cs-sel" value={selector} onChange={(e) => setSelector(e.target.value)} placeholder="p.price_color" />
        </div>
        <div className="mv-field">
          <label htmlFor="cs-int">Check every</label>
          <select id="cs-int" value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
            {INTERVALS.map((i) => (
              <option key={i.minutes} value={i.minutes}>{i.label}</option>
            ))}
          </select>
        </div>
        <button className="mv-btn" onClick={add} disabled={busy}>Add source</button>
      </div>

      {msg && <p className="mv-error" role="alert">{msg}</p>}
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
              {data?.map((s) => (
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
                  <td>
                    {isManual(s) ? (
                      s.scrape_interval_minutes >= 60 ? `${s.scrape_interval_minutes / 60}h` : `${s.scrape_interval_minutes}m`
                    ) : (
                      <select
                        aria-label={`Check interval for ${s.competitor_name}`}
                        value={s.scrape_interval_minutes}
                        onChange={(e) => changeInterval(s, Number(e.target.value))}
                      >
                        {INTERVALS.map((i) => <option key={i.minutes} value={i.minutes}>{i.label}</option>)}
                      </select>
                    )}
                  </td>
                  <td>{s.last_checked_at ? new Date(s.last_checked_at).toLocaleString() : "Never"}</td>
                  <td>
                    {status(s)}
                    {s.last_status === "failed" && s.last_failure_reason && (
                      <>
                        <br />
                        <small>{s.last_failure_reason}</small>
                      </>
                    )}
                  </td>
                  <td>
                    {isManual(s) ? (
                      <button className="mv-btn secondary" onClick={() => openManual(s)}>Enter price</button>
                    ) : (
                      <button
                        className="mv-btn secondary"
                        onClick={() => checkNow(s)}
                        disabled={checking === s.id}
                      >
                        {checking === s.id ? "Checking..." : "Check now"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StateView>

      {manualFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enter competitor price"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "grid",
            placeItems: "center",
            zIndex: 50,
            padding: 16,
          }}
          onClick={() => setManualFor(null)}
        >
          <div
            className="mv-card"
            style={{ maxWidth: 420, width: "100%", display: "grid", gap: 12, padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: 0 }}>Enter price</h2>
            <p className="mv-sub" style={{ margin: 0 }}>
              {manualFor.competitor_name}'s current price for {manualFor.product_name}
            </p>
            <div className="mv-field">
              <label htmlFor="mp-amount">Price</label>
              <input
                id="mp-amount"
                inputMode="decimal"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder="19.99"
                autoFocus
              />
            </div>
            <div className="mv-field">
              <label htmlFor="mp-currency">Currency</label>
              <select id="mp-currency" value={manualCurrency} onChange={(e) => setManualCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {manualErr && <p className="mv-error" role="alert">{manualErr}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="mv-btn secondary" onClick={() => setManualFor(null)} disabled={manualBusy}>
                Cancel
              </button>
              <button className="mv-btn" onClick={saveManual} disabled={manualBusy}>
                {manualBusy ? "Saving..." : "Save price"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}