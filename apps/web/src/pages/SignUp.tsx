import { CSSProperties } from "react";
import { Link } from "react-router-dom";

/**
 * Accounts are invite-only: a workspace owner (Team & access) or a platform admin
 * creates them. The API rejects self-service sign-up unless ALLOW_PUBLIC_SIGNUP=true.
 */
export function SignUp() {
  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>Marginview</div>
          <div style={{ color: "var(--slate)", fontSize: 13 }}>Access is by invitation</div>
        </div>

        <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 12px" }}>
          If your company already uses Marginview, ask your workspace owner to add you from{" "}
          <strong>Team &amp; access</strong>. They'll send you a password to sign in with.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 24px" }}>
          New to Marginview? Get in touch and we'll set up a workspace for you.
        </p>

        <Link to="/contact" className="btn primary" style={{ width: "100%", justifyContent: "center", padding: "10px 0", fontSize: 14 }}>
          Request access
        </Link>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--slate)" }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--paper)",
  padding: "16px",
};

const cardStyle: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  padding: "36px 32px",
  width: "100%",
  maxWidth: 440,
};
