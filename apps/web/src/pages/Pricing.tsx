import React, { useEffect, useMemo, useState } from "react";
import { apiJson, formatCents, type InventoryLevel } from "../types/inventory";
import { OptimizedPricingPanel } from "../components/OptimizedPricingPanel";

export default function Pricing() {
  const [levels, setLevels] = useState<InventoryLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [variantId, setVariantId] = useState("");

  useEffect(() => {
    apiJson<InventoryLevel[]>("/api/inventory/levels")
      .then((data) => {
        setLevels(data);
        setVariantId((cur) => cur || data[0]?.variant_id || "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load products."))
      .finally(() => setLoading(false));
  }, []);

  // Levels are per location; pricing is per variant, so collapse to one option per variant.
  const variants = useMemo(() => {
    const map = new Map<string, InventoryLevel>();
    for (const l of levels) if (!map.has(l.variant_id)) map.set(l.variant_id, l);
    return [...map.values()];
  }, [levels]);

  const selected = variants.find((v) => v.variant_id === variantId) ?? null;

  return (
    <div className="app-content">
      <div className="page-header">
        <div>
          <h1>Pricing</h1>
        </div>
      </div>

      {loading && <p style={{ color: "var(--mv-muted, #8fa396)" }}>Loading…</p>}
      {error && <p role="alert" style={{ color: "var(--mv-danger, #e5735f)" }}>{error}</p>}
      {!loading && !error && variants.length === 0 && <p>No products yet. Add some on the Inventory page.</p>}

      {variants.length > 0 && (
        <div style={{ display: "grid", gap: 24 }}>
          <label style={{ display: "grid", gap: 4, maxWidth: 420, fontSize: 13, color: "var(--mv-muted, #8fa396)" }}>
            Product
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              style={{ background: "var(--mv-field, #0c120f)", color: "var(--mv-text, #e8efe9)", border: "1px solid var(--mv-border, rgba(255,255,255,0.12))", borderRadius: 6, padding: "8px 10px" }}
            >
              {variants.map((v) => (
                <option key={v.variant_id} value={v.variant_id}>{v.sku} · {v.product_name} · cost {formatCents(v.cost)}</option>
              ))}
            </select>
          </label>

          {selected && <OptimizedPricingPanel key={selected.variant_id} variantId={selected.variant_id} costCents={selected.cost} />}
        </div>
      )}
    </div>
  );
}
