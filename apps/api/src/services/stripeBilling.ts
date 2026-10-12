import Stripe from "stripe";
import { pool, query } from "../db/pool";
import { HttpError } from "../utils/http";
import { isTier, type Tier } from "./plans";

export type Interval = "month" | "year";

/** Matches ANNUAL_DISCOUNT in apps/web/src/plan/plans.ts. */
export const ANNUAL_DISCOUNT = 0.2;

let client: Stripe | null = null;

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new HttpError(503, "Online payments are not configured.");
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY));
}

function appUrl(): string {
  return (process.env.APP_URL ?? process.env.FRONTEND_URL?.split(",")[0] ?? "http://localhost:5173").trim().replace(/\/$/, "");
}

/** Recurring unit amount in cents. Annual is 12 months less the annual discount. */
export function unitAmountCents(monthlyCents: number, interval: Interval): number {
  return interval === "year" ? Math.round(monthlyCents * 12 * (1 - ANNUAL_DISCOUNT)) : monthlyCents;
}

/** Maps Stripe's subscription status onto our check constraint; null means "ignore this state". */
export function mapStatus(status: Stripe.Subscription.Status): "active" | "past_due" | "canceled" | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null; // "incomplete": checkout not finished yet
  }
}

async function getOrCreateCustomer(organizationId: string, email?: string): Promise<string> {
  const [org] = await query<{ name: string; stripe_customer_id: string | null }>(
    "select name, stripe_customer_id from organizations where id = $1",
    [organizationId],
  );
  if (!org) throw new HttpError(404, "Workspace not found.");
  if (org.stripe_customer_id) return org.stripe_customer_id;

  const customer = await stripe().customers.create(
    { name: org.name, email, metadata: { organization_id: organizationId } },
    { idempotencyKey: `customer-${organizationId}` },
  );
  // Only set if still empty, so two concurrent requests converge on one customer.
  const [row] = await query<{ stripe_customer_id: string }>(
    `update organizations set stripe_customer_id = coalesce(stripe_customer_id, $2)
      where id = $1 returning stripe_customer_id`,
    [organizationId, customer.id],
  );
  return row.stripe_customer_id;
}

export async function createCheckoutSession(opts: {
  organizationId: string;
  email?: string;
  tier: Tier;
  interval: Interval;
}): Promise<string> {
  const [plan] = await query<{ id: string; name: string; pricing_model: { price_cents_monthly: number | null; billing?: string } }>(
    "select id, name, pricing_model from plans where pricing_model->>'tier' = $1",
    [opts.tier],
  );
  const monthly = plan?.pricing_model?.price_cents_monthly;
  if (!plan || !monthly || plan.pricing_model.billing !== "self_serve") {
    throw new HttpError(400, "This plan is not available for self-serve checkout. Contact sales.");
  }

  const [current] = await query<{ status: string; stripe_subscription_id: string | null }>(
    `select status, stripe_subscription_id from subscriptions
      where organization_id = $1 order by current_period_end desc nulls last limit 1`,
    [opts.organizationId],
  );
  if (current?.stripe_subscription_id && current.status !== "canceled") {
    throw new HttpError(409, "You already have a subscription. Use Manage billing to change plan.");
  }

  const customer = await getOrCreateCustomer(opts.organizationId, opts.email);
  const metadata = { organization_id: opts.organizationId, tier: opts.tier, interval: opts.interval };
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: opts.organizationId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: unitAmountCents(monthly, opts.interval),
          recurring: { interval: opts.interval },
          product_data: { name: `Marginview ${plan.name}` },
        },
      },
    ],
    subscription_data: { metadata },
    metadata,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    success_url: `${appUrl()}/billing?checkout=success`,
    cancel_url: `${appUrl()}/billing?checkout=canceled`,
  });
  if (!session.url) throw new HttpError(502, "Could not start checkout. Try again.");
  return session.url;
}

export async function createPortalSession(organizationId: string): Promise<string> {
  const [org] = await query<{ stripe_customer_id: string | null }>(
    "select stripe_customer_id from organizations where id = $1",
    [organizationId],
  );
  if (!org?.stripe_customer_id) throw new HttpError(400, "No billing account yet. Choose a plan first.");
  const session = await stripe().billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${appUrl()}/billing`,
  });
  return session.url;
}

/** Upserts the org's single subscription row from a Stripe subscription. */
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const status = mapStatus(sub.status);
  if (!status) return;

  let organizationId = sub.metadata?.organization_id;
  if (!organizationId) {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const [org] = await query<{ id: string }>("select id from organizations where stripe_customer_id = $1", [customerId]);
    organizationId = org?.id;
  }
  if (!organizationId) {
    console.warn(`[stripe] subscription ${sub.id} has no matching organization`);
    return;
  }

  // The plan comes from our own metadata at checkout; if the customer switched
  // plans in the portal we don't offer that, so the tier on the row stays put.
  const tier = sub.metadata?.tier;
  const item = sub.items.data[0];
  const interval: Interval = item?.price.recurring?.interval === "year" ? "year" : "month";
  // Newer Stripe API versions put the period on the item, older ones on the subscription.
  const periodEndUnix = (item as any)?.current_period_end ?? (sub as any).current_period_end;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: existing } = await client.query<{ id: string; plan_id: string }>(
      `select id, plan_id from subscriptions where organization_id = $1
        order by (stripe_subscription_id = $2) desc nulls last, current_period_end desc nulls last
        limit 1 for update`,
      [organizationId, sub.id],
    );
    let planId = existing[0]?.plan_id;
    if (isTier(tier)) {
      const { rows } = await client.query<{ id: string }>("select id from plans where pricing_model->>'tier' = $1", [tier]);
      planId = rows[0]?.id ?? planId;
    }
    if (!planId) {
      console.warn(`[stripe] subscription ${sub.id}: cannot resolve a plan`);
      await client.query("rollback");
      return;
    }
    const cancelAtEnd = sub.cancel_at_period_end || sub.cancel_at != null;
    if (existing[0]) {
      await client.query(
        `update subscriptions
            set plan_id = $2, status = $3, stripe_subscription_id = $4, billing_interval = $5,
                cancel_at_period_end = $6, current_period_end = $7
          where id = $1`,
        [existing[0].id, planId, status, sub.id, interval, cancelAtEnd, periodEnd],
      );
    } else {
      await client.query(
        `insert into subscriptions
           (organization_id, plan_id, status, stripe_subscription_id, billing_interval, cancel_at_period_end, current_period_end)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [organizationId, planId, status, sub.id, interval, cancelAtEnd, periodEnd],
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function recordInvoice(invoice: Stripe.Invoice, status: "paid" | "open"): Promise<void> {
  const subId = (invoice as any).subscription ?? invoice.parent?.subscription_details?.subscription;
  const stripeSubId = typeof subId === "string" ? subId : subId?.id;
  if (!stripeSubId || !invoice.id) return;
  await query(
    `insert into invoices (subscription_id, amount_cents, status, stripe_invoice_id, hosted_invoice_url, currency)
     select s.id, $2, $3, $4, $5, upper($6) from subscriptions s where s.stripe_subscription_id = $1
     on conflict (stripe_invoice_id) where stripe_invoice_id is not null
     do update set status = excluded.status, hosted_invoice_url = excluded.hosted_invoice_url`,
    [stripeSubId, status === "paid" ? invoice.amount_paid : invoice.amount_due, status, invoice.id, invoice.hosted_invoice_url ?? null, invoice.currency],
  );
}

export async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) return;
      const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      await syncSubscription(await stripe().subscriptions.retrieve(id));
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription);
      return;
    case "invoice.paid":
      await recordInvoice(event.data.object as Stripe.Invoice, "paid");
      return;
    case "invoice.payment_failed":
      await recordInvoice(event.data.object as Stripe.Invoice, "open");
      return;
  }
}

/**
 * Verifies, de-duplicates and processes one webhook delivery. The event row is
 * written in the same transaction-less step AFTER success, so a failed handler
 * returns 500 and Stripe retries it.
 */
export async function processWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, "Webhook secret is not configured.");
  if (!signature) throw new HttpError(400, "Missing Stripe signature.");
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new HttpError(400, "Invalid Stripe signature.");
  }
  const [seen] = await query("select 1 from stripe_events where id = $1", [event.id]);
  if (seen) return;
  await handleEvent(event);
  await query("insert into stripe_events (id, type) values ($1, $2) on conflict do nothing", [event.id, event.type]);
}
