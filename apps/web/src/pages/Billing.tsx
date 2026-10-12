import { SkeletonRows } from "../components/Skeleton";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import OrgBillingOverview from "../components/billing/OrgBillingOverview";
import { usePlanAccess } from "../plan/PlanContext";
import { ANNUAL_DISCOUNT, PLAN_CARDS, TIER_NAME, TIER_RANK, type PlanCard } from "../plan/plans";
import "../styles/billing.css";
import "../styles/modules.css";

interface PlanUsage {
  planName: string;
  trackedSourcesUsed: number;
  trackedSourcesIncluded: number | null;
  nudge: { level: "none" | "approaching" | "over"; message: string } | null;
  trialActivatedAt: string | null;
  status: string;
  tier: "margin_intelligence" | "operations_pro" | "enterprise";
  effectiveTier: "margin_intelligence" | "operations_pro" | "enterprise";
  paid: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

function priceOf(card: PlanCard, annual: boolean) {
  if (card.monthlyCents === null) return { main: "Custom", sub: "tailored to your scale" };
  const cents = annual ? Math.round(card.monthlyCents * (1 - ANNUAL_DISCOUNT)) : card.monthlyCents;
  return { main: `$${Math.round(cents / 100)}`, sub: annual ? "/mo, billed annually" : "/mo" };
}

export function Billing() {
  const { tier, effectiveTier, status } = usePlanAccess();
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [annual, setAnnual] = useState(false);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [params] = useSearchParams();
  const checkoutResult = params.get("checkout");

  useEffect(() => {
    api
      .get<PlanUsage>("/billing/usage")
      .then(setUsage)
      .catch(() => setError("Could not load your plan usage."));
    api.get<{ checkoutEnabled: boolean }>("/billing/config").then((c) => setCheckoutEnabled(c.checkoutEnabled)).catch(() => {});
  }, []);

  // Stripe confirms via webhook, which can land a moment after the redirect.
  useEffect(() => {
    if (checkoutResult !== "success") return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      api.get<PlanUsage>("/billing/usage").then((u) => {
        setUsage(u);
        if (u.paid || tries >= 10) clearInterval(timer);
      }).catch(() => clearInterval(timer));
    }, 2000);
    return () => clearInterval(timer);
  }, [checkoutResult]);

  async function redirectTo(path: string, body: unknown, key: string) {
    setBusy(key);
    setNotice(null);
    try {
      const { url } = await api.post<{ url: string }>(path, body);
      window.location.assign(url);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not open checkout. Try again.");
      setBusy(null);
    }
  }

  if (error) return <p style={{ color: "var(--critical)" }}>{error}</p>;
  if (!usage || !tier) return <SkeletonRows rows={5} />;
  const currentTier = tier;

  const pct =
    usage.trackedSourcesIncluded !== null
      ? Math.min(100, Math.round((usage.trackedSourcesUsed / usage.trackedSourcesIncluded) * 100))
      : null;

  function cta(card: PlanCard) {
    const name = TIER_NAME[card.tier];
    if (status === "trialing" && card.tier === effectiveTier && card.tier !== tier) {
      return <button className="bp-btn" disabled>Included in your trial</button>;
    }
    if (card.tier === currentTier) return <button className="bp-btn" disabled>Current plan</button>;
    if (card.tier === "enterprise") return <Link className="bp-btn" to="/contact?plan=enterprise">Contact sales</Link>;
    if (checkoutEnabled) {
      // Already paying: plan changes go through the Stripe portal.
      if (usage!.paid) return <button className="bp-btn" disabled={busy !== null} onClick={() => redirectTo("/billing/portal", undefined, "portal")}>Change in billing portal</button>;
      return (
        <button
          className={`bp-btn ${TIER_RANK[card.tier] > TIER_RANK[currentTier] ? "primary" : ""}`}
          disabled={busy !== null}
          onClick={() => redirectTo("/billing/checkout", { tier: card.tier, interval: annual ? "year" : "month" }, card.tier)}
        >
          {busy === card.tier ? "Redirecting…" : `Subscribe to ${name}`}
        </button>
      );
    }
    if (TIER_RANK[card.tier] > TIER_RANK[currentTier]) return <Link className="bp-btn primary" to={`/contact?plan=${card.tier}`}>Upgrade to {name}</Link>;
    return <Link className="bp-btn" to={`/contact?plan=${card.tier}`}>Switch to {name}</Link>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Billing</h1>

      <section className="bp" aria-label="Plans">
        {usage.status === "trialing" && (
          <div className="bp-trial" role="status">
            You're on a free trial with full Operations Pro access
            {!usage.trialActivatedAt && ". The trial clock starts once your first tracked source returns a price"}.
          </div>
        )}
        <div className="bp-head">
          <h2>Choose your plan</h2>
          <div className="bp-toggle" role="group" aria-label="Billing period">
            <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button>
            <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>
              Annual <span className="bp-save" style={annual ? { color: "var(--bp-ink)" } : undefined}>Save {Math.round(ANNUAL_DISCOUNT * 100)}%</span>
            </button>
          </div>
        </div>
        <div className="bp-grid">
          {PLAN_CARDS.map((card) => {
            const price = priceOf(card, annual);
            const current = card.tier === tier;
            const trialAccess = status === "trialing" && card.tier === effectiveTier;
            return (
              <article key={card.tier} className={`bp-card ${card.highlight ? "hi" : ""} ${current || trialAccess ? "current" : ""}`}>
                {card.highlight && <span className="bp-flag">Most popular</span>}
                <span className="bp-badge">{card.badge}</span>
                <h3>{TIER_NAME[card.tier]}</h3>
                <div className="bp-price">{price.main}<small>{price.sub}</small></div>
                <ul>{card.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                {cta(card)}
              </article>
            );
          })}
        </div>
        {checkoutResult === "success" && <div className="bp-trial" role="status">Payment received. Your plan updates in a few seconds.</div>}
        {checkoutResult === "canceled" && <p className="bp-note">Checkout was canceled. You haven't been charged.</p>}
        {notice && <p className="bp-note" role="alert" style={{ color: "var(--critical)" }}>{notice}</p>}
        {usage.paid ? (
          <p className="bp-note">
            {usage.cancelAtPeriodEnd && usage.currentPeriodEnd
              ? `Your plan ends on ${new Date(usage.currentPeriodEnd).toLocaleDateString()}. `
              : usage.currentPeriodEnd ? `Renews ${new Date(usage.currentPeriodEnd).toLocaleDateString()}. ` : ""}
            {usage.status === "past_due" && "Your last payment failed. Update your card to keep your plan. "}
            <button className="bp-btn" disabled={busy !== null} onClick={() => redirectTo("/billing/portal", undefined, "portal")}>
              Manage billing &amp; invoices
            </button>
          </p>
        ) : !checkoutEnabled ? (
          <p className="bp-note">Plan changes are handled by our team for now.</p>
        ) : (
          <p className="bp-note">Secure checkout by Stripe. Cards, Apple Pay and Google Pay accepted. Only workspace owners can subscribe.</p>
        )}
      </section>

      <div className="card">
        <strong>Tracked competitor sources</strong>
        <p style={{ fontSize: 26, fontWeight: 700, margin: "8px 0" }}>
          {usage.trackedSourcesUsed}
          {usage.trackedSourcesIncluded !== null && (
            <span style={{ fontSize: 15, color: "var(--slate)", fontWeight: 400 }}>
              {" "}
              of {usage.trackedSourcesIncluded} included
            </span>
          )}
        </p>
        {pct !== null && (
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: "var(--hairline)",
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: usage.nudge?.level === "over" ? "var(--critical)" : "var(--accent)",
              }}
            />
          </div>
        )}
        {usage.nudge && (
          <p
            style={{
              fontSize: 13,
              color: usage.nudge.level === "over" ? "var(--critical)" : "var(--warning)",
              margin: 0,
            }}
          >
            {usage.nudge.message}
          </p>
        )}
        {!usage.nudge && usage.trackedSourcesIncluded !== null && (
          <p style={{ fontSize: 13, color: "var(--slate)", margin: 0 }}>Well within your plan's included volume.</p>
        )}
      </div>

      <h2 style={{ fontSize: 18, margin: "28px 0 12px" }}>Scraping credits</h2>
      <OrgBillingOverview />
    </div>
  );
}
