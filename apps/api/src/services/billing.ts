import { pool, query } from "../db/pool";

export interface PlanUsage {
  planName: string;
  trackedSourcesUsed: number;
  trackedSourcesIncluded: number | null; // null means custom/unmetered (Scale)
  nudge: { level: "none" | "approaching" | "over"; message: string } | null;
  trialActivatedAt: string | null;
  status: string;
}

/**
 * Counts real usage against the value metric (tracked competitor sources,
 * per Pricing & Packaging Strategy section 2) and returns a soft-nudge
 * message rather than a hard block, per section 7's risk mitigation: we
 * show the customer what they are giving up, we do not lock them out.
 */
export async function getPlanUsage(organizationId: string): Promise<PlanUsage> {
  const [sub] = await query<{
    plan_name: string;
    pricing_model: { tracked_sources_included: number | null };
    status: string;
    trial_activated_at: string | null;
  }>(
    `select p.name as plan_name, p.pricing_model, s.status, s.trial_activated_at
     from subscriptions s
     join plans p on p.id = s.plan_id
     where s.organization_id = $1
     order by s.current_period_end desc nulls last
     limit 1`,
    [organizationId]
  );

  // No subscription row yet (a brand-new org before checkout): treat as
  // Starter-equivalent so the UI has something sensible to show.
  const planName = sub?.plan_name ?? "Starter (not yet subscribed)";
  const included = sub?.pricing_model?.tracked_sources_included ?? 15;

  const [{ count }] = await query<{ count: string }>(
    `select count(*)::text as count from scraping_sources where organization_id = $1`,
    [organizationId]
  );
  const used = parseInt(count, 10);

  let nudge: PlanUsage["nudge"] = null;
  if (included !== null) {
    if (used >= included) {
      nudge = {
        level: "over",
        message: `You're tracking ${used} of ${included} sources included in ${planName}. New sources beyond this may affect price-check reliability until you move to the next tier.`,
      };
    } else if (used >= included * 0.8) {
      nudge = {
        level: "approaching",
        message: `You're tracking ${used} of ${included} sources included in ${planName}. Worth knowing before you add many more.`,
      };
    }
  }

  return {
    planName,
    trackedSourcesUsed: used,
    trackedSourcesIncluded: included,
    nudge,
    trialActivatedAt: sub?.trial_activated_at ?? null,
    status: sub?.status ?? "trialing",
  };
}

/**
 * Called from the scraping pipeline (Phase 2, per the Implementation Plan)
 * the first time a job for this organization succeeds. Idempotent: does
 * nothing if the trial clock has already started.
 */
export async function activateTrialIfNeeded(organizationId: string): Promise<void> {
  await pool.query(
    `update subscriptions
     set trial_activated_at = now()
     where organization_id = $1 and trial_activated_at is null and status = 'trialing'`,
    [organizationId]
  );
}
