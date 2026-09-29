export interface InventorySnapshot {
  productVariantId: string;
  locationId: string;
  onHand: number;
  reorderPoint: number;
  reorderQuantity: number;
  avgDailySales: number; // sales velocity, units/day
  leadTimeDays: number;
}

export interface SuggestionReason {
  daysOfCover: number | null;
  belowReorderPoint: boolean;
  leadTimeDays: number;
}

export interface Suggestion {
  productVariantId: string;
  locationId: string;
  suggestedQuantity: number;
  reason: SuggestionReason;
}

/**
 * Phase 1 logic: flag anything at or below its reorder point. Phase 2 (per
 * the Implementation Plan) upgrades this to weigh velocity, lead time, and
 * margin more heavily; the shape of `reason` is already there so the UI
 * does not need to change when that lands.
 */
export function generateSuggestions(levels: InventorySnapshot[]): Suggestion[] {
  return levels
    .filter((l) => l.onHand <= l.reorderPoint)
    .map((l) => {
      const daysOfCover = l.avgDailySales > 0 ? Math.round(l.onHand / l.avgDailySales) : null;
      return {
        productVariantId: l.productVariantId,
        locationId: l.locationId,
        suggestedQuantity: Math.max(l.reorderQuantity, 1),
        reason: {
          daysOfCover,
          belowReorderPoint: true,
          leadTimeDays: l.leadTimeDays,
        },
      };
    })
    .sort((a, b) => (a.reason.daysOfCover ?? 0) - (b.reason.daysOfCover ?? 0));
}
