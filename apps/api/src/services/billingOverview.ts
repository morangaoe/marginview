import { query } from "../db/pool";

export interface BillingOverview {
  organization: string;
  inviteCode: string | null;
  planName: string;
  credits: { total: number; used: number; remaining: number };
  creditsEnforced: boolean;
  upgradeOptions: Array<{
    id: string; name: string; tracked_sources_included: number | null;
    price_cents_monthly: number | null; starting_floor_cents_monthly?: number; billing: string;
  }>;
}

export async function getBillingOverview(organizationId: string, userId?: string): Promise<BillingOverview> {
  const [org] = await query<{ name: string; invite_code: string | null; total: number; used: number }>(
    `select name, invite_code, scraping_credits_total as total, scraping_credits_used as used
       from organizations where id = $1`,
    [organizationId],
  );
  const [sub] = await query<{ plan_name: string }>(
    `select p.name as plan_name from subscriptions s join plans p on p.id = s.plan_id
      where s.organization_id = $1 order by s.current_period_end desc nulls last limit 1`,
    [organizationId],
  );
  const plans = await query<{ id: string; name: string; pricing_model: any }>(
    "select id, name, pricing_model from plans order by (pricing_model->>'price_cents_monthly')::int nulls last",
  );
  let isOwner = false;
  if (userId) {
    const r = await query(
      "select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 and r.name = 'owner' limit 1",
      [userId],
    );
    isOwner = r.length > 0;
  }
  return {
    organization: org.name,
    inviteCode: isOwner ? org.invite_code : null, // only owners see the invite code
    planName: sub?.plan_name ?? "Starter",
    credits: { total: org.total, used: org.used, remaining: Math.max(org.total - org.used, 0) },
    creditsEnforced: process.env.ENFORCE_SCRAPING_CREDITS === "true",
    upgradeOptions: plans.map((p) => ({ id: p.id, name: p.name, ...p.pricing_model })),
  };
}
