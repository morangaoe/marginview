import React, { useRef, useState } from "react";
import {
  ApiError,
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  apiJson,
  formatCents,
  type BulkImportResponse,
  type CSVValidatedRow,
  type ImportMode,
  type Location,
} from "../types/inventory";
import { CSV_TEMPLATE, decodeCsvBuffer, parseAndValidateCSV } from "../utils/csvParser";
import { primaryButtonStyle, secondaryButtonStyle } from "./ProductFormModal";

interface Props {
  /** SKUs already known to the client; the server still does the authoritative org-wide check. */
  existingSkus: Set<string>;
  locations: Location[];
  /** Called when the user closes the result panel after something was created or updated. */
  onDone: (changed: number) => void;
}

const MUTED = "var(--mv-muted, #8fa396)";
const BORDER = "var(--mv-border, rgba(255,255,255,0.12))";
const DANGER = "var(--mv-danger, #e5735f)";
const WARN = "var(--mv-warning, #d9a441)";
const ACCENT = "var(--mv-accent, #3fae7a)";

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "marginview-products-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function CSVUploader({ existingSkus, locations, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CSVValidatedRow[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [mode, setMode] = useState<ImportMode>("skip");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResponse | null>(null);

  const valid = rows.filter((r) => r.parsed);
  const invalid = rows.length - valid.length;
  const existingCount = valid.filter((r) => r.existing).length;
  const newCount = valid.length - existingCount;
  const nothingToDo = mode === "skip" ? newCount === 0 : valid.length === 0;

  function reset() {
    setRows([]);
    setFileName(null);
    setMissing([]);
    setIgnored([]);
    setServerError(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File) {
    setServerError(null);
    setResult(null);
    setRows([]);
    setMissing([]);
    setIgnored([]);

    if (!/\.(csv|txt)$/i.test(file.name)) {
      setServerError("Please choose a .csv file.");
      return;
    }
    if (file.size > CSV_MAX_BYTES) {
      setServerError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${CSV_MAX_BYTES / 1024 / 1024} MB.`);
      return;
    }

    let parsed: ReturnType<typeof parseAndValidateCSV>;
    try {
      parsed = parseAndValidateCSV(decodeCsvBuffer(await file.arrayBuffer()), existingSkus);
    } catch {
      setServerError("Couldn't read that file. Save it as CSV (UTF-8) and try again.");
      return;
    }

    if (parsed.rows.length > CSV_MAX_ROWS) {
      setServerError(`That file has ${parsed.rows.length} rows. Import up to ${CSV_MAX_ROWS} at a time. Split it into smaller files.`);
      return;
    }
    if (parsed.rows.length === 0 && parsed.missingColumns.length === 0) {
      setServerError("That file has a header row but no products.");
      return;
    }

    setFileName(file.name);
    setRows(parsed.rows);
    setMissing(parsed.missingColumns);
    setIgnored(parsed.ignoredColumns);
  }

  async function submit() {
    setSubmitting(true);
    setServerError(null);
    try {
      // In "skip" mode there's no point sending rows we already know exist; the server re-checks anyway.
      const toSend = valid.filter((r) => mode === "update" || !r.existing);
      const res = await apiJson<BulkImportResponse>("/api/products/bulk", {
        method: "POST",
        body: JSON.stringify({
          items: toSend.map((r) => ({ ...r.parsed, row: r.rowNumber })),
          location_id: locationId || locations[0]?.id || undefined,
          mode,
        }),
      });
      setResult(res);
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.body?.rows)) {
        const detail = e.body.rows
          .slice(0, 5)
          .map((r: any) => `row ${r.row}${r.sku ? ` (${r.sku})` : ""}: ${(r.errors ?? []).join(", ")}`)
          .join("; ");
        setServerError(`${e.message}. ${detail}${e.body.rows.length > 5 ? "…" : ""}`);
      } else {
        setServerError(e instanceof Error ? e.message : "Import failed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Result panel ──────────────────────────────────────────────────────────
  if (result) {
    const changed = result.created + result.updated;
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div role="status" style={{ color: changed > 0 ? ACCENT : MUTED, fontWeight: 600 }}>
          {result.created} created, {result.updated} updated, {result.skipped} skipped.
        </div>
        {result.skipped_rows.length > 0 && (
          <div style={{ maxHeight: 200, overflow: "auto", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, fontSize: 13 }}>
            {result.skipped_rows.map((s, i) => (
              <div key={i} style={{ color: MUTED }}>
                Row {s.row}
                {s.sku ? ` (${s.sku})` : ""}: {s.reason}
              </div>
            ))}
            {result.skipped > result.skipped_rows.length && (
              <div style={{ color: MUTED }}>…and {result.skipped - result.skipped_rows.length} more.</div>
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={primaryButtonStyle} onClick={() => (changed > 0 ? onDone(changed) : reset())}>
            {changed > 0 ? "Done" : "Try another file"}
          </button>
        </div>
      </div>
    );
  }

  // ── Upload + preview ──────────────────────────────────────────────────────
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
          border: `1px dashed ${dragging ? ACCENT : BORDER}`,
          borderRadius: 8,
          padding: 24,
          textAlign: "center",
          cursor: "pointer",
          color: MUTED,
        }}
      >
        <input ref={inputRef} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
        {fileName ?? "Drop a .csv here, or click to choose"}
        <div style={{ fontSize: 12, marginTop: 4 }}>
          Required: SKU, Product Name, Cost Price. Optional: Category, Selling Price, Stock Quantity, Reorder Level. Money in dollars, up to {CSV_MAX_ROWS} rows.
        </div>
      </div>

      <div style={{ fontSize: 13 }}>
        <button type="button" onClick={downloadTemplate} style={{ background: "none", border: "none", color: ACCENT, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
          Download a template
        </button>
      </div>

      {missing.length > 0 && <div role="alert" style={{ color: DANGER }}>Missing required columns: {missing.join(", ")}</div>}
      {ignored.length > 0 && missing.length === 0 && (
        <div style={{ color: MUTED, fontSize: 12 }}>Ignored columns: {ignored.join(", ")}</div>
      )}

      {rows.length > 0 && missing.length === 0 && (
        <>
          <div style={{ color: MUTED, fontSize: 13 }}>
            {newCount} new{existingCount > 0 ? `, ${existingCount} already in your catalog` : ""}
            {invalid > 0 ? `, ${invalid} with errors (will be skipped)` : ""}.
          </div>

          {existingCount > 0 && (
            <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 6, fontSize: 13 }}>
              <legend style={{ color: MUTED, marginBottom: 4 }}>For SKUs that already exist</legend>
              <label>
                <input type="radio" name="csv-mode" checked={mode === "skip"} onChange={() => setMode("skip")} /> Skip them
              </label>
              <label>
                <input type="radio" name="csv-mode" checked={mode === "update"} onChange={() => setMode("update")} /> Update name, category, cost and price (stock is left alone)
              </label>
            </fieldset>
          )}

          <div style={{ maxHeight: 260, overflow: "auto", border: `1px solid ${BORDER}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: MUTED }}>
                  <th style={th}>Row</th><th style={th}>SKU</th><th style={th}>Name</th><th style={th}>Cost</th><th style={th}>Price</th><th style={th}>Qty</th><th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const hasErr = r.errors.length > 0;
                  return (
                    <tr key={r.rowNumber} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={td}>{r.rowNumber}</td>
                      <td style={td}>{r.raw.SKU}</td>
                      <td style={td}>{r.raw["Product Name"]}</td>
                      <td style={td}>{r.parsed ? formatCents(r.parsed.cost_cents) : r.raw["Cost Price"]}</td>
                      <td style={td}>{r.parsed?.price_cents ? formatCents(r.parsed.price_cents) : r.raw["Selling Price"] || "—"}</td>
                      <td style={td}>{r.parsed ? r.parsed.quantity : r.raw["Stock Quantity"]}</td>
                      <td style={{ ...td, color: hasErr ? DANGER : r.existing ? WARN : ACCENT }}>
                        {hasErr
                          ? r.errors.map((e) => e.message).join(" ")
                          : r.existing
                            ? mode === "update" ? "Exists: will update" : "Exists: will skip"
                            : "New"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {locations.length > 1 && (
            <label style={{ fontSize: 13, color: MUTED }}>
              Import stock into location{" "}
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ marginLeft: 8 }}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
        </>
      )}

      {serverError && <div role="alert" style={{ color: DANGER, fontSize: 13 }}>{serverError}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {(rows.length > 0 || serverError) && <button type="button" style={secondaryButtonStyle} onClick={reset}>Clear</button>}
        <button
          type="button"
          style={{ ...primaryButtonStyle, opacity: nothingToDo || submitting || missing.length > 0 ? 0.5 : 1 }}
          disabled={nothingToDo || submitting || missing.length > 0 || rows.length === 0}
          onClick={submit}
        >
          {submitting
            ? "Importing…"
            : mode === "update" && existingCount > 0
              ? `Import ${newCount} new, update ${existingCount}`
              : `Import ${newCount} product${newCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 500, position: "sticky", top: 0, background: "var(--mv-surface, #121a16)" };
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };