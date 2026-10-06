import { useState } from "react";
import { mv } from "../lib/mv";
import { formatCents } from "../types/inventory";

interface Props {
  variantId: string;
  costCents: number;
  currentPriceCents: number | null;
  newPriceCents: number | null;
  targetMarginPct: number;
  canApply: boolean;
  disabled?: boolean;
  onApplied: () => void;
}

const BORDER = "var(--mv-border, rgba(255,255,255,0.12))";

export function ApplyPriceBar({
  variantId, costCents, currentPriceCents, newPriceCents, targetMarginPct, canApply, disabled, onApplied,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (newPriceCents === null) return null;

  const margin = newPriceCents > 0 ? ((newPriceCents - costCents) / newPriceCents) * 100 : 0;
  const belowCost = newPriceCents <= costCents;
  const belowTarget = !belowCost && margin < targetMarginPct - 0.05;
  const change = currentPriceCents !== null && currentPriceCents > 0
    ? ((newPriceCents - currentPriceCents) / currentPriceCents) * 100
    : null;
  const bigMove = change !== null && Math.abs(change) > 20;
  const unchanged = currentPriceCents === newPriceCents;
  const needsAck = belowCost || belowTarget || bigMove;

  const warnings: { tone: "crit" | "warn"; text: string }[] = [];
  if (belowCost) warnings.push({ tone: "crit", text: `This price is at or below your cost of ${formatCents(costCents)}. You would lose money on every sale.` });
  if (belowTarget) warnings.push({ tone: "warn", text: `Margin is ${margin.toFixed(1)}%, below your ${targetMarginPct.toFixed(1)}% target (from the markup above).` });
  if (bigMove) warnings.push({ tone: "warn", text: `This moves the price ${change! > 0 ? "up" : "down"} ${Math.abs(change!).toFixed(0)}% in one step.` });

  async function apply() {
    const priceToApply = newPriceCents;
    if (priceToApply === null) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await mv("POST", `/api/pricing/${variantId}/apply`, {
        price_cents: priceToApply,
        strategy: "blended",
        margin_after_pct: margin,
        allow_below_cost: belowCost && ack,
      });
      setDone(`Price updated to ${formatCents(priceToApply)}.`);
      setAck(false);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the price.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "var(--mv-muted, #8fa396)", fontSize: 12 }}>Current price</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{currentPriceCents === null ? "Not set" : formatCents(currentPriceCents)}</div>
        </div>
        <span aria-hidden>→</span>
        <div>
          <div style={{ color: "var(--mv-muted, #8fa396)", fontSize: 12 }}>New price</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>
            {formatCents(newPriceCents)}
            {change !== null && !unchanged && (
              <span style={{ fontSize: 13, marginLeft: 8, color: change > 0 ? "var(--success)" : "var(--critical)" }}>
                {change > 0 ? "+" : ""}{change.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {warnings.map((warning) => (
        <div key={warning.text} role="alert" className={`pill ${warning.tone}`} style={{ borderRadius: 8, padding: "8px 10px", whiteSpace: "normal" }}>
          {warning.text}
        </div>
      ))}

      {needsAck && canApply && !unchanged && (
        <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I've reviewed the warning{warnings.length > 1 ? "s" : ""} and want to apply this price.
        </label>
      )}

      {error && <div role="alert" style={{ color: "var(--critical)", fontSize: 13 }}>{error}</div>}
      {done && <div role="status" style={{ color: "var(--success)", fontSize: 13 }}>{done}</div>}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="mv-btn primary"
          disabled={!canApply || disabled || busy || unchanged || (needsAck && !ack)}
          onClick={() => void apply()}
        >
          {busy ? "Applying…" : "Apply price"}
        </button>
        {!canApply && <span className="mv-muted">Only owners and pricing managers can apply prices.</span>}
        {canApply && unchanged && <span className="mv-muted">Already your current price.</span>}
      </div>
    </div>
  );
}
