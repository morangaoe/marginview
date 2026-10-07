import { useState } from "react";
import { Link } from "react-router-dom";
import { EmailGate } from "../components/EmailGate";
import { getLeadToken, publicApi } from "../lib/lead";
import { ApiError, CSV_MAX_BYTES } from "../types/inventory";
import { CSV_TEMPLATE, decodeCsvBuffer, parseAndValidateCSV } from "../utils/csvParser";

const AUDIT_MAX_ROWS = 500; // keep in step with apps/api/src/services/priceAudit.ts

type Status = "healthy" | "below_target" | "thin" | "loss" | "no_price";
interface Row { sku: string; name: string; costCents: number; priceCents: number | null; quantity: number; marginPct: number | null; status: Status; targetPriceCents: number; gapPerUnitCents: number }
interface Report {
  targetMarginPct: number;
  totals: { skus: number; priced: number; noPrice: number; healthy: number; belowTarget: number; thin: number; loss: number };
  avgMarginPct: number | null; gapPerUnitCents: number; gapOnHandCents: number | null; rows: Row[];
}
interface Parsed { rows: { sku: string; name: string; costCents: number; priceCents: number | null; quantity: number }[]; skipped: number; ignored: string[] }

const usd = (c: number | null) => (c == null ? "-" : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }));
const TONE: Record<Status, { label: string; cls: string }> = {
  healthy: { label: "Healthy", cls: "ok" }, below_target: { label: "Below target", cls: "warn" },
  thin: { label: "Thin", cls: "warn" }, loss: { label: "Selling at a loss", cls: "crit" }, no_price: { label: "No price", cls: "info" },
};

export function FreeAudit() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null); setReport(null); setParsed(null);
    if (file.size > CSV_MAX_BYTES) return setError("That file is over 5 MB.");
    const { rows, missingColumns, ignoredColumns } = parseAndValidateCSV(decodeCsvBuffer(await file.arrayBuffer()), new Set());
    if (missingColumns.length) return setError(`Missing column${missingColumns.length > 1 ? "s" : ""}: ${missingColumns.join(", ")}. Download the template to see the format.`);
    const good = rows.flatMap((r) => (r.parsed ? [{ sku: r.parsed.sku, name: r.parsed.name, costCents: r.parsed.cost_cents, priceCents: r.parsed.price_cents ?? null, quantity: r.parsed.quantity }] : []));
    if (!good.length) return setError("No valid rows found. Each row needs a SKU, a product name and a cost price.");
    if (good.length > AUDIT_MAX_ROWS) return setError(`The free audit covers up to ${AUDIT_MAX_ROWS} products; this file has ${good.length}.`);
    const next = { rows: good, skipped: rows.length - good.length, ignored: ignoredColumns };
    setParsed(next);
    if (getLeadToken()) void run(next); else setNeedEmail(true);
  }

  async function run(p: Parsed | null = parsed) {
    if (!p) return;
    setBusy(true); setError(null); setNeedEmail(false);
    try {
      setReport(await publicApi<Report>("/api/public/audit", { method: "POST", body: JSON.stringify({ rows: p.rows }) }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setNeedEmail(true); else setError((e as Error).message);
    } finally { setBusy(false); }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "marginview-template.csv" });
    a.click(); URL.revokeObjectURL(url);
  }

  const t = report?.totals;
  return (
    <main className="mv-wrap mv-demo">
      <h1>Free price audit</h1>
      <p style={{ color: "var(--slate)", marginTop: -16, maxWidth: 560 }}>
        Upload your products with cost and selling price. We'll show your margin on every SKU and what's being left on the table.
        Your file is analysed in one request and is not stored.
      </p>

      <div className="card" style={{ background: "var(--card)", display: "grid", gap: 12, marginBottom: 20 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
          Product CSV (SKU, Product Name, Cost Price, Selling Price, optional Stock Quantity)
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <div><button className="btn" onClick={download} style={{ fontSize: 12 }}>Download template</button></div>
        {error && <div role="alert" style={{ color: "var(--critical)", fontSize: 13 }}>{error}</div>}
        {parsed && !error && (
          <div style={{ color: "var(--slate)", fontSize: 12 }}>
            {parsed.rows.length} products read{parsed.skipped > 0 && `, ${parsed.skipped} skipped for missing or invalid values`}
            {parsed.ignored.length > 0 && `. Ignored columns: ${parsed.ignored.join(", ")}`}
          </div>
        )}
      </div>

      {needEmail && (
        <EmailGate source="audit" title="Where should we send your report?"
          body="Enter your email to see the full margin report." onUnlocked={() => void run()} />
      )}
      {busy && <p role="status" style={{ color: "var(--slate)" }}>Analysing…</p>}

      {report && t && (
        <section style={{ display: "grid", gap: 16 }} aria-label="Margin report">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {([
              ["Average margin", report.avgMarginPct === null ? "-" : `${report.avgMarginPct}%`],
              [`Below ${report.targetMarginPct}% target`, String(t.belowTarget + t.thin + t.loss)],
              ["Selling at a loss", String(t.loss)],
              [report.gapOnHandCents !== null ? "Left on the table (stock on hand)" : "Left on the table (per unit sold)", usd(report.gapOnHandCents ?? report.gapPerUnitCents)],
            ] as const).map(([l, v]) => (
              <div className="card" key={l} style={{ background: "var(--card)" }}>
                <div style={{ color: "var(--slate)", fontSize: 12, marginBottom: 6 }}>{l}</div>
                <div className="mv-stat">{v}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ background: "var(--card)", overflowX: "auto" }}>
            <table>
              <thead><tr><th>SKU</th><th>Product</th><th>Cost</th><th>Price</th><th>Margin</th><th>Price for {report.targetMarginPct}%</th><th>Status</th></tr></thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.sku}>
                    <td className="mono">{r.sku}</td><td>{r.name}</td>
                    <td className="mono">{usd(r.costCents)}</td><td className="mono">{usd(r.priceCents)}</td>
                    <td className="mono">{r.marginPct === null ? "-" : `${r.marginPct}%`}</td>
                    <td className="mono">{r.status === "healthy" ? "-" : usd(r.targetPriceCents)}</td>
                    <td><span className={`pill ${TONE[r.status].cls}`}>{TONE[r.status].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ background: "var(--card)", display: "flex", gap: 16, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Price against real competitors</div>
              <div style={{ color: "var(--slate)", fontSize: 13 }}>Import this catalog and Marginview tracks the market and suggests prices for every SKU.</div>
            </div>
            <Link to="/signup" className="btn primary">Start free trial</Link>
          </div>
        </section>
      )}
    </main>
  );
}
