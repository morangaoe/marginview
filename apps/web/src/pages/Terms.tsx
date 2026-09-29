import { Link } from "react-router-dom";

export function Terms() {
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px" }}>
      <Link to="/" style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none" }}>
        ← Back to Marginview
      </Link>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "24px 0 8px" }}>Terms of Service</h1>
      <p style={{ color: "var(--slate)", fontSize: 13, marginBottom: 32 }}>Version 1 · Effective date: placeholder — replace before launch</p>

      <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ink)" }}>
        <p style={{ background: "#FBF0E4", border: "1px solid var(--warning)", borderRadius: 6, padding: "12px 14px", color: "var(--warning)", fontSize: 13 }}>
          <strong>Placeholder content.</strong> This page is a scaffold. Replace with your actual
          Terms of Service before onboarding real users. Acceptance of the Terms is recorded
          in the <code>organizations.tos_accepted_at</code> column at signup.
        </p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>1. Acceptance</h2>
        <p>By creating an account you agree to these terms on behalf of your organization.</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>2. Permitted use</h2>
        <p>Marginview is a business intelligence tool. You are responsible for ensuring that any
        web scraping performed via Marginview complies with the terms of the sites being monitored.
        Marginview checks robots.txt before scheduling automated requests and will mark any source
        as "manual only" when automated access is not permitted.</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>3. Data and privacy</h2>
        <p>See the <Link to="/privacy" style={{ color: "var(--accent)" }}>Privacy Policy</Link> for
        details on how your data is stored and processed.</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>4. Limitation of liability</h2>
        <p>Marginview is provided "as is". Pricing recommendations are data-driven estimates and
        are not financial advice. You retain responsibility for all pricing decisions.</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>5. Changes</h2>
        <p>We will notify account owners before making material changes to these terms.</p>
      </div>
    </div>
  );
}
