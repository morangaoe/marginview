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

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <nav
        className="app-nav"
        style={{
          width: 220,
          background: "var(--card)",
          borderRight: "1px solid var(--hairline)",
          padding: "20px 0",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 18, padding: "0 20px 20px", color: "var(--accent)" }}>
          Marginview
        </div>

        {NAV_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            style={({ isActive }) => ({
              display: "block",
              padding: "10px 20px",
              textDecoration: "none",
              color: isActive ? "var(--ink)" : "var(--slate)",
              fontWeight: isActive ? 600 : 400,
              fontSize: 14,
            })}
          >
            {tab.label}
          </NavLink>
        ))}

        {/* Divider */}
        <div style={{ borderTop: "1px solid var(--hairline)", margin: "12px 0" }} />

        <NavLink
          to="/app/settings"
          style={({ isActive }) => ({
            display: "block",
            padding: "10px 20px",
            textDecoration: "none",
            color: isActive ? "var(--ink)" : "var(--slate)",
            fontWeight: isActive ? 600 : 400,
            fontSize: 14,
          })}
        >
          Settings
        </NavLink>

        {user?.role === "owner" && (
          <NavLink
            to="/app/admin"
            style={({ isActive }) => ({
              display: "block",
              padding: "10px 20px",
              textDecoration: "none",
              color: isActive ? "var(--ink)" : "var(--slate)",
              fontWeight: isActive ? 600 : 400,
              fontSize: 14,
            })}
          >
            Team & access
          </NavLink>
        )}

        {/* Spacer pushes user info to bottom */}
        <div style={{ flex: 1 }} />

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--hairline)" }}>
          <div style={{ fontSize: 12, color: "var(--slate)", marginBottom: 2 }}>
            {user?.role ?? "—"}
          </div>
          <button
            onClick={handleLogout}
            className="btn"
            style={{ fontSize: 12, width: "100%", textAlign: "left", border: "none", padding: "6px 0", color: "var(--slate)" }}
          >
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
