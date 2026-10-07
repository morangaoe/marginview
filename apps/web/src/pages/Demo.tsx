import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FreeMarketSearch } from "../components/FreeMarketSearch";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
// The demo runs the production pricing engine, so what it shows is what the app computes.
import { computeBlend, computeStrategy, marginFor, median, type WeightKey } from "../../../api/src/services/pricingStrategies";

const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

const PRODUCTS = [
  { sku: "ESPRESSO-500G", name: "Single-Origin Espresso Blend 500g", cost: 1200, price: 2999, onHand: 12, reorder: 20,
    comps: [["RoasterDirect", 3199, "2h ago"], ["CoffeeCo", 2749, "45m ago"], ["BeanMarket", 3099, "1h ago"]] },
  { sku: "GRINDER-PRO", name: "Professional Burr Grinder", cost: 8900, price: 19999, onHand: 45, reorder: 10,
    comps: [["KitchenDirect", 18999, "3h ago"], ["ApplianceHub", 21500, "6h ago"]] },
  { sku: "FILTER-CONE-V60", name: "V60 Pour-Over Filter Cone", cost: 400, price: 1499, onHand: 0, reorder: 30,
    comps: [["BrewSupply", 1299, "1h ago"], ["CoffeeCo", 1599, "2h ago"]] },
] as const;

type Option = WeightKey | "blended";
const OPTIONS: { key: Option; label: string }[] = [
  { key: "cost_plus", label: "cost-plus" }, { key: "value_based", label: "value-based" },
  { key: "dynamic", label: "dynamic" }, { key: "keystone", label: "keystone" }, { key: "blended", label: "blended" },
];

const stockStatus = (onHand: number, reorder: number) => (onHand <= 0 ? "out_of_stock" : onHand <= reorder ? "low" : "healthy");

/** Same parameter defaults as POST /api/pricing/:variantId/optimized. */
function priceFor(option: Option, cost: number, comps: number[]) {
  if (option === "blended") {
    const b = computeBlend(cost, comps);
    return { price: b.priceCents, warning: b.notes[0] ?? null };
  }
  const parameters = {
    cost_plus: { targetMarginPct: 40 },
    value_based: { perceivedValueCents: Math.round(cost * 2.6) },
    keystone: {},
    dynamic: { positionPct: 0, minMarginPct: 10 },
  }[option] as Record<string, number>;
  const r = computeStrategy(option, { unitCostCents: cost, competitorPricesCents: comps, currentPriceCents: null, parameters });
  return { price: r.recommendedPriceCents, warning: r.warning };
}

function DemoVideo() {
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  return (
    <div className="mv-video">
      <video
        controls playsInline preload="metadata" poster="/demo/poster.jpg"
        onLoadedData={() => setState("ready")} onError={() => setState("missing")}
        style={{ visibility: state === "ready" ? "visible" : "hidden" }}
      >
        <source src="/demo/marginview-demo.webm" type="video/webm" />
        <source src="/demo/marginview-demo.mp4" type="video/mp4" />
      </video>
      {state === "loading" && <span className="sk" role="status" aria-label="Loading video" />}
      {state === "missing" && <div className="empty">Add your recording at public/demo/marginview-demo.mp4</div>}
    </div>
  );
}

export function Demo() {
  const [i, setI] = useState(0);
  const [option, setOption] = useState<Option>("cost_plus");
  const [busy, setBusy] = useState(false);
  const p = PRODUCTS[i];

  useEffect(() => {
    setBusy(true);
    const t = setTimeout(() => setBusy(false), 350);
    return () => clearTimeout(t);
  }, [i, option]);

  const compPrices = useMemo(() => p.comps.map((c) => c[1]), [p]);
  const med = median(compPrices)!;
  const { price, warning } = priceFor(option, p.cost, compPrices);
  const margin = marginFor(price, p.cost);

  return (
    <main className="mv-wrap mv-demo">
      <h1>See how Marginview works</h1>
      <DemoVideo />

      <div className="mv-demo-grid">
        <aside className="mv-side">
          {PRODUCTS.map((x, n) => (
            <button key={x.sku} className={`btn ${i === n ? "active" : ""}`} onClick={() => setI(n)}>
              <span className="mono" style={{ fontSize: 12 }}>{x.sku}</span>
              <span style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                {money(x.price)} {i === n ? null : <StatusPill status={stockStatus(x.onHand, x.reorder)} />}
              </span>
            </button>
          ))}
          <div className="card" style={{ marginTop: 8, fontSize: 13, background: "var(--card)" }}>
            <div>On hand <strong>{p.onHand}</strong></div>
            {p.onHand <= p.reorder && <div className="pill warn" style={{ marginTop: 10 }}>Reorder suggested</div>}
          </div>
        </aside>

        <section style={{ display: "grid", gap: 16 }}>
          <div className="card" style={{ background: "var(--card)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{p.name}</div>
                <div className="mono" style={{ color: "var(--slate)", fontSize: 12, marginTop: 2 }}>
                  {p.sku}, cost {money(p.cost)}, today {marginFor(p.price, p.cost)}% margin
                </div>
              </div>
              <div className="mv-stat">{money(p.price)}</div>
            </div>
            <table>
              <thead><tr><th>Competitor</th><th>Price</th><th>Checked</th><th>vs median</th></tr></thead>
              <tbody>
                {p.comps.map(([n, c, ago]) => {
                  const diff = Math.round(((c - med) / med) * 100);
                  return (
                    <tr key={n}>
                      <td>{n}</td><td className="mono">{money(c)}</td>
                      <td style={{ color: "var(--slate)", fontSize: 12 }}>{ago}</td>
                      <td><span className={`pill ${Math.abs(diff) >= 10 ? "warn" : "ok"}`}>{diff > 0 ? "+" : ""}{diff}%</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ color: "var(--slate)", fontSize: 12, marginTop: 8 }}>Market median {money(med)}</div>
          </div>

          <div className="card" style={{ background: "var(--card)" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {OPTIONS.map((o) => (
                <button key={o.key} className={`btn ${option === o.key ? "active" : ""}`} style={{ fontSize: 12 }} onClick={() => setOption(o.key)}>
                  {o.label}
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} aria-busy={busy}>
              <div>
                <div style={{ color: "var(--slate)", fontSize: 12, marginBottom: 6 }}>Suggested price</div>
                {busy ? <Skeleton w={110} h={34} /> : <div className="mv-stat up">{money(price)}</div>}
              </div>
              <div>
                <div style={{ color: "var(--slate)", fontSize: 12, marginBottom: 6 }}>Resulting margin</div>
                {busy ? <Skeleton w={80} h={34} /> : <div className="mv-stat">{margin}%</div>}
              </div>
            </div>
            {!busy && warning && <div className="pill warn" style={{ marginTop: 14, whiteSpace: "normal" }}>{warning}</div>}
            <div style={{ marginTop: 24 }}><Link to="/signup" className="btn primary">Apply prices in your account</Link></div>
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gap: 20, marginTop: 40 }}>
        <FreeMarketSearch />
        <div className="card" style={{ background: "var(--card)", display: "flex", gap: 16, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Free price audit</div>
            <div style={{ color: "var(--slate)", fontSize: 13 }}>Upload your product CSV and see which SKUs are under-earning, in seconds.</div>
          </div>
          <Link to="/audit" className="btn primary">Audit my prices</Link>
        </div>
      </div>
    </main>
  );
}
