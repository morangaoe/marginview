import { CSSProperties, FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * FIX: After login, redirect back to the page the user was trying to reach
 * (set by ProtectedRoute via location state), or fall back to /app.
 * Previously all logins unconditionally navigated to /app, losing context.
 */
export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const googleRef = useRef<HTMLDivElement>(null);
  const [emailLink, setEmailLink] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendLink() {
    setError(null);
    setNotice(null);
    if (!email) return setError("Enter your email address first.");
    setLoading(true);
    try {
      const r = await api.post<{ message: string }>("/auth/magic/request", { email });
      setNotice(r.message);
    } catch (err: any) {
      setError(cleanMessage(err.message) ?? "Couldn't send the link. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // Google button: shown only when the API has GOOGLE_CLIENT_ID set. Google returns a signed
  // ID token; the server verifies it and only signs in people who already have an account.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ googleClientId: string | null; emailLink?: boolean }>("/auth/config")
      .then(({ googleClientId, emailLink: canEmail }) => {
        if (cancelled) return;
        setEmailLink(!!canEmail);
        if (!googleClientId) return;
        const init = () => {
          const g = (window as any).google?.accounts?.id;
          if (!g || !googleRef.current) return;
          g.initialize({
            client_id: googleClientId,
            callback: async (resp: { credential: string }) => {
              setError(null);
              try {
                await api.post("/auth/google", { credential: resp.credential });
                await login();
                navigate(from, { replace: true });
              } catch (err: any) {
                setError(cleanMessage(err.message) ?? "Google sign-in failed.");
              }
            },
          });
          g.renderButton(googleRef.current, { theme: "outline", size: "large", width: 336, text: "signin_with" });
        };
        if ((window as any).google?.accounts?.id) return init();
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.onload = init;
        document.head.appendChild(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [login, navigate, from]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/login", { email, password });
      await login();
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(cleanMessage(err.message) ?? "Login failed. Check your email and password.");
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
          <div style={{ color: "var(--slate)", fontSize: 13 }}>Sign in to your account</div>
        </div>

        {error && <div style={errorBannerStyle}>{error}</div>}
        {notice && <div style={{ ...errorBannerStyle, background: "var(--card)", color: "var(--ink)", borderColor: "var(--hairline)" }}>{notice}</div>}

        <div ref={googleRef} style={{ display: "flex", justifyContent: "center", marginBottom: 4 }} />

        <form onSubmit={handleSubmit}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Email address</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              placeholder="you@company.com"
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="btn primary"
            disabled={loading}
            style={{ width: "100%", padding: "10px 0", marginTop: 8, fontSize: 14 }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
          {emailLink && (
            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={sendLink}
              style={{ width: "100%", padding: "10px 0", marginTop: 8, fontSize: 14 }}
            >
              Email me a sign-in link
            </button>
          )}
        </form>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--slate)" }}>
          Need access? Ask your workspace owner, or{" "}
          <Link to="/contact" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
            contact us
          </Link>
        </div>
      </div>
    </div>
  );
}

// api/client.ts stringifies error bodies, so a plain message can arrive wrapped in quotes.
function cleanMessage(m?: string): string | null {
  if (!m) return null;
  try {
    const v = JSON.parse(m);
    if (typeof v === "string") return v;
    if (v?.fieldErrors) return "Some fields are invalid. Check your input and try again.";
  } catch {
    /* not JSON, use as-is */
  }
  return m;
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
  maxWidth: 400,
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
  boxSizing: "border-box",
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
