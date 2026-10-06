import { Link, Outlet } from "react-router-dom";
import { SkeletonRows } from "../components/Skeleton";
import { usePlanAccess } from "./PlanContext";
import { minTierFor, TIER_NAME, type ModuleKey } from "./plans";

const COPY: Partial<Record<ModuleKey, { title: string; body: string }>> = {
  inventory: {
    title: "Inventory management",
    body: "Track stock levels, capacity and reorder points, and import your catalog by CSV.",
  },
  procurement: {
    title: "Procurement",
    body: "Get restock alerts, opportunity buys and overstock warnings, and turn them into purchase orders.",
  },
  integrations: {
    title: "Enterprise integrations",
    body: "Request custom ERP connectors and tailored data pipelines.",
  },
};

export function UpgradePrompt({ module }: { module: ModuleKey }) {
  const required = minTierFor(module);
  const copy = COPY[module];
  const enterprise = required === "enterprise";
  return (
    <div className="card" style={{ maxWidth: 560, margin: "48px auto", textAlign: "center", padding: 32 }} role="status">
      <span className="material-symbols-rounded" aria-hidden="true" style={{ color: "var(--warning)", fontSize: 28 }}>lock</span>
      <h1 style={{ fontSize: 22, margin: "8px 0" }}>
        {enterprise ? `${TIER_NAME[required]} feature` : `Upgrade to ${TIER_NAME[required]}`}
      </h1>
      <p style={{ color: "var(--slate)" }}>
        {copy?.title ?? "This module"} isn't included in your current plan. {copy?.body}
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
        <Link to="/app/billing" className="btn primary">{enterprise ? "See plans" : `Upgrade to ${TIER_NAME[required]}`}</Link>
        <Link to="/app" className="btn">Back to dashboard</Link>
      </div>
    </div>
  );
}

export function RequireModule({ module }: { module: ModuleKey }) {
  const { can, loading } = usePlanAccess();
  if (loading) return <SkeletonRows rows={5} />;
  return can(module) ? <Outlet /> : <UpgradePrompt module={module} />;
}
