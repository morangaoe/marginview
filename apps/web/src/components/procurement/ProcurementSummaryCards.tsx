import { money } from "../../lib/mv";

export interface Summary {
  criticalRestocks: number; opportunityCount: number; opportunityCapitalCents: number;
  overstockCount: number; overstockValueCents: number;
}

export default function ProcurementSummaryCards({ summary }: { summary: Summary }) {
  const cards = [
    { label: "Critical restocks", value: String(summary.criticalRestocks), note: "Below reorder point and still selling", tag: "RESTOCK_NOW" },
    { label: "Capital opportunities", value: money(summary.opportunityCapitalCents), note: `${summary.opportunityCount} products with strong market margin`, tag: "OPPORTUNITY_BUY" },
    { label: "Overstock risk", value: money(summary.overstockValueCents), note: `${summary.overstockCount} products to mark down`, tag: "LIQUIDATE" },
  ];
  return (
    <div className="mv-grid">
      {cards.map((c) => (
        <div key={c.label} className="card">
          <span className={`mv-badge ${c.tag}`}>{c.label}</span>
          <p style={{ fontSize: 26, margin: "10px 0 2px", fontWeight: 700 }}>{c.value}</p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--slate)" }}>{c.note}</p>
        </div>
      ))}
    </div>
  );
}
