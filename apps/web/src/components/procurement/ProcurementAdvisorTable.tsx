import { money } from "../../lib/mv";

export interface AdvisorRow {
  variantId: string; sku: string; name: string; stock: number; capacity: number; stockPct: number;
  costCents: number; marketCents: number | null; marginPct: number | null; daysOfCover: number | null;
  tag: "RESTOCK_NOW" | "OPPORTUNITY_BUY" | "HOLD" | "LIQUIDATE"; reason: string; suggestedQty: number;
}

const LABEL = { RESTOCK_NOW: "Restock now", OPPORTUNITY_BUY: "Opportunity buy", HOLD: "Hold / don't buy", LIQUIDATE: "Liquidate / markdown" } as const;

export default function ProcurementAdvisorTable({ rows, onCreatePo }: { rows: AdvisorRow[]; onCreatePo: (r: AdvisorRow) => void }) {
  if (!rows.length) {
    return <div className="card" style={{ color: "var(--slate)" }}>No products yet. Add inventory and competitor URLs to get recommendations.</div>;
  }
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr><th>Product / SKU</th><th>Stock</th><th>Market vs cost</th><th>Recommendation</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const actionable = r.tag === "RESTOCK_NOW" || r.tag === "OPPORTUNITY_BUY";
            return (
              <tr key={r.variantId}>
                <td><div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div><div style={{ fontSize: 11, color: "var(--slate)" }}>{r.sku}</div></td>
                <td style={{ minWidth: 130 }}>
                  <div className="mv-bar" style={{ marginBottom: 4 }}><span style={{ width: `${Math.min(r.stockPct, 100)}%` }} /></div>
                  <span style={{ fontSize: 12, color: "var(--slate)" }}>{r.stockPct.toFixed(0)}% · {r.stock}/{r.capacity}</span>
                </td>
                <td style={{ fontSize: 13 }}>
                  {money(r.marketCents)} <span style={{ color: "var(--slate)" }}>vs {money(r.costCents)}</span>
                  <div style={{ fontSize: 12, color: "var(--slate)" }}>{r.marginPct == null ? "No market price yet" : `${r.marginPct.toFixed(0)}% margin`}</div>
                </td>
                <td style={{ maxWidth: 320 }}>
                  <span className={`mv-badge ${r.tag}`}>{LABEL[r.tag]}</span>
                  <div style={{ fontSize: 12, color: "var(--slate)", marginTop: 4 }}>{r.reason}</div>
                </td>
                <td>
                  {actionable && <button className="btn primary" style={{ fontSize: 12 }} onClick={() => onCreatePo(r)}>Create PO ({r.suggestedQty})</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
