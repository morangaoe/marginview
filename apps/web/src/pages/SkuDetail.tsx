import { Link, useParams } from "react-router-dom";
import { useApi } from "../lib/useApi";
import StateView from "../components/StateView";
import "../styles/extra-pages.css";

type Loc = { location: string; onHand: number; committed: number; incoming: number; available: number; reorderPoint: number; status: string };
type Move = { id: string; at: string; location: string; delta: number; reason: string; actor: string };
type Sku = { id: string; sku: string; name: string; locations: Loc[]; movements: Move[] };

export default function SkuDetail() {
  const { skuId } = useParams();
  const { data, error, loading, reload } = useApi<Sku>(skuId ? `/skus/${skuId}` : null);

  return (
    <div className="mv-page">
      <p><Link to="/app/inventory">Back to inventory</Link></p>
      <StateView loading={loading} error={error} onRetry={reload} isEmpty={!data}
        emptyTitle="SKU not found" emptyHint="It may have been removed. Go back to the inventory list.">
        {data && (
          <>
            <h1>{data.name}</h1>
            <p className="mv-sub">SKU {data.sku} · <Link to={`/app/pricing/${data.id}/history`}>View price history</Link></p>

            <h2>Stock by location</h2>
            <div className="mv-table-wrap">
              <table className="mv-table">
                <thead><tr><th>Location</th><th>On hand</th><th>Committed</th><th>Incoming</th><th>Available</th><th>Reorder point</th><th>Status</th></tr></thead>
                <tbody>
                  {data.locations.map((l) => (
                    <tr key={l.location}>
                      <td>{l.location}</td><td>{l.onHand}</td><td>{l.committed}</td><td>{l.incoming}</td>
                      <td>{l.available}</td><td>{l.reorderPoint}</td><td><span className="mv-badge">{l.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 style={{ marginTop: 32 }}>Stock adjustment history</h2>
            {data.movements.length === 0 ? (
              <div className="mv-state"><strong>No adjustments yet</strong><p>Received, sold, damaged, returned and recount entries appear here.</p></div>
            ) : (
              <div className="mv-table-wrap">
                <table className="mv-table">
                  <thead><tr><th>When</th><th>Location</th><th>Change</th><th>Reason</th><th>By</th></tr></thead>
                  <tbody>
                    {data.movements.map((m) => (
                      <tr key={m.id}>
                        <td>{new Date(m.at).toLocaleString()}</td><td>{m.location}</td>
                        <td>{m.delta > 0 ? `+${m.delta}` : m.delta}</td><td>{m.reason}</td><td>{m.actor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </StateView>
    </div>
  );
}
