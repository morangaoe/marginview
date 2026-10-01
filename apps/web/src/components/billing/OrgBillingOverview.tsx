import { money, useMv } from "../../lib/mv";
import "../../styles/modules.css";

interface Overview {
  organization: string;
  inviteCode: string | null;
  planName: string;
  credits: { total: number; used: number; remaining: number };
  creditsEnforced: boolean;
  upgradeOptions: Array<{ id: string; name: string; tracked_sources_included: number | null; price_cents_monthly: number | null; starting_floor_cents_monthly?: number; billing: string }>;
}

export default function OrgBillingOverview() {
  const { data, error, loading, reload } = useMv<Overview>("/api/billing/overview");

  if (loading) return <div className="card mv-muted" role="status">Loading credits…</div>;
  if (error || !data)
    return (
      <div className="card" role="alert">
        <p className="mv-err" style={{ marginTop: 0 }}>{error ?? "Couldn't load credits and plans."}</p>
        <button className="btn" onClick={reload}>Try again</button>
      </div>
    );

  const { credits } = data;
  const pct = credits.total ? Math.min((credits.used / credits.total) * 100, 100) : 0;
  const tone = pct >= 100 ? "bad" : pct >= 80 ? "warn" : "";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="card">
        <div className="mv-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <strong>{credits.remaining.toLocaleString()} credits left for {data.organization}</strong>
          <span className="mv-muted">{credits.used.toLocaleString()} of {credits.total.toLocaleString()} used</span>
        </div>
        <div className={`mv-bar ${tone}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Scraping credits used">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="mv-muted" style={{ marginBottom: 0 }}>
          One credit is used for each successful price check.
          {credits.remaining === 0 && (data.creditsEnforced ? " Price checks are paused until you upgrade." : " Price checks continue, but consider upgrading.")}
        </p>
        {data.inviteCode && <p className="mv-muted" style={{ marginBottom: 0 }}>Teammate invite code: <code>{data.inviteCode}</code></p>}
      </section>

      <section className="mv-grid">
        {data.upgradeOptions.map((p) => {
          const current = p.name === data.planName;
          const price = p.price_cents_monthly != null ? `${money(p.price_cents_monthly)}/mo` : p.starting_floor_cents_monthly ? `From ${money(p.starting_floor_cents_monthly)}/mo` : "Custom";
          return (
            <div key={p.id} className="card">
              <strong>{p.name}</strong>
              <p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0" }}>{price}</p>
              <p className="mv-muted">{p.tracked_sources_included ?? "Unlimited"} tracked sources</p>
              {current ? <button className="btn" disabled>Current plan</button> : <a className="btn primary" href="/contact">Talk to us about {p.name}</a>}
            </div>
          );
        })}
      </section>
    </div>
  );
}
