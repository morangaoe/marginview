import { Link } from "react-router-dom";
import { formatCents } from "../types/inventory";

export interface PricingContext {
  variantId: string;
  costCents: number;
  currentPriceCents: number | null;
  competitors: {
    id: string;
    competitorName: string;
    url: string;
    priceCents: number | null;
    currency: string | null;
    observedAt: string | null;
    flag: string | null;
  }[];
  stats: { avgCents: number; minCents: number; maxCents: number; count: number } | null;
}

const MUTED = "var(--mv-muted, #8fa396)";
const BORDER = "var(--mv-border, rgba(255,255,255,0.12))";

export function CompetitorContext({ data, yourPriceCents }: { data: PricingContext; yourPriceCents: number | null }) {
  if (data.competitors.length === 0) {
    return (
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, color: MUTED, fontSize: 13 }}>
        No competitors tracked for this product yet.{" "}
        <Link to="/app/settings/competitor-sources" style={{ color: "var(--accent)" }}>Add a competitor source</Link>
        {" "}or use the Competitors button on the Inventory page.
      </div>
    );
  }

  const vs = (competitorCents: number | null) => {
    if (competitorCents === null || yourPriceCents === null || competitorCents === 0) return "—";
    const pct = ((yourPriceCents - competitorCents) / competitorCents) * 100;
    return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
  };

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Stat label="Market average" value={data.stats ? formatCents(data.stats.avgCents) : "—"} />
        <Stat label="Lowest" value={data.stats ? formatCents(data.stats.minCents) : "—"} />
        <Stat label="Highest" value={data.stats ? formatCents(data.stats.maxCents) : "—"} />
        <Stat label="Your price vs average" value={vs(data.stats?.avgCents ?? null)} />
      </div>
      <div className="mv-table-wrap">
        <table className="mv-table">
          <thead><tr><th>Competitor</th><th>Price</th><th>Your price vs theirs</th><th>Checked</th><th>Status</th></tr></thead>
          <tbody>
            {data.competitors.map((competitor) => {
              const spike = competitor.flag === "out_of_band";
              const review = competitor.flag === "low_confidence";
              return (
                <tr key={competitor.id}>
                  <td><a href={competitor.url} target="_blank" rel="noreferrer">{competitor.competitorName}</a></td>
                  <td className="mono">{competitor.priceCents === null ? "No price yet" : formatCents(competitor.priceCents, competitor.currency ?? "USD")}</td>
                  <td className="mono">{vs(competitor.priceCents)}</td>
                  <td style={{ color: MUTED, fontSize: 12 }}>{competitor.observedAt ? new Date(competitor.observedAt).toLocaleString() : "Never"}</td>
                  <td>
                    {spike ? <span className="pill warn"><span className="dot" />Price spike (ignored)</span>
                      : review ? <span className="pill warn"><span className="dot" />Needs review (ignored)</span>
                      : competitor.priceCents === null ? <span className="pill info"><span className="dot" />Pending</span>
                      : <span className="pill ok"><span className="dot" />Normal</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: MUTED, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
