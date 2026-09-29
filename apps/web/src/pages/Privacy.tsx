import { Link } from "react-router-dom";

export function Privacy() {
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px" }}>
      <Link to="/" style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none" }}>
        ← Back to Marginview
      </Link>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "24px 0 8px" }}>Privacy Policy</h1>
      <p style={{ color: "var(--slate)", fontSize: 13, marginBottom: 32 }}>Version 1 · Effective date: placeholder — replace before launch</p>

      <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--ink)" }}>
        <p style={{ background: "#FBF0E4", border: "1px solid var(--warning)", borderRadius: 6, padding: "12px 14px", color: "var(--warning)", fontSize: 13 }}>
          <strong>Placeholder content.</strong> Replace with your actual Privacy Policy before
          launch. The accepted version is recorded at signup in
          <code>organizations.privacy_policy_version_accepted</code>.
        </p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>Data we collect</h2>
        <p>We collect the information you provide at signup (organization name, your name, email),
        and the product and pricing data you enter or import. We also collect competitor pricing
        data from URLs you register for scraping.</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>How we use it</h2>
        <p>Your data is used only to operate Marginview for your organization. We do not sell
        data or use it to train AI models.</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>Retention</h2>
        <p>Price snapshots are retained for 24 months. Audit logs are retained for 7 years.
        You may request deletion of your organization's data at any time by contacting support.</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>Security</h2>
        <p>Passwords are hashed with bcrypt. All data in transit uses TLS. Tokens expire after
        12 hours.</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 }}>Contact</h2>
        <p>For data or privacy questions, contact <a href="mailto:privacy@marginview.io" style={{ color: "var(--accent)" }}>privacy@marginview.io</a>.</p>
      </div>
    </div>
  );
}
