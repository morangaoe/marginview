import { useEffect, useState } from "react";
import { api } from "../api/client";
import { StatusPill } from "../components/StatusPill";

interface InventoryRow {
  id: string;
  sku: string;
  name: string;
  location_name: string;
  on_hand: number;
  reorder_point: number;
  status: string;
}

export function Inventory() {
  const [rows, setRows] = useState<InventoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<InventoryRow[]>("/inventory/levels")
      .then(setRows)
      .catch(() => setError("Could not load inventory. Check that the API is running."));
  }

  useEffect(load, []);

  async function adjust(id: string, delta: number) {
    try {
      await api.post("/inventory/adjust", {
        inventoryLevelId: id,
        changeQuantity: delta,
        reasonCode: "recount",
      });
      load();
    } catch {
      setError("Could not save that adjustment. Please try again.");
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Inventory</h1>
      <p style={{ color: "var(--slate)", fontSize: 13, marginBottom: 20 }}>Stock across all locations.</p>

      <div className="card">
        {error && <p style={{ color: "var(--critical)" }}>{error}</p>}
        {!error && rows === null && <p>Loading…</p>}
        {rows && (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Location</th>
                <th>On hand</th>
                <th>Reorder pt.</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name} ({r.sku})</td>
                  <td>{r.location_name}</td>
                  <td>{r.on_hand}</td>
                  <td>{r.reorder_point}</td>
                  <td><StatusPill status={r.status} /></td>
                  <td>
                    <button className="btn" onClick={() => adjust(r.id, 1)} aria-label={`Add one unit of ${r.sku}`}>
                      +1
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
