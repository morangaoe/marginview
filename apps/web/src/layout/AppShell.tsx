import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { AiAssistant } from "../components/AiAssistant";
import { useAuth } from "../auth/AuthContext";

const NAV_TABS = [
  { to: "/app", label: "Dashboard", end: true },
  { to: "/app/inventory", label: "Inventory" },
  { to: "/app/pricing", label: "Pricing" },
  { to: "/app/procurement", label: "Procurement" },
  { to: "/app/billing", label: "Billing" },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="mv-app" style={{ display: "flex" }}>
      <div className="mv-bg" aria-hidden />
      <nav className="app-nav" style={{ width: 220, borderRight: "1px solid var(--hairline)", padding: "20px 0", flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <div className="mv-logo" style={{ padding: "0 24px 20px" }}><i />Marginview</div>

        {NAV_TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="mv-nav-item">{t.label}</NavLink>
        ))}

        <div style={{ borderTop: "1px solid var(--hairline)", margin: "12px 0" }} />
        <NavLink to="/app/settings" className="mv-nav-item">Settings</NavLink>
        {user?.role === "owner" && <NavLink to="/app/admin" className="mv-nav-item">Team & access</NavLink>}

        <div style={{ flex: 1 }} />
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--hairline)" }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--slate)" }}>{user?.role ?? "—"}</div>
          <button onClick={() => { logout(); navigate("/login"); }} className="btn" style={{ width: "100%", justifyContent: "flex-start", border: "none", background: "none", padding: "6px 0", fontSize: 12, color: "var(--slate)" }}>
            Sign out
          </button>
        </div>
      </nav>

      <main style={{ flex: 1, padding: 28, overflow: "auto" }}>
        <Outlet />
      </main>
      <AiAssistant />
    </div>
  );
}
