import { formatCents, type OptimizedPricingResponse } from "../types/inventory";

const LABELS = { cost_plus: "Cost plus", value_based: "Value based", keystone: "Keystone", dynamic: "Dynamic" } as const;
const MUTED = "var(--mv-muted, #8fa396)";
const BORDER = "var(--mv-border, rgba(255,255,255,0.12))";

export function PriceBreakdown({ result }: { result: OptimizedPricingResponse }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, display: "grid", gap: 10 }}>
      <strong style={{ fontSize: 14 }}>How this price was built</strong>
      <div className="mv-table-wrap">
        <table className="mv-table">
          <thead><tr><th>Strategy</th><th>Share</th><th>Its price</th><th>Adds</th></tr></thead>
          <tbody>
            {result.breakdown.map((item) => (
              <tr key={item.strategy} style={{ opacity: item.weight_pct < 0.05 ? 0.45 : 1 }}>
                <td>{LABELS[item.strategy]}</td>
                <td className="mono">{item.weight_pct.toFixed(0)}%</td>
                <td className="mono">{formatCents(item.price_cents)}</td>
                <td className="mono">{formatCents(Math.round(item.contribution_cents))}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3}><strong>Optimized price</strong></td>
              <td className="mono"><strong>{formatCents(result.optimized_price_cents)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      {result.adjustments.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: MUTED, fontSize: 13 }}>
          {result.adjustments.map((adjustment) => <li key={adjustment}>{adjustment}</li>)}
        </ul>
      )}
      {(Object.keys(LABELS) as (keyof typeof LABELS)[])
        .filter((key) => result.baselines[key].warning && result.breakdown.find((item) => item.strategy === key)!.weight_pct > 0.05)
        .map((key) => (
          <div key={key} className="pill warn" style={{ borderRadius: 8, whiteSpace: "normal" }}>
            {LABELS[key]}: {result.baselines[key].warning}
          </div>
        ))}
    </div>
  );
}
