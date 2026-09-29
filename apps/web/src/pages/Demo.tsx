import { useState } from "react";
import { Link } from "react-router-dom";
import { StatusPill } from "../components/StatusPill";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

const DEMO_PRODUCTS = [
  {
    sku: "ESPRESSO-500G",
    name: "Single-Origin Espresso Blend 500g",
    unitCostCents: 1200,
    currentPriceCents: 2999,
    competitors: [
      { name: "RoasterDirect", priceCents: 3199, ago: "2h ago", flag: "ok" },
      { name: "CoffeeCo", priceCents: 2749, ago: "45m ago", flag: "out_of_band" },
      { name: "BeanMarket", priceCents: 3099, ago: "1h ago", flag: "ok" },
    ],
    inventoryStatus: "low",
    onHand: 12,
    reorderPoint: 20,
  },
  {
    sku: "GRINDER-PRO",
    name: "Professional Burr Grinder",
    unitCostCents: 8900,
    currentPriceCents: 19999,
    competitors: [
      { name: "KitchenDirect", priceCents: 18999, ago: "3h ago", flag: "ok" },
      { name: "ApplianceHub", priceCents: 21500, ago: "6h ago", flag: "ok" },
    ],
    inventoryStatus: "healthy",
    onHand: 45,
    reorderPoint: 10,
  },
  {
    sku: "FILTER-CONE-V60",
    name: "V60 Pour-Over Filter Cone",
    unitCostCents: 400,
    currentPriceCents: 1499,
    competitors: [
      { name: "BrewSupply", priceCents: 1299, ago: "1h ago", flag: "ok" },
      { name: "CoffeeCo", priceCents: 1599, ago: "2h ago", flag: "ok" },
    ],
    inventoryStatus: "out_of_stock",
    onHand: 0,
    reorderPoint: 30,
  },
];

const STRATEGIES = ["cost_plus", "value_based", "dynamic", "keystone"];

function computeDemoPrice(strategy: string, unitCostCents: number, competitors: { priceCents: number }[]) {
  const avgCompetitor = competitors.reduce((s, c) => s + c.priceCents, 0) / competitors.length;
  switch (strategy) {
    case "cost_plus": return Math.round(unitCostCents * 2.5);
    case "keystone": return unitCostCents * 2;
    case "value_based": return Math.round(avgCompetitor * 1.05);
    case "dynamic": return Math.round(Math.min(avgCompetitor * 0.97, unitCostCents * 3));
    default: return Math.round(unitCostCents * 2.5);
  }
}

export function Demo() {
  const [selectedProduct, setSelectedProduct] = useState(0);
  const [strategy, setStrategy] = useState("cost_plus");

  const product = DEMO_PRODUCTS[selectedProduct];
  const suggestedPrice = computeDemoPrice(strategy, product.unitCostCents, product.competitors);
  const margin = ((suggestedPrice - product.unitCostCents) / suggestedPrice * 100).toFixed(1);

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)" }}>
      {/* Nav */}
      <nav style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 32px",
        borderBottom: "1px solid var(--hairline)",
        background: "var(--card)",
      }}>
        <Link to="/" style={{ fontWeight: 700, fontSize: 18, color: "var(--accent)", textDecoration: "none" }}>
          Marginview
        </Link>
        <div style={{ display: "flex", gap: 12 }}>
          <Link to="/login" className="btn" style={{ fontSize: 13 }}>Sign in</Link>
          <Link to="/signup" className="btn primary" style={{ fontSize: 13 }}>Start free trial</Link>
        </div>
      </nav>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{
            display: "inline-block",
            background: "#EAF3EC",
            color: "var(--success)",
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            borderRadius: 12,
            marginBottom: 12,
          }}>
            Interactive demo — no account needed
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>See how Marginview works</h1>
          <p style={{ color: "var(--slate)", fontSize: 14, margin: 0 }}>
            Explore pricing intelligence with sample products. All data shown is fictional.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
          {/* Product list */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--slate)", textTransform: "uppercase", marginBottom: 10 }}>
              Products
            </div>
            {DEMO_PRODUCTS.map((p, i) => (
              <button
                key={p.sku}
                className={`btn ${selectedProduct === i ? "active" : ""}`}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 8,
                  padding: "10px 12px",
                }}
                onClick={() => setSelectedProduct(i)}
              >
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{p.sku}</div>
                <div style={{ fontSize: 11, color: selectedProduct === i ? "rgba(255,255,255,0.8)" : "var(--slate)" }}>
                  {money(p.currentPriceCents)} · <StatusPill status={p.inventoryStatus} />
                </div>
              </button>
            ))}

            {/* Inventory snapshot */}
            <div className="card" style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--slate)", textTransform: "uppercase", marginBottom: 10 }}>
                Inventory
              </div>
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                On hand: <strong>{product.onHand}</strong>
              </div>
              <div style={{ fontSize: 13, color: "var(--slate)" }}>
                Reorder point: {product.reorderPoint}
              </div>
              {product.onHand <= product.reorderPoint && (
                <div style={{ marginTop: 10, padding: "6px 10px", background: "#FBF0E4", borderRadius: 6, fontSize: 12, color: "var(--warning)" }}>
                  ⚠ Reorder suggested
                </div>
              )}
            </div>
          </div>

          {/* Main panel */}
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{product.name}</div>
                  <div style={{ color: "var(--slate)", fontSize: 13, marginTop: 2 }}>
                    SKU: {product.sku} · Unit cost: {money(product.unitCostCents)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "var(--slate)" }}>Current price</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{money(product.currentPriceCents)}</div>
                </div>
              </div>

              <strong style={{ fontSize: 12, textTransform: "uppercase", color: "var(--slate)" }}>
                Tracked competitors
              </strong>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Competitor</th>
                    <th>Price</th>
                    <th>Last checked</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {product.competitors.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td>{money(c.priceCents)}</td>
                      <td style={{ color: "var(--slate)", fontSize: 12 }}>{c.ago}</td>
                      <td>
                        {c.flag === "out_of_band" ? (
                          <span style={{ fontSize: 11, background: "#FBF0E4", color: "var(--warning)", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                            Price spike
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, background: "#EAF3EC", color: "var(--success)", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>
                            Normal
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Strategy picker */}
            <div className="card">
              <strong style={{ fontSize: 12, textTransform: "uppercase", color: "var(--slate)" }}>
                Pricing strategy
              </strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
                {STRATEGIES.map((s) => (
                  <button
                    key={s}
                    className={`btn ${strategy === s ? "active" : ""}`}
                    style={{ fontSize: 12 }}
                    onClick={() => setStrategy(s)}
                  >
                    {s.replace("_", "-")}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 4 }}>
                <div>
                  <div style={{ color: "var(--slate)", fontSize: 12 }}>Suggested price</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)" }}>{money(suggestedPrice)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--slate)", fontSize: 12 }}>Resulting margin</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>{margin}%</div>
                </div>
              </div>

              <div style={{
                marginTop: 16,
                padding: "10px 14px",
                background: "var(--paper)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--slate)",
              }}>
                💡 This is a demo. In your account, clicking Apply price writes to the price change
                log with the actor, old price, and new price, and requires the Pricing Manager role.
              </div>

              <div style={{ marginTop: 12 }}>
                <Link to="/signup" className="btn primary" style={{ fontSize: 13 }}>
                  Apply prices in your account →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
