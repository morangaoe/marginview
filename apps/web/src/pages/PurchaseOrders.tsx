import { Fragment, useState } from "react";
import { request, useApi } from "../lib/useApi";
import StateView from "../components/StateView";
import "../styles/extra-pages.css";

type Status = "draft" | "sent" | "partially_received" | "received" | "closed";
type Line = { id: string; sku: string; name: string; qtyOrdered: number; qtyReceived: number; unitCost: number };
type PO = { id: string; number: string; supplierName: string; status: Status; createdAt: string; lines: Line[] };

const LABEL: Record<Status, string> = {
  draft: "Draft", sent: "Sent", partially_received: "Partially received", received: "Received", closed: "Closed",
};

function toCsv(po: PO) {
  const rows = [["PO", "Supplier", "SKU", "Name", "Ordered", "Received", "Unit cost"]];
  po.lines.forEach((l) => rows.push([po.number, po.supplierName, l.sku, l.name, String(l.qtyOrdered), String(l.qtyReceived), String(l.unitCost)]));
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${po.number}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function PurchaseOrders() {
  const { data, error, loading, reload } = useApi<PO[]>("/procurement/purchase-orders");
  const [filter, setFilter] = useState<Status | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setMsg(null);
    try { await fn(); reload(); } catch (e) { setMsg((e as Error).message); }
  }

  const setStatus = (po: PO, status: Status) =>
    run(() => request(`/procurement/purchase-orders/${po.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }));

  // Server must apply this in one DB transaction: update line qtyReceived, add stock movements
  // (reason "received"), move status to partially_received / received.
  const receive = (po: PO) =>
    run(async () => {
      const lines = po.lines.map((l) => ({ lineId: l.id, qty: qty[l.id] || 0 })).filter((l) => l.qty > 0);
      if (lines.length === 0) throw new Error("Enter a quantity for at least one line.");
      await request(`/procurement/purchase-orders/${po.id}/receive`, { method: "POST", body: JSON.stringify({ lines }) });
      setQty({});
      setOpenId(null);
    });

  const rows = (data ?? []).filter((p) => filter === "all" || p.status === filter);

  return (
    <div className="mv-page">
      <h1>Purchase orders</h1>
      <p className="mv-sub">Track each order from draft to received. Receiving stock updates inventory automatically.</p>
      <div className="mv-row">
        <div className="mv-field">
          <label htmlFor="po-filter">Status</label>
          <select id="po-filter" value={filter} onChange={(e) => setFilter(e.target.value as Status | "all")}>
            <option value="all">All</option>
            {(Object.keys(LABEL) as Status[]).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
          </select>
        </div>
      </div>
      {msg && <p className="mv-error" role="alert">{msg}</p>}
      <StateView loading={loading} error={error} onRetry={reload} isEmpty={rows.length === 0}
        emptyTitle="No purchase orders" emptyHint="Create one from a suggestion on the Procurement page.">
        <div className="mv-table-wrap">
          <table className="mv-table">
            <thead><tr><th>PO</th><th>Supplier</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((po) => (
                <Fragment key={po.id}>
                  <tr>
                    <td>{po.number}</td><td>{po.supplierName}</td>
                    <td>{new Date(po.createdAt).toLocaleDateString()}</td>
                    <td><span className="mv-badge">{LABEL[po.status]}</span></td>
                    <td>
                      {po.status === "draft" && <button className="mv-btn" onClick={() => setStatus(po, "sent")}>Send to supplier</button>}
                      {(po.status === "sent" || po.status === "partially_received") &&
                        <button className="mv-btn" onClick={() => setOpenId(openId === po.id ? null : po.id)}>Receive stock</button>}
                      {po.status === "received" && <button className="mv-btn" onClick={() => setStatus(po, "closed")}>Close</button>}{" "}
                      <button className="mv-btn secondary" onClick={() => toCsv(po)}>CSV</button>{" "}
                      <a className="mv-btn secondary" href={`/api/procurement/purchase-orders/${po.id}/export.pdf`} target="_blank" rel="noreferrer">PDF</a>
                    </td>
                  </tr>
                  {openId === po.id && (
                    <tr>
                      <td colSpan={5}>
                        {po.lines.map((l) => {
                          const remaining = l.qtyOrdered - l.qtyReceived;
                          return (
                            <div className="mv-row" key={l.id}>
                              <div className="mv-field"><label>{l.sku} · {l.name}</label>
                                <span>{l.qtyReceived} of {l.qtyOrdered} received</span></div>
                              <div className="mv-field"><label htmlFor={`q-${l.id}`}>Receive now (max {remaining})</label>
                                <input id={`q-${l.id}`} type="number" min={0} max={remaining} value={qty[l.id] ?? ""}
                                  onChange={(e) => setQty({ ...qty, [l.id]: Math.min(remaining, Number(e.target.value)) })} /></div>
                            </div>
                          );
                        })}
                        <button className="mv-btn" onClick={() => receive(po)}>Confirm received quantities</button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </StateView>
    </div>
  );
}
