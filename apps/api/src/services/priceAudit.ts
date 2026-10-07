import { marginFor } from "./pricingStrategies";

export interface AuditInputRow {
  sku: string;
  name: string;
  costCents: number;
  priceCents: number | null;
  quantity: number;
}

export type AuditStatus = "healthy" | "below_target" | "thin" | "loss" | "no_price";

export interface AuditRow extends AuditInputRow {
  marginPct: number | null;
  status: AuditStatus;
  /** Cost-plus price that reaches the target margin. */
  targetPriceCents: number;
  /** Extra revenue per unit at the target price; 0 when already at or above it. */
  gapPerUnitCents: number;
}

export interface AuditReport {
  targetMarginPct: number;
  thinMarginPct: number;
  totals: { skus: number; priced: number; noPrice: number; healthy: number; belowTarget: number; thin: number; loss: number };
  /** Average margin across priced SKUs, weighted equally. */
  avgMarginPct: number | null;
  /** Sum of per-unit gaps across SKUs below target. */
  gapPerUnitCents: number;
  /** Gap multiplied by stock on hand; null when no stock quantities were given. */
  gapOnHandCents: number | null;
  /** Worst offenders first: losses, then the largest per-unit gap. */
  rows: AuditRow[];
}

export const AUDIT_MAX_ROWS = 500;

export function auditCatalog(input: AuditInputRow[], opts: { targetMarginPct?: number; thinMarginPct?: number } = {}): AuditReport {
  const targetMarginPct = Math.min(Math.max(opts.targetMarginPct ?? 40, 1), 95);
  const thinMarginPct = Math.min(opts.thinMarginPct ?? 20, targetMarginPct);

  const rows: AuditRow[] = input.map((r) => {
    const targetPriceCents = Math.round(r.costCents / (1 - targetMarginPct / 100));
    if (r.priceCents === null) {
      return { ...r, marginPct: null, status: "no_price", targetPriceCents, gapPerUnitCents: 0 };
    }
    const marginPct = marginFor(r.priceCents, r.costCents);
    const status: AuditStatus =
      r.priceCents <= r.costCents ? "loss"
      : marginPct < thinMarginPct ? "thin"
      : marginPct < targetMarginPct ? "below_target"
      : "healthy";
    return { ...r, marginPct, status, targetPriceCents, gapPerUnitCents: Math.max(0, targetPriceCents - r.priceCents) };
  });

  const count = (s: AuditStatus) => rows.filter((r) => r.status === s).length;
  const priced = rows.filter((r) => r.marginPct !== null);
  const hasStock = rows.some((r) => r.quantity > 0);

  rows.sort((a, b) => {
    const rank = (r: AuditRow) => (r.status === "loss" ? 0 : r.status === "no_price" ? 2 : 1);
    return rank(a) - rank(b) || b.gapPerUnitCents - a.gapPerUnitCents;
  });

  return {
    targetMarginPct,
    thinMarginPct,
    totals: {
      skus: rows.length, priced: priced.length, noPrice: count("no_price"),
      healthy: count("healthy"), belowTarget: count("below_target"), thin: count("thin"), loss: count("loss"),
    },
    avgMarginPct: priced.length ? Math.round((priced.reduce((s, r) => s + r.marginPct!, 0) / priced.length) * 10) / 10 : null,
    gapPerUnitCents: rows.reduce((s, r) => s + r.gapPerUnitCents, 0),
    gapOnHandCents: hasStock ? rows.reduce((s, r) => s + r.gapPerUnitCents * r.quantity, 0) : null,
    rows,
  };
}
