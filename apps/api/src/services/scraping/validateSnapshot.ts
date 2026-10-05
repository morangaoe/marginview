/**
 * Is a newly extracted price plausible given the last known price?
 *  - ok            : within 40% of the last known price, or no prior price
 *  - out_of_band   : more than 40% change. Stored, never auto-applied.
 *  - low_confidence: a medium-confidence extraction more than 20% off
 */
import type { Confidence } from "../scraper/priceExtractor";

export type ValidationFlag = "ok" | "out_of_band" | "low_confidence";

const OUT_OF_BAND_THRESHOLD = 0.4;
const LOW_CONFIDENCE_THRESHOLD = 0.2;

export function validateSnapshot(
  result: { priceCents: number; confidence?: Confidence },
  lastKnownCents: number | null,
): ValidationFlag {
  if (lastKnownCents === null || lastKnownCents === 0) return "ok";
  const change = Math.abs(result.priceCents - lastKnownCents) / lastKnownCents;
  if (change > OUT_OF_BAND_THRESHOLD) return "out_of_band";
  if (result.confidence === "medium" && change > LOW_CONFIDENCE_THRESHOLD) return "low_confidence";
  return "ok";
}