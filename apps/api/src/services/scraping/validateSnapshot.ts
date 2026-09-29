/**
 * Snapshot validator: checks whether a newly extracted price is plausible
 * given what we last saw. Per TRD section 4 step 4:
 *
 *  - ok           : within 40% of last known price, or no prior price
 *  - out_of_band  : > 40% change — stored but flagged, never auto-applied
 *  - low_confidence: extractor returned a price but said confidence was "medium"
 *    and the price is more than 20% off from last known
 */

import { ExtractResult } from "./extractPrice";

export type ValidationFlag = "ok" | "out_of_band" | "low_confidence";

const OUT_OF_BAND_THRESHOLD = 0.40; // 40% change
const LOW_CONFIDENCE_THRESHOLD = 0.20;

export function validateSnapshot(
  result: ExtractResult,
  lastKnownCents: number | null
): ValidationFlag {
  if (result.priceCents === null) return "low_confidence";

  if (lastKnownCents === null || lastKnownCents === 0) return "ok";

  const changeFraction = Math.abs(result.priceCents - lastKnownCents) / lastKnownCents;

  if (changeFraction > OUT_OF_BAND_THRESHOLD) return "out_of_band";

  if (result.confidence === "medium" && changeFraction > LOW_CONFIDENCE_THRESHOLD) {
    return "low_confidence";
  }

  return "ok";
}
