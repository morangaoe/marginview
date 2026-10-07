import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { AiAssistant } from "../components/AiAssistant";
import { useAuth } from "../auth/AuthContext";
import { usePlanAccess } from "../plan/PlanContext";
import { minTierFor, TIER_NAME, type ModuleKey } from "../plan/plans";

const NAV_TABS: { to: string; label: string; module: ModuleKey; end?: boolean }[] = [
  { to: "/app", label: "Dashboard", module: "dashboard", end: true },
  { to: "/app/inventory", label: "Inventory", module: "inventory" },
  { to: "/app/pricing", label: "Pricing", module: "pricing" },
  { to: "/app/competitors", label: "Competitors", module: "pricing" },
  { to: "/app/procurement", label: "Procurement", module: "procurement" },
  { to: "/app/billing", label: "Billing", module: "billing" },
];

export function AppShell() {
  const { user, me, logout } = useAuth();
  const { can, loading, effectiveTier } = usePlanAccess();
  const navigate = useNavigate();
  const isLocked = (module: ModuleKey) => !loading && !can(module);

  return (
    <div className="mv-app" style={{ display: "flex" }}>
      <div className="mv-bg" aria-hidden />
      <nav className="app-nav" style={{ width: 220, borderRight: "1px solid var(--hairline)", padding: "20px 0", flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <div className="mv-logo" style={{ padding: "0 24px 20px" }}><i />Marginview</div>

        {NAV_TABS.map((tab) => {
          const locked = isLocked(tab.module);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={"end" in tab ? tab.end : undefined}
              className="mv-nav-item"
              title={locked ? `Requires ${TIER_NAME[minTierFor(tab.module)]}` : undefined}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", opacity: locked ? 0.65 : 1 }}
            >
              <span>{tab.label}</span>
              {locked && <span className="material-symbols-rounded" role="img" aria-label="Requires upgrade" style={{ fontSize: 15 }}>lock</span>}
            </NavLink>
          );
        })}

        <div style={{ borderTop: "1px solid var(--hairline)", margin: "12px 0" }} />
        <NavLink to="/app/settings" className="mv-nav-item">Settings</NavLink>
        {user?.role === "owner" && <NavLink to="/app/admin" className="mv-nav-item">Team & access</NavLink>}
        {me?.isPlatformAdmin && <NavLink to="/app/platform" className="mv-nav-item">Platform admin</NavLink>}

        <div style={{ flex: 1 }} />
        <div style={{ padding: "12px 24px", borderTop: "1px solid var(--hairline)" }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--slate)" }}>
            {user?.role ?? "—"}{effectiveTier ? ` · ${effectiveTier.replace(/_/g, " ")}` : ""}
          </div>
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
