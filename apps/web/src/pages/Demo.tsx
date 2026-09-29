import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";

const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

const PRODUCTS = [
  { sku: "ESPRESSO-500G", name: "Single-Origin Espresso Blend 500g", cost: 1200, price: 2999, status: "low", onHand: 12, reorder: 20,
    comps: [["RoasterDirect", 3199, "2h ago", false], ["CoffeeCo", 2749, "45m ago", true], ["BeanMarket", 3099, "1h ago", false]] },
  { sku: "GRINDER-PRO", name: "Professional Burr Grinder", cost: 8900, price: 19999, status: "healthy", onHand: 45, reorder: 10,
    comps: [["KitchenDirect", 18999, "3h ago", false], ["ApplianceHub", 21500, "6h ago", false]] },
  { sku: "FILTER-CONE-V60", name: "V60 Pour-Over Filter Cone", cost: 400, price: 1499, status: "out_of_stock", onHand: 0, reorder: 30,
    comps: [["BrewSupply", 1299, "1h ago", false], ["CoffeeCo", 1599, "2h ago", false]] },
] as const;

const STRATEGIES = ["cost_plus", "value_based", "dynamic", "keystone"];

function suggest(strategy: string, cost: number, comps: readonly (readonly [string, number, string, boolean])[]) {
  const avg = comps.reduce((s, c) => s + c[1], 0) / comps.length;
  switch (strategy) {
    case "keystone": return cost * 2;
    case "value_based": return Math.round(avg * 1.05);
    case "dynamic": return Math.round(Math.min(avg * 0.97, cost * 3));
    default: return Math.round(cost * 2.5);
  }
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
  const [strategy, setStrategy] = useState("cost_plus");
  const [busy, setBusy] = useState(false);
  const p = PRODUCTS[i];

  useEffect(() => {
    setBusy(true);
    const t = setTimeout(() => setBusy(false), 350);
    return () => clearTimeout(t);
  }, [i, strategy]);

  const price = suggest(strategy, p.cost, p.comps);
  const margin = (((price - p.cost) / price) * 100).toFixed(1);

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
                {money(x.price)} {i === n ? null : <StatusPill status={x.status} />}
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
                <div className="mono" style={{ color: "var(--slate)", fontSize: 12, marginTop: 2 }}>{p.sku}, cost {money(p.cost)}</div>
              </div>
              <div className="mv-stat">{money(p.price)}</div>
            </div>
            <table>
              <thead><tr><th>Competitor</th><th>Price</th><th>Checked</th><th>Status</th></tr></thead>
              <tbody>
                {p.comps.map(([n, c, ago, spike]) => (
                  <tr key={n}>
                    <td>{n}</td><td className="mono">{money(c)}</td>
                    <td style={{ color: "var(--slate)", fontSize: 12 }}>{ago}</td>
                    <td><span className={`pill ${spike ? "warn" : "ok"}`}>{spike ? "Price spike" : "Normal"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ background: "var(--card)" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {STRATEGIES.map((s) => (
                <button key={s} className={`btn ${strategy === s ? "active" : ""}`} style={{ fontSize: 12 }} onClick={() => setStrategy(s)}>
                  {s.replace("_", "-")}
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
            <div style={{ marginTop: 24 }}><Link to="/signup" className="btn primary">Apply prices in your account</Link></div>
          </div>
        </section>
      </div>
    </main>
  );
}
