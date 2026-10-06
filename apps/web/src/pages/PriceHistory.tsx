import { Link, useParams } from "react-router-dom";
import { useApi } from "../lib/useApi";
import StateView from "../components/StateView";
import "../styles/extra-pages.css";

type Change = { id: string; at: string; actor: string; from: number | null; to: number; strategy: string; marginAfter: number | null };
type History = { productName: string; currency: string; changes: Change[] };

export default function PriceHistory() {
  const { productId } = useParams();
  const { data, error, loading, reload } = useApi<History>(productId ? `/pricing/${productId}/history` : null);
  const money = (cents: number | null, currency: string) => cents === null
    ? "—"
    : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

  return (
    <div className="mv-page">
      <p><Link to={productId ? `/app/pricing/${productId}` : "/app/pricing"}>Back to pricing</Link></p>
      <h1>Price change history{data ? `: ${data.productName}` : ""}</h1>
      <p className="mv-sub">Every applied price, who applied it and which strategy produced it.</p>
      <StateView loading={loading} error={error} onRetry={reload} isEmpty={!data || data.changes.length === 0}
        emptyTitle="No price changes yet" emptyHint="Apply a strategy on the product's pricing page and it will be logged here.">
        {data && (
          <div className="mv-table-wrap">
            <table className="mv-table">
              <thead><tr><th>When</th><th>By</th><th>From</th><th>To</th><th>Strategy</th><th>Margin after</th></tr></thead>
              <tbody>
                {data.changes.map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.at).toLocaleString()}</td><td>{c.actor}</td>
                    <td>{money(c.from, data.currency)}</td><td>{money(c.to, data.currency)}</td>
                    <td>{c.strategy}</td><td>{c.marginAfter == null ? "Not available" : `${c.marginAfter.toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </StateView>
    </div>
  );
}
