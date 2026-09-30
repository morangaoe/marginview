import { Link } from "react-router-dom";
import { request, useApi } from "../lib/useApi";
import StateView from "../components/StateView";
import "../styles/extra-pages.css";

type Note = { id: string; type: "stock_low" | "scrape_failed" | "po_received"; message: string; link?: string; createdAt: string; read: boolean };
const TYPE: Record<Note["type"], string> = { stock_low: "Low stock", scrape_failed: "Price check failed", po_received: "Order received" };

export default function Notifications() {
  const { data, error, loading, reload } = useApi<Note[]>("/notifications");

  const markRead = async (id: string) => { await request(`/notifications/${id}/read`, { method: "POST" }); reload(); };
  const markAll = async () => { await request("/notifications/read-all", { method: "POST" }); reload(); };

  return (
    <div className="mv-page">
      <h1>Notifications</h1>
      <p className="mv-sub">Low stock, failed price checks and received orders.</p>
      <div className="mv-row"><button className="mv-btn secondary" onClick={markAll} disabled={!data?.some((n) => !n.read)}>Mark all as read</button></div>
      <StateView loading={loading} error={error} onRetry={reload} isEmpty={!data || data.length === 0}
        emptyTitle="You're all caught up" emptyHint="New alerts will appear here and in your email.">
        <ul className="mv-list">
          {data?.map((n) => (
            <li key={n.id} className={n.read ? "" : "unread"}>
              <div>
                <span className="mv-badge">{TYPE[n.type]}</span>{!n.read && <span className="mv-badge"> Unread</span>}
                <p style={{ margin: "6px 0 0" }}>{n.message}</p>
                <small>{new Date(n.createdAt).toLocaleString()}{n.link && <> · <Link to={n.link}>Open</Link></>}</small>
              </div>
              {!n.read && <button className="mv-btn secondary" onClick={() => markRead(n.id)}>Mark as read</button>}
            </li>
          ))}
        </ul>
      </StateView>
    </div>
  );
}
