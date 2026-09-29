import type { CSSProperties } from "react";

export function Skeleton({ w = "100%", h = 14, style }: { w?: number | string; h?: number | string; style?: CSSProperties }) {
  return <span className="sk" aria-hidden style={{ width: w, height: h, ...style }} />;
}

/** Stand-in for a table or list while data loads. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: "grid", gap: 14, padding: "6px 0" }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
          <Skeleton w={`${70 - i * 6}%`} /><Skeleton /><Skeleton w="60%" />
        </div>
      ))}
    </div>
  );
}

/** Stand-in for a stat card. */
export function SkeletonStat() {
  return (
    <div className="card" style={{ display: "grid", gap: 12 }} role="status" aria-label="Loading">
      <Skeleton w={80} h={11} /><Skeleton w={110} h={28} />
    </div>
  );
}
