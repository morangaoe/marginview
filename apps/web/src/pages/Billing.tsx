import { SkeletonRows } from "../components/Skeleton";
import { useEffect, useState } from "react";
import { api } from "../api/client";

interface PlanUsage {
  planName: string;
  trackedSourcesUsed: number;
  trackedSourcesIncluded: number | null;
  nudge: { level: "none" | "approaching" | "over"; message: string } | null;
  trialActivatedAt: string | null;
  status: string;
}

export function Billing() {
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PlanUsage>("/billing/usage")
      .then(setUsage)
      .catch(() => setError("Could not load your plan usage."));
  }, []);

  if (error) return <p style={{ color: "var(--critical)" }}>{error}</p>;
  if (!usage) return <SkeletonRows rows={5} />;

  const pct =
    usage.trackedSourcesIncluded !== null
      ? Math.min(100, Math.round((usage.trackedSourcesUsed / usage.trackedSourcesIncluded) * 100))
      : null;

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Billing</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <strong>{usage.planName}</strong>
        <p style={{ color: "var(--slate)", fontSize: 13, margin: "4px 0 0" }}>
          Status: {usage.status === "trialing" ? "Trial" : usage.status}
          {usage.status === "trialing" && !usage.trialActivatedAt && (
            <> · your trial clock starts once your first tracked source successfully returns a price</>
          )}
        </p>
      </div>

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
    </div>
  );
}
