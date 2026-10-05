import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  CATEGORIES,
  apiJson,
  formatCents,
  statusFor,
  type InventoryLevel,
  type Location,
  type ProductDraft,
} from "../types/inventory";
import { CSVUploader } from "../components/CSVUploader";
import CompetitorTargetsModal from "../components/inventory/CompetitorTargetsModal";
import { saveCompetitorTargets, type CompetitorEntry } from "../components/inventory/CompetitorUrlInput";
import { ProductFormModal, primaryButtonStyle, secondaryButtonStyle } from "../components/ProductFormModal";

const BORDER = "var(--mv-border, rgba(255,255,255,0.12))";
const MUTED = "var(--mv-muted, #8fa396)";
const STATUS_COLOR = { healthy: "#3fae7a", low: "#d9a441", critical: "#e5735f" } as const;

const fieldStyle: React.CSSProperties = {
  background: "var(--mv-field, #0c120f)",
  color: "var(--mv-text, #e8efe9)",
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  padding: "8px 10px",
};

export default function Inventory() {
  const [levels, setLevels] = useState<InventoryLevel[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");

  const [showAdd, setShowAdd] = useState(false);
  const [showCSV, setShowCSV] = useState(false);
  const [editing, setEditing] = useState<InventoryLevel | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tracking, setTracking] = useState<InventoryLevel | null>(null);

  const load = useCallback(async () => {
    try {
      const [lv, loc] = await Promise.all([
        apiJson<InventoryLevel[]>("/api/inventory/levels"),
        apiJson<Location[]>("/api/inventory/locations"),
      ]);
      setLevels(lv);
      setLocations(loc);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const existingSkus = useMemo(() => new Set(levels.map((l) => l.sku)), [levels]);
  const categories = useMemo(() => [...new Set([...CATEGORIES, ...levels.map((l) => l.category)])], [levels]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return levels.filter(
      (l) =>
        (category === "all" || l.category === category) &&
        (locationFilter === "all" || l.location_id === locationFilter) &&
        (!q || l.sku.toLowerCase().includes(q) || l.product_name.toLowerCase().includes(q))
    );
  }, [levels, search, category, locationFilter]);

  // The create endpoint's response shape isn't relied on: look the new variant up by SKU.
  async function attachCompetitors(sku: string, entries: CompetitorEntry[]) {
    try {
      const fresh = await apiJson<InventoryLevel[]>("/api/inventory/levels");
      const match = fresh.find((l) => l.sku === sku);
      if (!match) throw new Error("couldn't find the new product");
      await saveCompetitorTargets(match.variant_id, entries);
    } catch (e) {
      setNotice(`Product saved, but competitor URLs weren't: ${(e as Error).message}. Use the Competitors button to retry.`);
    }
  }

  async function createProduct(draft: ProductDraft, competitors: CompetitorEntry[] = []): Promise<string | null> {
    try {
      await apiJson("/api/products", { method: "POST", body: JSON.stringify(draft) });
      if (competitors.length) await attachCompetitors(draft.sku, competitors);
      await load();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Could not add product.";
    }
  }

  async function updateProduct(level: InventoryLevel, draft: ProductDraft, competitors: CompetitorEntry[] = []): Promise<string | null> {
    try {
      await apiJson(`/api/products/${level.variant_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sku: draft.sku,
          name: draft.name,
          category: draft.category,
          cost_cents: draft.cost_cents,
          price_cents: draft.price_cents,
          currency: draft.currency,
        }),
      });
      if (competitors.length) await saveCompetitorTargets(level.variant_id, competitors);
      await load();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Could not save changes.";
    }
  }

  async function removeProduct(level: InventoryLevel) {
    try {
      await apiJson(`/api/products/${level.variant_id}`, { method: "DELETE" });
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Could not delete.");
    }
  }

  async function saveLevel(level: InventoryLevel, patch: { quantity?: number; reorder_level?: number }) {
    const prev = levels;
    setLevels((ls) => ls.map((l) => (l.id === level.id ? { ...l, ...patch } : l)));
    try {
      await apiJson(`/api/inventory/levels/${level.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (e) {
      setLevels(prev);
      setError(e instanceof Error ? e.message : "Could not update stock.");
    }
  }

  return (
    <div className="app-content">
      <div className="page-header">
        <div>
          <h1>Inventory</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={secondaryButtonStyle} onClick={() => setShowCSV((v) => !v)}>Import CSV</button>
          <button type="button" style={primaryButtonStyle} onClick={() => setShowAdd(true)}>Add product</button>
        </div>
      </div>

      {notice && <p role="status" style={{ color: "var(--mv-accent, #3fae7a)" }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "var(--mv-danger, #e5735f)" }}>{error}</p>}

      {showCSV && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <CSVUploader
            existingSkus={existingSkus}
            locations={locations}
            onDone={(n) => {
              setShowCSV(false);
              setNotice(`Imported ${n} product${n === 1 ? "" : "s"}.`);
              void load();
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search SKU or name"
          aria-label="Search SKU or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...fieldStyle, minWidth: 240 }}
        />
        <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} style={fieldStyle}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {locations.length > 1 && (
          <select aria-label="Filter by location" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} style={fieldStyle}>
            <option value="all">All locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <p style={{ color: MUTED }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: MUTED }}>{levels.length === 0 ? "No products yet." : "No products match these filters."}</p>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: MUTED }}>
                {["SKU", "Product", "Category", "Location", "Cost", "Stock", "Reorder at", "Status", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const status = statusFor(l);
                return (
                  <tr key={l.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td style={cell}>{l.sku}</td>
                    <td style={cell}>{l.product_name}</td>
                    <td style={cell}>{l.category}</td>
                    <td style={cell}>{l.location_name}</td>
                    <td style={{ ...cell, fontVariantNumeric: "tabular-nums" }}>{formatCents(l.cost)}</td>
                    <td style={cell}><NumberCell value={l.quantity} label={`Stock for ${l.sku}`} onCommit={(n) => saveLevel(l, { quantity: n })} /></td>
                    <td style={cell}><NumberCell value={l.reorder_level} label={`Reorder level for ${l.sku}`} onCommit={(n) => saveLevel(l, { reorder_level: n })} /></td>
                    <td style={cell}>
                      <span style={{ color: STATUS_COLOR[status] }}>● {status === "healthy" ? "Healthy" : status === "low" ? "Low" : "Out of stock"}</span>
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
                      {confirmDelete === l.id ? (
                        <>
                          <button type="button" style={{ ...secondaryButtonStyle, padding: "4px 10px", color: "#e5735f" }} onClick={() => removeProduct(l)}>Confirm delete</button>{" "}
                          <button type="button" style={{ ...secondaryButtonStyle, padding: "4px 10px" }} onClick={() => setConfirmDelete(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button type="button" style={{ ...secondaryButtonStyle, padding: "4px 10px" }} onClick={() => setTracking(l)}>Competitors</button>{" "}
                          <button type="button" style={{ ...secondaryButtonStyle, padding: "4px 10px" }} onClick={() => setEditing(l)}>Edit</button>{" "}
                          <button type="button" style={{ ...secondaryButtonStyle, padding: "4px 10px" }} onClick={() => setConfirmDelete(l.id)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <ProductFormModal mode="add" locations={locations} onClose={() => setShowAdd(false)} onSubmit={createProduct} />}
      {editing && (
        <ProductFormModal mode="edit" initial={editing} locations={locations} onClose={() => setEditing(null)} onSubmit={(d, c) => updateProduct(editing, d, c)} />
      )}
      {tracking && (
        <CompetitorTargetsModal variantId={tracking.variant_id} title={tracking.product_name} onClose={() => setTracking(null)} />
      )}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "10px 12px", verticalAlign: "middle" };

/** Number input that commits on blur/Enter only when the value actually changed and is a valid whole number. */
function NumberCell({ value, label, onCommit }: { value: number; label: string; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    if (!/^\d+$/.test(draft)) return setDraft(String(value));
    const n = Number(draft);
    if (n !== value) onCommit(n);
  }
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      style={{ ...fieldStyle, width: 72, padding: "4px 8px", fontVariantNumeric: "tabular-nums" }}
    />
  );
}
