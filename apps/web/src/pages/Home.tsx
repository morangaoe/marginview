import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "../components/Skeleton";

const TICKER = [
  ["ACME Corp", -3.2], ["BlueLine Supply", 1.8], ["CrestWholesale", -0.6], ["Delta Goods", 4.1],
  ["Eastern Trade", -1.1], ["Fairway Dist", 2.7], ["Granite Parts", -0.3], ["HorizonB2B", 5.2],
] as const;

const FEATURES = [
  { title: "Real-time competitor pricing", body: "Out-of-band prices are flagged before your margin feels them." },
  { title: "Six pricing strategies, one click", body: "Preview cost-plus, dynamic, keystone and more against live data." },
  { title: "Inventory and procurement together", body: "Reorder suggestions turn into draft purchase orders in one click." },
  { title: "Roles built in", body: "Every action is enforced on the server, not behind a hidden button." },
];

const PLANS = [
  { name: "Starter", price: "$49", items: ["15 tracked sources", "200 SKU soft limit"], cta: "Get started" },
  { name: "Growth", price: "$199", items: ["100 tracked sources", "2,000 SKU soft limit"], cta: "Get started", hi: true },
  { name: "Scale", price: "Custom", items: ["Unlimited sources", "Unlimited SKUs"], cta: "Contact sales" },
];

type Row = { sku: string; yours: number; a: number; b: number; delta: number; flash?: boolean };
const SEED: Row[] = [
  { sku: "SKU-4821", yours: 24.99, a: 27.5, b: 23.4, delta: -6.3 },
  { sku: "SKU-1103", yours: 89, a: 84.95, b: 91.2, delta: 4.8 },
  { sku: "SKU-7756", yours: 12.5, a: 12.5, b: 13, delta: 0 },
  { sku: "SKU-3390", yours: 145, a: 138, b: 149.99, delta: 5.1 },
  { sku: "SKU-6614", yours: 5.99, a: 6.49, b: 5.75, delta: -4 },
];

function LiveTable() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setRows(SEED), 900); // skeleton first, then data
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!rows) return;
    const id = setInterval(() => {
      setRows((prev) => prev && prev.map((r) => {
        if (Math.random() > 0.45) return { ...r, flash: false };
        const d = +((Math.random() - 0.5) * 8).toFixed(1);
        return { ...r, delta: d, yours: Math.max(1, +(r.yours + d * 0.1).toFixed(2)), a: +(r.a + (Math.random() - 0.5) * 0.4).toFixed(2), flash: true };
      }));
    }, 2200);
    return () => clearInterval(id);
  }, [rows !== null]);

  return (
    <div className="mv-table" aria-live="off">
      <div className="mv-row head">{["SKU", "Your price", "Competitor A", "Competitor B", "Change"].map((h) => <span key={h}>{h}</span>)}</div>
      {rows
        ? rows.map((r) => (
            <div className="mv-row" key={r.sku}>
              <span style={{ color: "var(--slate)" }}>{r.sku}</span>
              <span className={r.flash ? "mv-flash" : ""}>${r.yours.toFixed(2)}</span>
              <span style={{ color: "rgba(255,255,255,.6)" }}>${r.a.toFixed(2)}</span>
              <span style={{ color: "rgba(255,255,255,.6)" }}>${r.b.toFixed(2)}</span>
              <span className={r.delta > 0.2 ? "up" : r.delta < -0.2 ? "down" : "flat"}>
                {r.delta > 0.2 ? "↑" : r.delta < -0.2 ? "↓" : "—"} {Math.abs(r.delta).toFixed(1)}%
              </span>
            </div>
          ))
        : SEED.map((r) => (
            <div className="mv-row" key={r.sku} role="status" aria-label="Loading">
              <Skeleton w={64} /><Skeleton w={48} /><Skeleton w={48} /><Skeleton w={48} /><Skeleton w={40} />
            </div>
          ))}
      <div className="mv-live"><i />Live</div>
    </div>
  );
}

export function Home() {
  return (
    <>
      <div className="mv-ticker" aria-hidden>
        <div>
          {[...TICKER, ...TICKER].map(([n, v], i) => (
            <span key={i}>{n} <b className={v > 0 ? "up" : "down"} style={{ fontWeight: 400 }}>{v > 0 ? "+" : "−"}{Math.abs(v)}%</b></span>
          ))}
        </div>
      </div>

      <main className="mv-wrap">
        <section className="mv-hero">
          <div>
            <div className="mv-badge"><i />14-day free trial, no card required</div>
            <h1>Know what your competitors charge. Always.</h1>
            <div className="mv-actions">
              <Link to="/signup" className="btn primary">Start free trial</Link>
              <Link to="/demo" className="btn">Watch the demo</Link>
            </div>
          </div>
          <LiveTable />
        </section>

        <section className="mv-section" id="features">
          <h2>Built to protect your margin</h2>
          <div className="mv-features">
            {FEATURES.map((f) => (
              <article className="mv-feature" key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mv-section" id="pricing">
          <h2>Simple pricing</h2>
          <div className="mv-plans">
            {PLANS.map((p) => (
              <div className={`mv-plan ${p.hi ? "hi" : ""}`} key={p.name}>
                {p.hi && <span className="tag">Most popular</span>}
                <h3>{p.name}</h3>
                <div className="mv-price">{p.price}{p.price !== "Custom" && <small>/mo</small>}</div>
                <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
                <Link to="/signup" className={`btn ${p.hi ? "primary" : ""}`}>{p.cta}</Link>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mv-footer">
        <div className="mv-wrap">
          <span>© {new Date().getFullYear()} Marginview</span>
          <span><Link to="/terms">Terms of Service</Link><Link to="/privacy">Privacy Policy</Link></span>
        </div>
      </footer>
    </>
  );
}
