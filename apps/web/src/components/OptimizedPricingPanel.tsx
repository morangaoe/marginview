import React, { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MARKUP_PERCENT,
  DEFAULT_PRICING_WEIGHTS,
  apiJson,
  formatCents,
  type OptimizedPricingResponse,
  type PricingWeights,
} from "../types/inventory";
import { api } from "../api/client";
import { dollarsToCents } from "../utils/csvParser";
import { useAuth } from "../auth/AuthContext";
import { useMv } from "../lib/mv";
import { ApplyPriceBar } from "./ApplyPriceBar";
import { CompetitorContext, type PricingContext } from "./CompetitorContext";
import { PriceBreakdown } from "./PriceBreakdown";

interface Props {
  variantId: string;
  costCents: number;
  /** Current selling price in cents, or null. Used for the before/after view. */
  currentPriceCents?: number | null;
  /** Called after a price is applied or undone, so the parent can refetch. */
  onChanged?: () => void;
}

const BORDER = "var(--mv-border, rgba(255,255,255,0.12))";
const MUTED = "var(--mv-muted, #8fa396)";
const ACCENT = "var(--mv-accent, #3fae7a)";
const WARN = "var(--mv-warning, #d9a441)";
const DANGER = "var(--mv-danger, #e5735f)";

const LABELS: Record<keyof PricingWeights, string> = {
  cost_plus: "Cost plus",
  value_based: "Value based",
  keystone: "Keystone",
  dynamic: "Dynamic",
};

type Keys = keyof PricingWeights;
type Baseline = { price_cents: number; margin_percent: number; warning?: string | null };

const marginOf = (price: number, cost: number) => (price > 0 ? ((price - cost) / price) * 100 : 0);

export function OptimizedPricingPanel({ variantId, costCents, currentPriceCents = null, onChanged }: Props) {
  const [weights, setWeights] = useState<PricingWeights>(DEFAULT_PRICING_WEIGHTS);
  const [markup, setMarkup] = useState(String(DEFAULT_MARKUP_PERCENT));
  const [valueBased, setValueBased] = useState(((costCents * 2.6) / 100).toFixed(2));
  const [position, setPosition] = useState("0");
  const [minMargin, setMinMargin] = useState("10");
  const [adaptive, setAdaptive] = useState(true);
  const [result, setResult] = useState<OptimizedPricingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);
  const { user } = useAuth();
  const canApply = user?.role === "owner" || user?.role === "pricing_manager";
  const ctx = useMv<PricingContext>(`/api/pricing/${variantId}/context`);

  // AI weight advisor
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRec, setAiRec] = useState<{ weights: PricingWeights; confidence: string; reasoning: string; risks: string[] } | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);

  async function suggest() {
    setAiBusy(true); setAiErr(null);
    try { setAiRec(await api.post(`/ai/weights/${variantId}`)); }
    catch (e) { setAiErr(e instanceof Error ? e.message : "Could not get a suggestion."); }
    finally { setAiBusy(false); }
  }

  // Reset the editable price points when a different variant is selected.
  useEffect(() => {
    setValueBased(((costCents * 2.6) / 100).toFixed(2));
    setNotice(null);
  }, [variantId, costCents]);

  // Debounced so dragging a slider doesn't send a request per pixel.
  useEffect(() => {
    const vb = dollarsToCents(valueBased);
    const markupNum = Number(markup);
    const positionNum = Number(position);
    const minMarginNum = Number(minMargin);
    if (
      vb === null || !Number.isFinite(markupNum) || markupNum < 0 ||
      !Number.isFinite(positionNum) || positionNum < -50 || positionNum > 50 ||
      !Number.isFinite(minMarginNum) || minMarginNum < 0 || minMarginNum > 95
    ) {
      setError("Check inputs: markup 0 or more, market position -50 to 50, minimum margin 0 to 95.");
      return;
    }
    setError(null);
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiJson<OptimizedPricingResponse>(`/api/pricing/${variantId}/optimized`, {
          method: "POST",
          body: JSON.stringify({
            weights,
            markup_percent: markupNum,
            value_based_cents: vb,
            dynamic_position_pct: positionNum,
            min_margin_pct: minMarginNum,
            adaptive,
          }),
        });
        if (id === seq.current) setResult(res);
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : "Could not calculate price.");
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [variantId, weights, markup, valueBased, position, minMargin, adaptive]);

  const markupNum = Number(markup);
  const targetMargin = Number.isFinite(markupNum) && markupNum >= 0 ? (markupNum / (100 + markupNum)) * 100 : 0;

  const newPrice = result?.optimized_price_cents ?? null;
  const effectiveCurrentPrice = ctx.data?.currentPriceCents ?? currentPriceCents;
  const marginBefore = effectiveCurrentPrice ? marginOf(effectiveCurrentPrice, costCents) : null;
  const marginAfter = newPrice ? marginOf(newPrice, costCents) : null;
  const changePct = effectiveCurrentPrice && newPrice ? ((newPrice - effectiveCurrentPrice) / effectiveCurrentPrice) * 100 : null;

  // Engine warnings, shown instead of dropped.
  const warnings = result
    ? (Object.keys(LABELS) as Keys[])
        .map((k) => ({ key: k, text: (result.baselines[k] as Baseline).warning ?? null }))
        .filter((w) => w.text)
    : [];

  async function undo() {
    setWorking(true);
    setNotice(null);
    try {
      const r = await apiJson<{ restored_price_cents: number }>(`/api/pricing/${variantId}/undo`, { method: "POST" });
      setNotice(`Restored the previous price (${formatCents(r.restored_price_cents)}).`);
      ctx.reload();
      onChanged?.();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not undo the change.");
    } finally {
      setWorking(false);
    }
  }

  const field: React.CSSProperties = {
    background: "var(--mv-field, #0c120f)",
    color: "var(--mv-text, #e8efe9)",
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    padding: "6px 8px",
    width: 110,
  };
  const stat = { fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums" as const };
  const small = { color: MUTED, fontSize: 13 };
  const btn: React.CSSProperties = {
    background: "transparent",
    color: "inherit",
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    padding: "8px 16px",
    cursor: "pointer",
  };
  return (
    <section style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, color: MUTED }}>
          Markup %<br />
          <input style={field} inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} />
        </label>
        <label style={{ fontSize: 13, color: MUTED }}>
          Value-based price ($)<br />
          <input style={field} inputMode="decimal" value={valueBased} onChange={(e) => setValueBased(e.target.value)} />
        </label>
        <label style={{ fontSize: 13, color: MUTED }}>
          Market position %<br />
          <input style={field} inputMode="decimal" value={position} onChange={(e) => setPosition(e.target.value)} title="Relative to the competitor median. Negative undercuts." />
        </label>
        <label style={{ fontSize: 13, color: MUTED }}>
          Min margin % (dynamic)<br />
          <input style={field} inputMode="decimal" value={minMargin} onChange={(e) => setMinMargin(e.target.value)} />
        </label>
        <label style={{ fontSize: 13, color: MUTED, alignSelf: "end", display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={adaptive} onChange={(e) => setAdaptive(e.target.checked)} />
          Adapt weights to data
        </label>
      </div>

      {/* AI weight suggestion */}
      <div style={{ display: "grid", gap: 8 }}>
        <div className="mv-row">
          <button type="button" className="mv-btn" onClick={suggest} disabled={aiBusy || !canApply}>
            {aiBusy ? "Analyzing…" : "✨ Suggest weights with AI"}
          </button>
          {!canApply && <span className="mv-muted">Owners and pricing managers only.</span>}
        </div>
        {aiErr && <p className="mv-err" role="alert">{aiErr}</p>}
        {aiRec && (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14, display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13 }}>
              Suggested: {(Object.keys(LABELS) as (keyof PricingWeights)[]).map((k) => `${LABELS[k]} ${aiRec.weights[k]}%`).join(" · ")}
              <span className="pill info" style={{ marginLeft: 8 }}>{aiRec.confidence} confidence</span>
            </div>
            <div style={{ fontSize: 13, color: MUTED }}>{aiRec.reasoning}</div>
            {aiRec.risks.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: MUTED }}>{aiRec.risks.map((r) => <li key={r}>{r}</li>)}</ul>}
            <div><button type="button" className="mv-btn primary" onClick={() => { setWeights(aiRec.weights); setAiRec(null); }}>Use these weights</button></div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {(Object.keys(LABELS) as Keys[]).map((key) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "110px 1fr 96px 90px", alignItems: "center", gap: 12 }}>
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
            <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {weights[key]}
              {result && <b style={{ color: ACCENT }}> → {result.weights_effective[key].toFixed(0)}%</b>}
            </span>
            <span style={{ textAlign: "right", color: MUTED, fontVariantNumeric: "tabular-nums" }}>
              {result ? formatCents((result.baselines[key] as Baseline).price_cents) : "—"}
            </span>
          </div>
        ))}
        <div style={{ fontSize: 13, color: MUTED }}>
          Sliders are relative. The green figure is each strategy's real share of the final price.
        </div>
      </div>

      {/* Before and after */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 20, display: "grid", gap: 16, opacity: loading ? 0.7 : 1 }}>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <div>
            <div style={small}>Current price</div>
            <div style={stat}>{effectiveCurrentPrice !== null ? formatCents(effectiveCurrentPrice) : "Not set"}</div>
          </div>
          <div>
            <div style={small}>Optimized price</div>
            <div style={stat}>{newPrice !== null ? formatCents(newPrice) : "—"}</div>
          </div>
          <div>
            <div style={small}>Price change</div>
            <div style={stat}>
              {changePct !== null ? `${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <div>
            <div style={small}>Margin before</div>
            <div style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>
              {marginBefore !== null ? `${marginBefore.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div>
            <div style={small}>Margin after</div>
            <div style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>
              {marginAfter !== null ? `${marginAfter.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div>
            <div style={small}>Cost</div>
            <div style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{formatCents(costCents)}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={undo} disabled={working} style={btn}>
            Undo last change
          </button>
        </div>
        {notice && <div role="status" style={small}>{notice}</div>}
      </div>

      {result && <PriceBreakdown result={result} />}
      {ctx.error && <div role="alert" style={{ color: DANGER, fontSize: 13 }}>{ctx.error}</div>}
      {ctx.data && <CompetitorContext data={ctx.data} yourPriceCents={newPrice ?? ctx.data.currentPriceCents} />}
      <ApplyPriceBar
        variantId={variantId}
        costCents={costCents}
        currentPriceCents={ctx.data?.currentPriceCents ?? currentPriceCents}
        newPriceCents={newPrice}
        targetMarginPct={targetMargin}
        canApply={canApply}
        disabled={loading || !!error || !result}
        onApplied={() => { ctx.reload(); onChanged?.(); }}
      />

      {warnings.length > 0 && (
        <div role="note" style={{ border: `1px solid ${WARN}`, borderRadius: 8, padding: 12, display: "grid", gap: 6, fontSize: 13 }}>
          <strong style={{ color: WARN }}>Check before applying</strong>
          {warnings.map((w) => (
            <div key={w.key}>
              {LABELS[w.key]}: {w.text}
            </div>
          ))}
        </div>
      )}

      {error && <div role="alert" style={{ color: DANGER, fontSize: 13 }}>{error}</div>}
    </section>
  );
}