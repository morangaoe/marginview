import { SkeletonRows } from "../components/Skeleton";
import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";

interface Suggestion {
  id: string;
  product_variant_id: string;
  sku: string;
  name: string;
  location_name: string;
  location_id: string;
  suggested_quantity: number;
  reason: { daysOfCover: number | null; belowReorderPoint: boolean; leadTimeDays: number };
  status: string;
}

interface Supplier {
  id: string;
  name: string;
  contact_email: string | null;
  default_lead_time_days: number;
}

interface Location {
  id: string;
  name: string;
}

interface PoModalProps {
  suggestion: Suggestion;
  suppliers: Supplier[];
  locations: Location[];
  onClose: () => void;
  onCreated: () => void;
}

function PoModal({ suggestion, suppliers, locations, onClose, onCreated }: PoModalProps) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [locationId, setLocationId] = useState(suggestion.location_id || (locations[0]?.id ?? ""));
  const [quantity, setQuantity] = useState(suggestion.suggested_quantity);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError("Select a supplier first."); return; }
    if (!locationId) { setError("Select a destination location."); return; }
    setError(null);
    setCreating(true);
    try {
      await api.post<{ purchaseOrderId: string }>("/procurement/purchase-orders", {
        suggestionId: suggestion.id,
        supplierId,
        locationId,
        items: [
          {
            productVariantId: suggestion.product_variant_id,
            quantityOrdered: quantity,
            unitCostCents: 0, // unit cost unknown without a price list; set to 0, edit on the PO
          },
        ],
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Could not create purchase order.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }}>
      <div className="card" style={{ width: "100%", maxWidth: 440, padding: "28px 28px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Create Purchase Order</div>
            <div style={{ color: "var(--slate)", fontSize: 13, marginTop: 2 }}>{suggestion.name} · {suggestion.sku}</div>
          </div>
          <button className="btn" style={{ border: "none", fontSize: 16 }} onClick={onClose}>×</button>
        </div>

        {error && (
          <div style={{ background: "#FBEAE7", color: "var(--critical)", border: "1px solid var(--critical)", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Supplier</label>
            {suppliers.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--warning)" }}>
                No suppliers set up yet. Add one in Settings → Suppliers first.
              </p>
            ) : (
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={selectStyle} required>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.default_lead_time_days ? ` · ${s.default_lead_time_days}d lead` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Ship to location</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={selectStyle} required>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Quantity</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              style={selectStyle}
              required
            />
            <div style={{ fontSize: 11, color: "var(--slate)", marginTop: 4 }}>
              Suggested: {suggestion.suggested_quantity} · Lead time: {suggestion.reason.leadTimeDays}d
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="submit" className="btn primary" disabled={creating || suppliers.length === 0} style={{ fontSize: 13 }}>
              {creating ? "Creating…" : "Create draft PO"}
            </button>
            <button type="button" className="btn" onClick={onClose} style={{ fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Procurement() {
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [modal, setModal] = useState<Suggestion | null>(null);

  function load() {
    api
      .get<Suggestion[]>("/procurement/suggestions")
      .then(setRows)
      .catch(() => setError("Could not load procurement suggestions."));
  }

  useEffect(() => {
    load();
    api.get<Supplier[]>("/suppliers").then(setSuppliers).catch(() => {});
    api.get<Location[]>("/admin/locations").then(setLocations).catch(() => {});
  }, []);

  function handleCreated() {
    setSuccess("Purchase order created as draft.");
    setTimeout(() => setSuccess(null), 3000);
    load();
  }

  return (
    <div>
      {modal && (
        <PoModal
          suggestion={modal}
          suppliers={suppliers}
          locations={locations}
          onClose={() => setModal(null)}
          onCreated={handleCreated}
        />
      )}

      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Procurement suggestions</h1>
      {error && (
        <div style={{ background: "#FBEAE7", color: "var(--critical)", border: "1px solid var(--critical)", borderRadius: 6, padding: "10px 12px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: "#EAF3EC", color: "var(--success)", border: "1px solid var(--success)", borderRadius: 6, padding: "10px 12px", fontSize: 13, marginBottom: 16 }}>
          {success}
        </div>
      )}

      {suppliers.length === 0 && rows && rows.length > 0 && (
        <div style={{ background: "#FBF0E4", color: "var(--warning)", border: "1px solid var(--warning)", borderRadius: 6, padding: "10px 12px", fontSize: 13, marginBottom: 16 }}>
          ⚠ No suppliers set up yet — go to <strong>Settings → Suppliers</strong> to add one before creating a PO.
        </div>
      )}

      <div className="card">
        {!error && rows === null && <SkeletonRows rows={5} />}
        {rows?.length === 0 && <p style={{ color: "var(--slate)" }}>No open suggestions right now.</p>}
        {rows && rows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Product / SKU</th>
                <th>Location</th>
                <th>Days of cover</th>
                <th>Reason</th>
                <th>Qty suggested</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: "var(--slate)" }}>{r.sku}</div>
                  </td>
                  <td style={{ fontSize: 13, color: "var(--slate)" }}>{r.location_name}</td>
                  <td>
                    <span style={{
                      fontWeight: 700,
                      color: r.reason.daysOfCover === null ? "var(--slate)"
                        : r.reason.daysOfCover <= 3 ? "var(--critical)"
                        : r.reason.daysOfCover <= 7 ? "var(--warning)"
                        : "var(--ink)",
                    }}>
                      {r.reason.daysOfCover ?? "—"}d
                    </span>
                  </td>
                  <td style={{ color: "var(--slate)", fontSize: 12 }}>
                    Below reorder point · {r.reason.leadTimeDays}d lead time
                  </td>
                  <td style={{ fontSize: 13 }}>{r.suggested_quantity}</td>
                  <td>
                    <button className="btn primary" style={{ fontSize: 12 }} onClick={() => setModal(r)}>
                      Create PO
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const fieldStyle: CSSProperties = { marginBottom: 14 };
const labelStyle: CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 5 };
const selectStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--hairline)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  background: "var(--paper)",
  color: "var(--ink)",
};
