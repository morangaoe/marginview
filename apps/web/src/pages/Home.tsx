import { Link } from "react-router-dom";

const FEATURES = [
  {
    icon: "📊",
    title: "Real-time competitor pricing",
    body: "Marginview crawls competitor pages automatically and flags anything out of band — so you see the market move before your margin does.",
  },
  {
    icon: "🧠",
    title: "Six pricing strategies, one click",
    body: "Cost-plus, dynamic, keystone, penetration, price skimming, value-based — preview any strategy against live data before applying.",
  },
  {
    icon: "📦",
    title: "Inventory & procurement in one place",
    body: "Reorder suggestions are generated automatically from velocity and lead time. One click turns a suggestion into a draft purchase order.",
  },
  {
    icon: "🔒",
    title: "Roles built in",
    body: "Owner, Pricing Manager, Inventory Manager, Viewer — every action is enforced server-side, not behind a hidden button.",
  },
];

const PLANS = [
  { name: "Starter", price: "$49", sources: "15 tracked sources", skus: "200 SKU soft limit" },
  { name: "Growth", price: "$199", sources: "100 tracked sources", skus: "2,000 SKU soft limit" },
  { name: "Scale", price: "Custom", sources: "Unlimited sources", skus: "Unlimited SKUs" },
];

export function Home() {
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
        <span style={{ fontWeight: 700, fontSize: 18, color: "var(--accent)" }}>Marginview</span>
        <div style={{ display: "flex", gap: 12 }}>
          <Link to="/login" className="btn" style={{ fontSize: 13 }}>Sign in</Link>
          <Link to="/signup" className="btn primary" style={{ fontSize: 13 }}>Start free trial</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: "center", padding: "80px 32px 60px" }}>
        <div style={{
          display: "inline-block",
          background: "#EAF3EC",
          color: "var(--success)",
          fontSize: 12,
          fontWeight: 600,
          padding: "4px 12px",
          borderRadius: 12,
          marginBottom: 20,
        }}>
          14-day free trial · no card required
        </div>
        <h1 style={{ fontSize: 42, fontWeight: 800, margin: "0 0 16px", lineHeight: 1.15 }}>
          Know what your competitors<br />charge. Always.
        </h1>
        <p style={{ fontSize: 17, color: "var(--slate)", maxWidth: 520, margin: "0 auto 32px", lineHeight: 1.6 }}>
          Marginview monitors competitor prices automatically, models your
          pricing strategies against live data, and surfaces the procurement
          actions that protect your margin.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/signup" className="btn primary" style={{ padding: "12px 28px", fontSize: 15 }}>
            Start free trial
          </Link>
          <Link to="/demo" className="btn" style={{ padding: "12px 28px", fontSize: 15 }}>
            See a live demo →
          </Link>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: "0 32px 80px", maxWidth: 960, margin: "0 auto" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 20,
        }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="card" style={{ padding: "24px 20px" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{f.title}</div>
              <div style={{ color: "var(--slate)", fontSize: 13, lineHeight: 1.55 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{
        background: "var(--card)",
        borderTop: "1px solid var(--hairline)",
        borderBottom: "1px solid var(--hairline)",
        padding: "60px 32px",
      }}>
        <h2 style={{ textAlign: "center", fontSize: 26, fontWeight: 700, marginBottom: 8 }}>Simple pricing</h2>
        <p style={{ textAlign: "center", color: "var(--slate)", fontSize: 14, marginBottom: 36 }}>
          Billed monthly. Seats are unlimited on every plan — pay for data, not headcount.
        </p>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 20,
          maxWidth: 720,
          margin: "0 auto",
        }}>
          {PLANS.map((p) => (
            <div key={p.name} className="card" style={{ textAlign: "center", padding: "28px 20px" }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{p.name}</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "var(--accent)", marginBottom: 4 }}>
                {p.price}
                {p.price !== "Custom" && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--slate)" }}>/mo</span>}
              </div>
              <div style={{ fontSize: 13, color: "var(--slate)", marginBottom: 6 }}>{p.sources}</div>
              <div style={{ fontSize: 13, color: "var(--slate)", marginBottom: 20 }}>{p.skus}</div>
              <Link to="/signup" className="btn primary" style={{ fontSize: 13, display: "block" }}>
                {p.price === "Custom" ? "Contact sales" : "Get started"}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ textAlign: "center", padding: "32px", fontSize: 12, color: "var(--slate)" }}>
        <div style={{ display: "flex", gap: 20, justifyContent: "center", marginBottom: 10 }}>
          <Link to="/terms" style={{ color: "var(--slate)" }}>Terms of Service</Link>
          <Link to="/privacy" style={{ color: "var(--slate)" }}>Privacy Policy</Link>
        </div>
        © {new Date().getFullYear()} Marginview. All rights reserved.
      </footer>
    </div>
  );
}
