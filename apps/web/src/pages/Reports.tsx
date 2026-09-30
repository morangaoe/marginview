import { useApi } from "../lib/useApi";
import StateView from "../components/StateView";
import "../styles/extra-pages.css";

type Point = { label: string; value: number };
type Summary = {
  marginTrend: Point[];
  stockouts: Point[];
  suggestionsTotal: number;
  suggestionsActed: number; // approved or explicitly dismissed within 7 days
};

function BarChart({ title, points, unit = "" }: { title: string; points: Point[]; unit?: string }) {
  const w = 520, h = 190, pad = 26;
  const max = Math.max(1, ...points.map((p) => p.value));
  const bw = (w - pad * 2) / Math.max(points.length, 1);
  return (
    <figure className="mv-fig">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title}>
        {points.map((p, i) => {
          const bh = ((h - pad * 2) * p.value) / max;
          const x = pad + i * bw;
          return (
            <g key={p.label}>
              <rect x={x + 4} y={h - pad - bh} width={bw - 8} height={bh} className="mv-bar" />
              <text x={x + bw / 2} y={h - pad - bh - 4} textAnchor="middle" className="mv-axis">{p.value}{unit}</text>
              <text x={x + bw / 2} y={h - 8} textAnchor="middle" className="mv-axis">{p.label}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export default function Reports() {
  const { data, error, loading, reload } = useApi<Summary>("/reports/summary");
  const rate = data && data.suggestionsTotal > 0 ? Math.round((data.suggestionsActed / data.suggestionsTotal) * 100) : 0;

  return (
    <div className="mv-page">
      <h1>Reports</h1>
      <p className="mv-sub">Margin, stockouts and how often you act on procurement suggestions.</p>
      <StateView
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={!data || (data.marginTrend.length === 0 && data.stockouts.length === 0 && data.suggestionsTotal === 0)}
        emptyTitle="No report data yet"
        emptyHint="Apply a price or adjust stock and your first report will appear here."
      >
        {data && (
          <>
            <BarChart title="Average margin by month" points={data.marginTrend} unit="%" />
            <BarChart title="Stockout incidents by month" points={data.stockouts} />
            <section>
              <h2>Suggestions acted on within 7 days</h2>
              <div className="mv-stat">{rate}%</div>
              <p className="mv-sub">
                {data.suggestionsActed} of {data.suggestionsTotal} suggestions approved or dismissed. Target: above 70%.
              </p>
            </section>
          </>
        )}
      </StateView>
    </div>
  );
}
