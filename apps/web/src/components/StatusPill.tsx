type Tone = "ok" | "warn" | "crit" | "info";

const LABELS: Record<string, { label: string; tone: Tone }> = {
  healthy: { label: "Healthy", tone: "ok" },
  low: { label: "Low", tone: "warn" },
  out_of_stock: { label: "Out of stock", tone: "crit" },
  overstocked: { label: "Overstocked", tone: "info" },
};

export function StatusPill({ status }: { status: string }) {
  const entry = LABELS[status] ?? { label: status, tone: "info" as Tone };
  return (
    <span className={`pill ${entry.tone}`}>
      <span className="dot" />
      {entry.label}
    </span>
  );
}
