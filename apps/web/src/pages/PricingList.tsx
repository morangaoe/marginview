import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface ProductRow {
  variant_id: string;
  sku: string;
  name: string;
  current_price_cents: number | null;
  currency: string;
}

export function PricingList() {
  const [rows, setRows] = useState<ProductRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ProductRow[]>("/products")
      .then(setRows)
      .catch(() => setError("Could not load products."));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Pricing intelligence</h1>
      <div className="card">
        {error && <p style={{ color: "var(--critical)" }}>{error}</p>}
        {!error && rows === null && <SkeletonRows rows={5} />}
        {rows?.length === 0 && <p style={{ color: "var(--slate)" }}>No products yet. Add one to get started.</p>}
        {rows && rows.length > 0 && (
          <table>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variant_id}>
                  <td>{r.name} ({r.sku})</td>
                  <td>
                    <Link className="btn" to={`/app/pricing/${r.variant_id}`}>
                      Review pricing
                    </Link>
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
