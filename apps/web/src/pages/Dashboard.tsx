import { SkeletonRows } from "../components/Skeleton";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { StatusPill } from "../components/StatusPill";
import { usePlanAccess } from "../plan/PlanContext";

interface InventoryRow {
  id: string;
  variant_id: string;
  sku: string;
  product_name: string;
  status: string;
  quantity: number;
  location_name: string;
  created_at: string;
}

interface Suggestion {
  id: string;
  sku: string;
  name: string;
  location_name: string;
  suggested_quantity: number;
  reason: { daysOfCover: number | null; leadTimeDays: number };
}

interface ScrapingSource {
  id: string;
  competitor_name: string;
  product_name: string;
  last_status: string;
  validation_flag: string | null;
  latest_price_cents: number | null;
  latest_currency: string;
  latest_observed_at: string | null;
}

interface Opportunity {
  variantId: string;
  sku: string;
  name: string;
  currentPriceCents: number;
  competitorMedianCents: number;
  costCents: number;
  competitorCount: number;
  gapCents: number;
  monthlyUpliftCents: number;
}

interface Insights {
  opportunities: {
    items: Opportunity[];
    count: number;
    totalMonthlyUpliftCents: number;
  };
  proof: {
    skusRepriced: number;
    totalChanges: number;
    avgMarginBefore: number | null;
    avgMarginAfter: number | null;
    firstChangeAt: string | null;
  };
  aiUsage: {
    usedThisMonth: number;
    limit: number;
  };
}

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function StatCard({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "warn" | "crit" | "ok" | "accent" }) {
  const colors: Record<string, string> = { warn: "var(--warning)", crit: "var(--critical)", ok: "var(--success)", accent: "var(--accent)" };
  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 12, color: "var(--slate)", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: tone ? colors[tone] : "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--slate)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function Dashboard() {
  const { can, loading: planLoading } = usePlanAccess();
  const hasInventory = can("inventory");
  const hasProcurement = can("procurement");
  const [inventory, setInventory] = useState<InventoryRow[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [sources, setSources] = useState<ScrapingSource[] | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (planLoading) return;
    if (hasInventory) {
      api.get<InventoryRow[]>("/inventory/levels").then(setInventory).catch(() => setError("API unavailable."));
    }
    if (hasProcurement) api.get<Suggestion[]>("/procurement/suggestions").then(setSuggestions).catch(() => {});
    api.get<ScrapingSource[]>("/scraping/sources").then(setSources).catch(() => {});
    api.get<Insights>("/dashboard/insights").then(setInsights).catch(() => {});
  }, [hasInventory, hasProcurement, planLoading]);

  const outOfStock = inventory?.filter(r => r.status === "out_of_stock") ?? [];
  const lowStock   = inventory?.filter(r => r.status === "low") ?? [];
  const products = inventory
    ? [...new Map(inventory.map((row) => [row.variant_id, row])).values()]
    : [];
  const spikes     = sources?.filter(s => s.validation_flag === "out_of_band") ?? [];
  const failedSources = sources?.filter(s => s.last_status === "failed") ?? [];

  const opp = insights?.opportunities;
  const proof = insights?.proof;
  const marginDelta = proof?.avgMarginBefore != null && proof?.avgMarginAfter != null
    ? Math.round((proof.avgMarginAfter - proof.avgMarginBefore) * 10) / 10
    : null;

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 2px" }}>Dashboard</h1>
      {error && (
        <div style={{ background: "#FBEAE7", color: "var(--critical)", border: "1px solid var(--critical)", borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error} Is the API running on port 4000?
        </div>
      )}

      {/* ── Margin Opportunities Card ─────────────────────────── */}
      {opp && opp.count > 0 && (
        <div className="card" style={{
          marginBottom: 20,
          background: "linear-gradient(135deg, rgba(63,174,122,0.08) 0%, rgba(63,174,122,0.02) 100%)",
          border: "1px solid rgba(63,174,122,0.25)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <strong style={{ fontSize: 16, display: "block", marginBottom: 4 }}>💰 Margin opportunities</strong>
              <span style={{ fontSize: 13, color: "var(--slate)" }}>
                {opp.count} SKU{opp.count > 1 ? "s are" : " is"} priced below the market median — about{" "}
                <strong style={{ color: "var(--accent)" }}>{money(opp.totalMonthlyUpliftCents)}/month</strong> in margin left on the table.
              </span>
            </div>
            <Link to="/app/pricing" className="mv-btn primary" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
              Review pricing →
            </Link>
          </div>
          <div style={{ display: "grid", gap: 0 }}>
            {opp.items.slice(0, 5).map((o) => (
              <Link to={`/app/pricing/${o.variantId}`} key={o.variantId}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--hairline)", textDecoration: "none", color: "inherit" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{o.name}</div>
                  <div style={{ fontSize: 11, color: "var(--slate)" }}>
                    {o.sku} · Your price {money(o.currentPriceCents)} · Market median {money(o.competitorMedianCents)} ({o.competitorCount} competitors)
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>+{money(o.gapCents)}</div>
                  <div style={{ fontSize: 11, color: "var(--slate)" }}>{money(o.monthlyUpliftCents)}/mo</div>
                </div>
              </Link>
            ))}
          </div>
          {opp.count > 5 && (
            <div style={{ fontSize: 12, color: "var(--slate)", marginTop: 8 }}>
              and {opp.count - 5} more. <Link to="/app/pricing" style={{ color: "var(--accent)" }}>See all →</Link>
            </div>
          )}
        </div>
      )}

      {/* ── Proof Card — margin improvement ────────────────────── */}
      {proof && proof.skusRepriced > 0 && marginDelta !== null && (
        <div className="card" style={{
          marginBottom: 20,
          background: marginDelta > 0
            ? "linear-gradient(135deg, rgba(63,174,122,0.06) 0%, transparent 100%)"
            : undefined,
          border: marginDelta > 0 ? "1px solid rgba(63,174,122,0.2)" : undefined,
        }}>
          <strong style={{ fontSize: 14, display: "block", marginBottom: 6 }}>
            📈 Pricing results (last 90 days)
          </strong>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", fontSize: 13 }}>
            <div>
              <span style={{ color: "var(--slate)" }}>SKUs repriced</span>{" "}
              <strong>{proof.skusRepriced}</strong>
            </div>
            <div>
              <span style={{ color: "var(--slate)" }}>Avg margin before</span>{" "}
              <strong>{proof.avgMarginBefore?.toFixed(1)}%</strong>
            </div>
            <div>
              <span style={{ color: "var(--slate)" }}>Avg margin after</span>{" "}
              <strong>{proof.avgMarginAfter?.toFixed(1)}%</strong>
            </div>
            <div>
              <span style={{ color: "var(--slate)" }}>Change</span>{" "}
              <strong style={{ color: marginDelta > 0 ? "var(--success)" : marginDelta < 0 ? "var(--critical)" : "var(--ink)" }}>
                {marginDelta > 0 ? "+" : ""}{marginDelta.toFixed(1)} pp
              </strong>
            </div>
            <div>
              <span style={{ color: "var(--slate)" }}>Total changes</span>{" "}
              <strong>{proof.totalChanges}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        {hasInventory && <>
          <StatCard label="Products tracked" value={inventory === null ? "—" : products.length} sub="In your catalog" />
          <StatCard
            label="Out of stock"
            value={outOfStock.length}
            tone={outOfStock.length > 0 ? "crit" : "ok"}
            sub={outOfStock.length > 0 ? "Needs immediate action" : "All good"}
          />
          <StatCard
            label="Low stock"
            value={lowStock.length}
            tone={lowStock.length > 0 ? "warn" : "ok"}
            sub={lowStock.length > 0 ? "Below reorder point" : "Levels healthy"}
          />
        </>}
        {hasProcurement && <StatCard
          label="Reorder suggestions"
          value={suggestions?.length ?? "—"}
          tone={(suggestions?.length ?? 0) > 0 ? "warn" : "ok"}
          sub="Open procurement actions"
        />}
        <StatCard
          label="Price spikes"
          value={spikes.length}
          tone={spikes.length > 0 ? "warn" : "ok"}
          sub="Competitors flagged out-of-band"
        />
        {insights && (
          <StatCard
            label="AI requests"
            value={`${insights.aiUsage.usedThisMonth}/${insights.aiUsage.limit}`}
            tone={insights.aiUsage.usedThisMonth >= insights.aiUsage.limit ? "warn" : "ok"}
            sub="This month (platform key)"
          />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* Recent products */}
        {hasInventory && <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>Recent products</strong>
            <Link to="/app/inventory" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>View all →</Link>
          </div>
          {inventory === null && <SkeletonRows rows={3} />}
          {inventory?.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No products yet.</p>}
          {products.slice(0, 5).map(row => (
            <div key={row.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--hairline)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{row.product_name}</div>
                <div style={{ fontSize: 11, color: "var(--slate)" }}>{row.sku} · {row.location_name} · {row.quantity} on hand</div>
              </div>
              <StatusPill status={row.status} />
            </div>
          ))}
          {products.length > 5 && <p style={{ color: "var(--slate)", fontSize: 12 }}>Showing 5 of {products.length} products.</p>}
        </div>}

        {/* Procurement suggestions */}
        {hasProcurement && <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>Procurement</strong>
            <Link to="/app/procurement" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>View all →</Link>
          </div>
          {suggestions === null && <SkeletonRows rows={3} />}
          {suggestions?.length === 0 && <p style={{ color: "var(--success)", fontSize: 13 }}>✓ No open reorder suggestions.</p>}
          {suggestions?.slice(0, 5).map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--hairline)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "var(--slate)" }}>{s.sku} · {s.location_name}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: (s.reason.daysOfCover ?? 99) <= 3 ? "var(--critical)" : "var(--warning)" }}>
                  {s.reason.daysOfCover ?? "—"}d cover
                </div>
                <div style={{ fontSize: 11, color: "var(--slate)" }}>Suggest {s.suggested_quantity} units</div>
              </div>
            </div>
          ))}
        </div>}

        {/* Pricing alerts */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>Competitor pricing alerts</strong>
            <Link to="/app/pricing" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>View all →</Link>
          </div>
          {sources === null && <SkeletonRows rows={3} />}
          {sources?.length === 0 && (
            <p style={{ color: "var(--slate)", fontSize: 13 }}>
              No competitors tracked yet.{" "}
              <Link to="/app/pricing" style={{ color: "var(--accent)" }}>Add one →</Link>
            </p>
          )}
          {spikes.length === 0 && (sources?.length ?? 0) > 0 && (
            <p style={{ color: "var(--success)", fontSize: 13 }}>✓ No price spikes detected.</p>
          )}
          {spikes.map(s => (
            <div key={s.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--hairline)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.competitor_name}</div>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "#FBF0E4", color: "var(--warning)" }}>
                  Price spike
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--slate)" }}>
                {s.product_name} · {s.latest_price_cents ? money(s.latest_price_cents, s.latest_currency) : "—"}
                {s.latest_observed_at ? ` · ${new Date(s.latest_observed_at).toLocaleString()}` : ""}
              </div>
            </div>
          ))}
          {failedSources.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: "#FBEAE7", borderRadius: 6, fontSize: 12, color: "var(--critical)" }}>
              {failedSources.length} source{failedSources.length > 1 ? "s" : ""} failed on last check. Review in{" "}
              <Link to="/app/settings" style={{ color: "var(--critical)" }}>Settings → Tracked competitors</Link>.
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="card">
          <strong style={{ display: "block", marginBottom: 14, fontSize: 14 }}>Quick actions</strong>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Link to="/app/competitors" className="btn mv-quick-action">
              <span className="material-symbols-rounded mv-quick-action-icon" aria-hidden="true">search</span>
              <span>Search competitor prices</span>
            </Link>
            <Link to="/app/pricing" className="btn mv-quick-action">
              <span className="material-symbols-rounded mv-quick-action-icon" aria-hidden="true">monitoring</span>
              <span>Review a pricing strategy</span>
            </Link>
            <Link to="/app/procurement" className="btn mv-quick-action">
              <span className="material-symbols-rounded mv-quick-action-icon" aria-hidden="true">inventory_2</span>
              <span>Create a purchase order</span>
            </Link>
            <Link to="/app/settings/competitor-sources" className="btn mv-quick-action">
              <span className="material-symbols-rounded mv-quick-action-icon" aria-hidden="true">tune</span>
              <span>Settings &amp; tracked competitors</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
