import { CSSProperties, FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function SignUp() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tosAccepted) {
      setError("You must accept the Terms of Service to create an account.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { token } = await api.post<{ token: string }>("/auth/signup", {
        organizationName: orgName,
        fullName,
        email,
        password,
        tosAccepted: true,
      });
      login(token);
      navigate("/app", { replace: true });
    } catch (err: any) {
      setError(err.message ?? "Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>
            Marginview
          </div>
          <div style={{ color: "var(--slate)", fontSize: 13 }}>
            Create your account — free 14-day trial, no card required
          </div>
        </div>

        {error && <div style={errorBannerStyle}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Company / organization name</label>
            <input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              style={inputStyle}
              placeholder="Acme Retail Inc."
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Your full name</label>
            <input
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={inputStyle}
              placeholder="Jane Smith"
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Work email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              placeholder="jane@acme.com"
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Password (min 8 characters)</label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              placeholder="Create a strong password"
            />
          </div>

          <div style={{ marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              id="tos"
              type="checkbox"
              checked={tosAccepted}
              onChange={(e) => setTosAccepted(e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <label htmlFor="tos" style={{ fontSize: 13, color: "var(--slate)", cursor: "pointer" }}>
              I agree to the{" "}
              <Link to="/terms" target="_blank" style={{ color: "var(--accent)" }}>
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy" target="_blank" style={{ color: "var(--accent)" }}>
                Privacy Policy
              </Link>
              . Acceptance is recorded against this account.
            </label>
          </div>

          <button
            type="submit"
            className="btn primary"
            disabled={loading}
            style={{ width: "100%", padding: "10px 0", fontSize: 14 }}
          >
            {loading ? "Creating account…" : "Create free account"}
          </button>
        </form>

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

const fieldStyle: CSSProperties = { marginBottom: 16 };

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 5,
  color: "var(--ink)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "9px 11px",
  fontSize: 14,
  background: "var(--paper)",
  color: "var(--ink)",
  outline: "none",
};

const errorBannerStyle: CSSProperties = {
  background: "#FBEAE7",
  color: "var(--critical)",
  border: "1px solid var(--critical)",
  borderRadius: 6,
  padding: "10px 12px",
  fontSize: 13,
  marginBottom: 16,
};
