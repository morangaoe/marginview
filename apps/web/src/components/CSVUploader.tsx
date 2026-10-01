import React, { useRef, useState } from "react";
import { ApiError, apiJson, formatCents, type CSVValidatedRow, type Location } from "../types/inventory";
import { parseAndValidateCSV } from "../utils/csvParser";
import { primaryButtonStyle, secondaryButtonStyle } from "./ProductFormModal";

interface Props {
  /** SKUs already known to the client; the server still does the authoritative org-wide check. */
  existingSkus: Set<string>;
  locations: Location[];
  onDone: (created: number) => void;
}

const MUTED = "var(--mv-muted, #8fa396)";
const BORDER = "var(--mv-border, rgba(255,255,255,0.12))";
const DANGER = "var(--mv-danger, #e5735f)";

export function CSVUploader({ existingSkus, locations, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CSVValidatedRow[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const valid = rows.filter((r) => r.parsed);
  const invalid = rows.length - valid.length;

  async function handleFile(file: File) {
    setServerError(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setServerError("Please choose a .csv file.");
      return;
    }
    const text = await file.text();
    const result = parseAndValidateCSV(text, existingSkus);
    setFileName(file.name);
    setRows(result.rows);
    setMissing(result.missingColumns);
  }

  async function submit() {
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await apiJson<{ created: number }>("/api/products/bulk", {
        method: "POST",
        body: JSON.stringify({ items: valid.map((r) => r.parsed), location_id: locationId || undefined }),
      });
      onDone(res.created);
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.body?.rows)) {
        const detail = e.body.rows.slice(0, 5).map((r: any) => `row ${r.row}${r.sku ? ` (${r.sku})` : ""}: ${r.errors.join(", ")}`).join("; ");
        setServerError(`${e.message}. ${detail}${e.body.rows.length > 5 ? "…" : ""}`);
      } else {
        setServerError(e instanceof Error ? e.message : "Import failed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setRows([]);
    setFileName(null);
    setMissing([]);
    setServerError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        style={{
          border: `1px dashed ${dragging ? "var(--mv-accent, #3fae7a)" : BORDER}`,
          borderRadius: 8,
          padding: 24,
          textAlign: "center",
          cursor: "pointer",
          color: MUTED,
        }}
      >
        <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
        {fileName ?? "Drop a .csv here, or click to choose"}
        <div style={{ fontSize: 12, marginTop: 4 }}>Columns: SKU, Product Name, Category, Cost Price, Stock Quantity, Reorder Level. Cost in dollars.</div>
      </div>

      {missing.length > 0 && <div role="alert" style={{ color: DANGER }}>Missing columns: {missing.join(", ")}</div>}

      {rows.length > 0 && missing.length === 0 && (
        <>
          <div style={{ color: MUTED, fontSize: 13 }}>{valid.length} ready to import{invalid > 0 ? `, ${invalid} with errors (skipped)` : ""}.</div>
          <div style={{ maxHeight: 260, overflow: "auto", border: `1px solid ${BORDER}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: MUTED }}>
                  <th style={th}>Row</th><th style={th}>SKU</th><th style={th}>Name</th><th style={th}>Cost</th><th style={th}>Qty</th><th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNumber} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td style={td}>{r.rowNumber}</td>
                    <td style={td}>{r.raw.SKU}</td>
                    <td style={td}>{r.raw["Product Name"]}</td>
                    <td style={td}>{r.parsed ? formatCents(r.parsed.cost_cents) : r.raw["Cost Price"]}</td>
                    <td style={td}>{r.raw["Stock Quantity"]}</td>
                    <td style={{ ...td, color: r.errors.length ? DANGER : "var(--mv-accent, #3fae7a)" }}>
                      {r.errors.length ? r.errors.map((e) => e.message).join(" ") : "OK"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {locations.length > 1 && (
            <label style={{ fontSize: 13, color: MUTED }}>
              Import into location{" "}
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ marginLeft: 8 }}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
        </>
      )}

      {serverError && <div role="alert" style={{ color: DANGER, fontSize: 13 }}>{serverError}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {rows.length > 0 && <button type="button" style={secondaryButtonStyle} onClick={reset}>Clear</button>}
        <button
          type="button"
          style={{ ...primaryButtonStyle, opacity: valid.length === 0 || submitting ? 0.5 : 1 }}
          disabled={valid.length === 0 || submitting || missing.length > 0}
          onClick={submit}
        >
          {submitting ? "Importing…" : `Import ${valid.length} product${valid.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 500, position: "sticky", top: 0, background: "var(--mv-surface, #121a16)" };
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
