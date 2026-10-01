import React, { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MARKUP_PERCENT,
  DEFAULT_PRICING_WEIGHTS,
  apiJson,
  formatCents,
  type OptimizedPricingResponse,
  type PricingWeights,
} from "../types/inventory";
import { dollarsToCents } from "../utils/csvParser";

interface Props {
  variantId: string;
  costCents: number;
}

const BORDER = "var(--mv-border, rgba(255,255,255,0.12))";
const MUTED = "var(--mv-muted, #8fa396)";
const ACCENT = "var(--mv-accent, #3fae7a)";

const LABELS: Record<keyof PricingWeights, string> = {
  cost_plus: "Cost plus",
  value_based: "Value based",
  keystone: "Keystone",
  dynamic: "Dynamic",
};

export function OptimizedPricingPanel({ variantId, costCents }: Props) {
  const [weights, setWeights] = useState<PricingWeights>(DEFAULT_PRICING_WEIGHTS);
  const [markup, setMarkup] = useState(String(DEFAULT_MARKUP_PERCENT));
  const [valueBased, setValueBased] = useState((costCents * 2.6 / 100).toFixed(2));
  const [dynamic, setDynamic] = useState((costCents * 2.2 / 100).toFixed(2));
  const [result, setResult] = useState<OptimizedPricingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  // Reset the editable price points when a different variant is selected.
  useEffect(() => {
    setValueBased((costCents * 2.6 / 100).toFixed(2));
    setDynamic((costCents * 2.2 / 100).toFixed(2));
  }, [variantId, costCents]);

  // Debounced call so dragging a slider doesn't fire a request per pixel.
  useEffect(() => {
    const vb = dollarsToCents(valueBased);
    const dyn = dollarsToCents(dynamic);
    const markupNum = Number(markup);
    if (vb === null || dyn === null || !Number.isFinite(markupNum) || markupNum < 0) {
      setError("Enter valid prices and a markup of 0 or more.");
      return;
    }
    setError(null);
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiJson<OptimizedPricingResponse>(`/api/pricing/${variantId}/optimized`, {
          method: "POST",
          body: JSON.stringify({ weights, markup_percent: markupNum, value_based_cents: vb, dynamic_cents: dyn }),
        });
        if (id === seq.current) setResult(res);
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : "Could not calculate price.");
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [variantId, weights, markup, valueBased, dynamic]);

  const total = weights.cost_plus + weights.value_based + weights.keystone + weights.dynamic;
  const balanced = Math.abs(total - 100) < 0.01;

  const field: React.CSSProperties = {
    background: "var(--mv-field, #0c120f)",
    color: "var(--mv-text, #e8efe9)",
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    padding: "6px 8px",
    width: 110,
  };

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, color: MUTED }}>Markup %<br /><input style={field} inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} /></label>
        <label style={{ fontSize: 13, color: MUTED }}>Value-based price ($)<br /><input style={field} inputMode="decimal" value={valueBased} onChange={(e) => setValueBased(e.target.value)} /></label>
        <label style={{ fontSize: 13, color: MUTED }}>Dynamic price ($)<br /><input style={field} inputMode="decimal" value={dynamic} onChange={(e) => setDynamic(e.target.value)} /></label>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {(Object.keys(LABELS) as (keyof PricingWeights)[]).map((key) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "110px 1fr 56px 90px", alignItems: "center", gap: 12 }}>
            <label htmlFor={`w-${key}`} style={{ fontSize: 14 }}>{LABELS[key]}</label>
            <input
              id={`w-${key}`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={weights[key]}
              onChange={(e) => setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))}
              style={{ accentColor: "#3fae7a" }}
            />
            <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{weights[key]}%</span>
            <span style={{ textAlign: "right", color: MUTED, fontVariantNumeric: "tabular-nums" }}>
              {result ? formatCents(result.baselines[key].price_cents) : "—"}
            </span>
          </div>
        ))}
        <div style={{ fontSize: 13, color: balanced ? ACCENT : "var(--mv-warning, #d9a441)" }}>
          Weights total {total}%{balanced ? "" : ". Not 100%, so they are scaled proportionally when blending."}
        </div>
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20, display: "flex", gap: 32, flexWrap: "wrap", opacity: loading ? 0.7 : 1 }}>
        <div>
          <div style={{ color: MUTED, fontSize: 13 }}>Optimized price</div>
          <div style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {result ? formatCents(result.optimized_price_cents) : "—"}
          </div>
        </div>
        <div>
          <div style={{ color: MUTED, fontSize: 13 }}>Margin</div>
          <div style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {result ? `${result.margin_percent.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div>
          <div style={{ color: MUTED, fontSize: 13 }}>Cost</div>
          <div style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatCents(costCents)}</div>
        </div>
      </div>

      {error && <div role="alert" style={{ color: "var(--mv-danger, #e5735f)", fontSize: 13 }}>{error}</div>}
    </section>
  );
}
