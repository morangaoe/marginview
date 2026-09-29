import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

const STRATEGIES: { key: string; label: string; description: string }[] = [
  { key: "cost_plus",      label: "Cost-plus",     description: "Fixed markup on unit cost" },
  { key: "value_based",    label: "Value-based",   description: "Price to perceived customer value" },
  { key: "dynamic",        label: "Dynamic",       description: "Undercut the lowest competitor" },
  { key: "keystone",       label: "Keystone",      description: "Double the unit cost (2×)" },
  { key: "penetration",    label: "Penetration",   description: "Price below market to gain share" },
  { key: "price_skimming", label: "Price skimming","description": "Start high, drop over time" },
];

interface Comparison {
  variant: {
    id: string; sku: string; unit_cost_cents: number;
    current_price_cents: number | null; currency: string;
  };
  competitors: {
    id: string; competitor_name: string; price_cents: number | null;
    observed_at: string | null; validation_flag: string | null;
  }[];
}

interface Preview {
  recommendedPriceCents: number;
  marginPct: number;
  warning: string | null;
}

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function ValidationBadge({ flag }: { flag: string | null }) {
  if (!flag || flag === "ok") return null;
  const isSpike = flag === "out_of_band";
  return (
    <span style={{
      marginLeft: 6, fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 10,
      background: isSpike ? "#FBF0E4" : "#EAEFF4",
      color: isSpike ? "var(--warning)" : "var(--info)",
    }}>
      {isSpike ? "⚠ spike" : "low confidence"}
    </span>
  );
}

function TrackForm({ variantId, onAdded }: { variantId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [selector, setSelector] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{ complianceStatus: string; message: string }>("/scraping/sources", {
        url,
        competitorName: name,
        productVariantId: variantId,
        priceSelector: selector || undefined,
        scrapeIntervalMinutes: 720,
      });
      setResult(res.message);
      setUrl(""); setName(""); setSelector("");
      onAdded();
    } catch (err: any) {
      setError(err.message ?? "Could not register source.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button className="btn" style={{ fontSize: 13 }} onClick={() => setOpen(true)}>
        + Track a competitor URL
      </button>
    );
  }

  return (
    <div style={{
      border: "1px solid var(--hairline)", borderRadius: 8, padding: 16, marginTop: 12,
      background: "var(--paper)",
    }}>
      <strong style={{ fontSize: 13 }}>Register competitor URL</strong>
      <p style={{ color: "var(--slate)", fontSize: 12, margin: "4px 0 12px" }}>
        Marginview will check robots.txt first. Automated scraping only runs when permitted.
      </p>

      {error && <div style={{ background: "#FBEAE7", color: "var(--critical)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {result && <div style={{ background: "#EAF3EC", color: "var(--success)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{result}</div>}

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Competitor name</label>
            <input required value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="Acme Shop" />
          </div>
          <div>
            <label style={labelStyle}>Product page URL</label>
            <input required type="url" value={url} onChange={e => setUrl(e.target.value)} style={inputStyle} placeholder="https://competitor.com/product" />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>CSS price selector <span style={{ color: "var(--slate)", fontWeight: 400 }}>(optional — leave blank to auto-detect)</span></label>
          <input value={selector} onChange={e => setSelector(e.target.value)} style={inputStyle} placeholder=".price, [itemprop='price'], #sale-price" />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn primary" disabled={loading} style={{ fontSize: 13 }}>
            {loading ? "Checking…" : "Register source"}
          </button>
          <button type="button" className="btn" style={{ fontSize: 13 }} onClick={() => { setOpen(false); setError(null); setResult(null); }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function Pricing() {
  const { variantId } = useParams<{ variantId: string }>();
  const [data, setData] = useState<Comparison | null>(null);
  const [strategy, setStrategy] = useState("cost_plus");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  function loadComparison() {
    if (!variantId) return;
    api
      .get<Comparison>(`/pricing/${variantId}/comparison`)
      .then(setData)
      .catch(() => setError("Could not load pricing data for this product."));
  }

  useEffect(loadComparison, [variantId]);

  useEffect(() => {
    if (!variantId) return;
    api
      .post<Preview>(`/pricing/${variantId}/preview`, { strategyType: strategy })
      .then(setPreview)
      .catch(() => {});
  }, [variantId, strategy]);

  async function apply() {
    if (!preview || !variantId) return;
    setApplyError(null);
    setApplySuccess(false);
    try {
      await api.post(`/pricing/${variantId}/apply`, {
        strategyType: strategy,
        newPriceCents: preview.recommendedPriceCents,
      });
      setApplySuccess(true);
      loadComparison();
      setTimeout(() => setApplySuccess(false), 3000);
    } catch {
      setApplyError("Could not apply this price. You may need the Pricing Manager role.");
    }
  }

  if (error) return <p style={{ color: "var(--critical)" }}>{error}</p>;
  if (!data) return <SkeletonRows rows={5} />;

  const { variant, competitors } = data;
  const lowestCompetitor = competitors
    .filter(c => c.price_cents !== null)
    .sort((a, b) => (a.price_cents ?? 0) - (b.price_cents ?? 0))[0];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <Link to="/app/pricing" style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none" }}>
          ← All products
        </Link>
      </div>

      <h1 style={{ fontSize: 22, margin: "4px 0 2px" }}>Pricing intelligence</h1>
      {/* Market snapshot */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <strong>Current price vs. tracked competitors</strong>
          <TrackForm variantId={variantId!} onAdded={loadComparison} />
        </div>

        {competitors.length === 0 && (
          <p style={{ color: "var(--slate)", fontSize: 13 }}>
            No competitors tracked yet — click "Track a competitor URL" to add one.
          </p>
        )}

        {(competitors.length > 0 || variant.current_price_cents !== null) && (
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Price</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Your price</strong></td>
                <td>
                  <strong>
                    {variant.current_price_cents != null
                      ? money(variant.current_price_cents, variant.currency)
                      : <span style={{ color: "var(--slate)" }}>Not set</span>}
                  </strong>
                </td>
                <td style={{ color: "var(--slate)", fontSize: 12 }}>—</td>
              </tr>
              {competitors.map((c) => (
                <tr key={c.id}>
                  <td>{c.competitor_name}</td>
                  <td>
                    {c.price_cents != null
                      ? <>{money(c.price_cents)}<ValidationBadge flag={c.validation_flag} /></>
                      : <span style={{ color: "var(--slate)" }}>No data yet</span>}
                  </td>
                  <td style={{ color: "var(--slate)", fontSize: 12 }}>
                    {c.observed_at ? new Date(c.observed_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {lowestCompetitor && variant.current_price_cents != null && (
          <div style={{
            marginTop: 14, padding: "10px 14px", background: "var(--paper)",
            borderRadius: 6, fontSize: 13, color: "var(--slate)",
          }}>
            {variant.current_price_cents > (lowestCompetitor.price_cents ?? 0)
              ? `⚠ You're priced ${money(variant.current_price_cents - (lowestCompetitor.price_cents ?? 0))} above the cheapest tracked competitor (${lowestCompetitor.competitor_name}).`
              : `✓ You're the lowest tracked price — ${money((lowestCompetitor.price_cents ?? 0) - variant.current_price_cents)} below ${lowestCompetitor.competitor_name}.`}
          </div>
        )}
      </div>

      {/* Strategy picker */}
      <div className="card">
        <strong>Pricing strategy</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0 8px" }}>
          {STRATEGIES.map((s) => (
            <button
              key={s.key}
              className={`btn ${strategy === s.key ? "active" : ""}`}
              style={{ fontSize: 12 }}
              onClick={() => setStrategy(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <p style={{ color: "var(--slate)", fontSize: 12, marginBottom: 16 }}>
          {STRATEGIES.find(s => s.key === strategy)?.description}
        </p>

        {preview ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 12 }}>
              <div>
                <div style={{ color: "var(--slate)", fontSize: 12 }}>Recommended price</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: "var(--accent)" }}>
                  {money(preview.recommendedPriceCents, variant.currency)}
                </div>
              </div>
              <div>
                <div style={{ color: "var(--slate)", fontSize: 12 }}>Resulting margin</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{preview.marginPct}%</div>
              </div>
              <div>
                <div style={{ color: "var(--slate)", fontSize: 12 }}>vs. current price</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>
                  {variant.current_price_cents != null
                    ? (() => {
                        const diff = preview.recommendedPriceCents - variant.current_price_cents;
                        return (
                          <span style={{ color: diff > 0 ? "var(--success)" : diff < 0 ? "var(--critical)" : "var(--ink)" }}>
                            {diff > 0 ? "+" : ""}{money(diff, variant.currency)}
                          </span>
                        );
                      })()
                    : <span style={{ color: "var(--slate)", fontSize: 15 }}>No current price</span>}
                </div>
              </div>
            </div>

            {preview.warning && (
              <p style={{ color: "var(--warning)", fontSize: 13, margin: "0 0 12px" }}>
                ⚠ {preview.warning}
              </p>
            )}

            {applyError && (
              <p style={{ color: "var(--critical)", fontSize: 13, margin: "0 0 12px" }}>{applyError}</p>
            )}
            {applySuccess && (
              <p style={{ color: "var(--success)", fontSize: 13, margin: "0 0 12px" }}>
                ✓ Price updated to {money(preview.recommendedPriceCents, variant.currency)}.
              </p>
            )}

            <button className="btn primary" onClick={apply} style={{ fontSize: 13 }}>
              Apply {money(preview.recommendedPriceCents, variant.currency)} →
            </button>
          </>
        ) : (
          <p style={{ color: "var(--slate)", fontSize: 13 }}>Computing preview…</p>
        )}
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 };
const inputStyle: CSSProperties = {
  width: "100%", border: "1px solid var(--hairline)", borderRadius: 6,
  padding: "7px 9px", fontSize: 13, background: "var(--card)", color: "var(--ink)",
};
