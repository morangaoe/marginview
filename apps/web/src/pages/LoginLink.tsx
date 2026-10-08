import { CSSProperties, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Landing page for the emailed sign-in link. The token sits in the URL fragment (never sent to
 * any server) and is exchanged only when the person clicks, so email scanners that pre-open
 * links can't use it up.
 */
export function LoginLink() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("t");

  async function go() {
    setBusy(true);
    setError(null);
    try {
      // Remove the token from the address bar before anything else can read or copy it.
      window.history.replaceState(null, "", window.location.pathname);
      await api.post("/auth/magic/verify", { token });
      await login();
      navigate("/app", { replace: true });
    } catch (e: any) {
      setError(e.message || "This sign-in link is invalid or has expired.");
      setBusy(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)", marginBottom: 12 }}>Marginview</div>
        {error || !token ? (
          <>
            <p style={{ color: "var(--critical)", fontSize: 14 }}>{error ?? "This sign-in link is invalid or has expired."}</p>
            <Link to="/login" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p style={{ color: "var(--slate)", fontSize: 14, marginBottom: 16 }}>Ready to sign in.</p>
            <button className="btn primary" disabled={busy} onClick={go} style={{ width: "100%", padding: "10px 0", fontSize: 14 }}>
              {busy ? "Signing in…" : "Continue to Marginview"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper)", padding: 16 };
const cardStyle: CSSProperties = { background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: "36px 32px", width: "100%", maxWidth: 400, textAlign: "center" };
