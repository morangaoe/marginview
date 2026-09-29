import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { StatusPill } from "../components/StatusPill";
import { useAuth } from "../auth/AuthContext";

interface InventoryRow {
  id: string;
  sku: string;
  name: string;
  status: string;
  on_hand: number;
  location_name: string;
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

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function StatCard({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "warn" | "crit" | "ok" }) {
  const colors: Record<string, string> = { warn: "var(--warning)", crit: "var(--critical)", ok: "var(--success)" };
  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 12, color: "var(--slate)", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: tone ? colors[tone] : "var(--ink)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--slate)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const [inventory, setInventory] = useState<InventoryRow[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [sources, setSources] = useState<ScrapingSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<InventoryRow[]>("/inventory/levels").then(setInventory).catch(() => setError("API unavailable."));
    api.get<Suggestion[]>("/procurement/suggestions").then(setSuggestions).catch(() => {});
    api.get<ScrapingSource[]>("/scraping/sources").then(setSources).catch(() => {});
  }, []);

  const outOfStock = inventory?.filter(r => r.status === "out_of_stock") ?? [];
  const lowStock   = inventory?.filter(r => r.status === "low") ?? [];
  const spikes     = sources?.filter(s => s.validation_flag === "out_of_band") ?? [];
  const failedSources = sources?.filter(s => s.last_status === "failed") ?? [];

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 2px" }}>Dashboard</h1>
      {error && (
        <div style={{ background: "#FBEAE7", color: "var(--critical)", border: "1px solid var(--critical)", borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error} Is the API running on port 4000?
        </div>
      )}

      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
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
        <StatCard
          label="Reorder suggestions"
          value={suggestions?.length ?? "—"}
          tone={(suggestions?.length ?? 0) > 0 ? "warn" : "ok"}
          sub="Open procurement actions"
        />
        <StatCard
          label="Price spikes"
          value={spikes.length}
          tone={spikes.length > 0 ? "warn" : "ok"}
          sub="Competitors flagged out-of-band"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* Inventory alerts */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>Inventory alerts</strong>
            <Link to="/app/inventory" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>View all →</Link>
          </div>
          {inventory === null && <SkeletonRows rows={3} />}
          {inventory?.length === 0 && <p style={{ color: "var(--slate)", fontSize: 13 }}>No products yet.</p>}
          {[...outOfStock, ...lowStock].length === 0 && inventory !== null && inventory.length > 0 && (
            <p style={{ color: "var(--success)", fontSize: 13 }}>✓ All inventory levels are healthy.</p>
          )}
          {[...outOfStock, ...lowStock].map(row => (
            <div key={row.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--hairline)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{row.name}</div>
                <div style={{ fontSize: 11, color: "var(--slate)" }}>{row.sku} · {row.location_name} · {row.on_hand} on hand</div>
              </div>
              <StatusPill status={row.status} />
            </div>
          ))}
        </div>

        {/* Procurement suggestions */}
        <div className="card">
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
        </div>

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
            <Link to="/app/pricing" className="btn" style={{ fontSize: 13, display: "block", textAlign: "center", textDecoration: "none" }}>
              📊 Review a pricing strategy
            </Link>
            <Link to="/app/procurement" className="btn" style={{ fontSize: 13, display: "block", textAlign: "center", textDecoration: "none" }}>
              📦 Create a purchase order
            </Link>
            <Link to="/app/settings" className="btn" style={{ fontSize: 13, display: "block", textAlign: "center", textDecoration: "none" }}>
              ⚙️ Settings & tracked competitors
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
