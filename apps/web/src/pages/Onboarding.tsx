import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request } from "../lib/useApi";
import { parseCSVText } from "../utils/csvParser";
import "../styles/extra-pages.css";

/**
 * Setup wizard: location -> optional product CSV -> target margins.
 *
 * Changes from the previous version:
 *  - Fixed the unescaped quotes in the step-1 error message (broke the build).
 *  - Reuses the shared CSV parser (handles BOM, quoted commas) instead of a private copy.
 *  - Recognises common header names ("Product Name", "Cost Price", "Stock Quantity"...).
 *  - Shows how many rows will import vs. be skipped BEFORE submitting.
 *  - Shows which rows the server skipped, and why, after submitting.
 *  - Lets the owner skip setup entirely.
 *  - Tells ProtectedRoute that onboarding is done so it doesn't bounce the user back.
 */

const FIELDS = ["sku", "name", "category", "cost", "price", "quantity"] as const;
type Field = (typeof FIELDS)[number];
const REQUIRED: Field[] = ["sku", "name", "cost"];

const HEADER_ALIASES: Record<Field, string[]> = {
  sku: ["sku", "product sku", "item sku"],
  name: ["name", "product name", "title", "product"],
  category: ["category", "product category", "type"],
  cost: ["cost", "cost price", "unit cost", "cogs"],
  price: ["price", "selling price", "retail price", "sale price"],
  quantity: ["quantity", "stock quantity", "stock", "qty", "on hand"],
};

const MAX_ROWS = 2000;
const DEFAULT_MARGIN = 40;

type Skipped = { row: number; sku?: string; reason: string };
type FinishResult = { productsImported: number; skippedCount: number; skipped: Skipped[] };

function validCost(raw: string): boolean {
  const n = Number(raw.trim().replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0;
}

export default function Onboarding() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [location, setLocation] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [map, setMap] = useState<Partial<Record<Field, number>>>({});
  const [margins, setMargins] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FinishResult | null>(null);

  const cell = (r: string[], f: Field) => (map[f] == null ? "" : (r[map[f]!] ?? "").trim());

  const categories = useMemo(() => {
    if (map.category == null || body.length === 0) return ["All products"];
    const set = new Set(body.map((r) => (r[map.category!] || "").trim() || "General"));
    return Array.from(set).sort();
  }, [body, map.category]);

  /** Rows that the server will accept vs. skip, computed from the current column mapping. */
  const preview = useMemo(() => {
    if (!body.length) return { ok: 0, bad: 0 };
    const seen = new Set<string>();
    let ok = 0;
    for (const r of body) {
      const sku = cell(r, "sku");
      if (sku && cell(r, "name") && validCost(cell(r, "cost")) && !seen.has(sku)) {
        seen.add(sku);
        ok++;
      }
    }
    return { ok, bad: body.length - ok };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, map]);

  async function onFile(file: File) {
    setErr(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return setErr("Please choose a .csv file.");
    }
    const rows = parseCSVText(await file.text());
    if (rows.length < 2) {
      return setErr("That file has no data rows. Check it has a header row and at least one product.");
    }
    if (rows.length - 1 > MAX_ROWS) {
      return setErr(`That file has ${rows.length - 1} products. Import up to ${MAX_ROWS} at a time.`);
    }
    const head = rows[0].map((h) => h.trim());
    const guess: Partial<Record<Field, number>> = {};
    FIELDS.forEach((f) => {
      const i = head.findIndex((h) => HEADER_ALIASES[f].includes(h.toLowerCase()));
      if (i >= 0) guess[f] = i;
    });
    setFileName(file.name);
    setHeader(head);
    setBody(rows.slice(1));
    setMap(guess);
  }

  function clearFile() {
    setFileName(null);
    setHeader([]);
    setBody([]);
    setMap({});
    setErr(null);
  }

  function next() {
    setErr(null);
    if (step === 1 && !location.trim()) {
      return setErr('Name your first location, for example "Main warehouse".');
    }
    if (step === 2 && body.length > 0) {
      const missing = REQUIRED.filter((f) => map[f] == null);
      if (missing.length) return setErr(`Match these columns: ${missing.join(", ")}.`);
      if (preview.ok === 0) return setErr("None of the rows can be imported. Check the SKU, name and cost columns.");
    }
    setStep(step + 1);
  }

  function markDone() {
    // ProtectedRoute listens for this so it stops redirecting to the wizard.
    window.dispatchEvent(new Event("mv:onboarding-complete"));
  }

  async function skipAll() {
    setBusy(true);
    setErr(null);
    try {
      await request("/onboarding/skip", { method: "POST" });
      markDone();
      nav("/app", { replace: true });
    } catch (e) {
      setErr((e as Error).message ?? "Could not skip setup. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setErr(null);

    const targetMargins: Record<string, number> = {};
    for (const c of categories) {
      const raw = margins[c];
      const n = raw === undefined || raw === "" ? DEFAULT_MARGIN : Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 99) {
        return setErr(`Target margin for ${c} must be between 0 and 99.`);
      }
      targetMargins[c] = n;
    }

    setBusy(true);
    try {
      const rows = body.map((r) => {
        const o: Record<string, string> = {};
        FIELDS.forEach((f) => {
          if (map[f] != null) o[f] = cell(r, f);
        });
        return o;
      });

      const res = await request<FinishResult>("/onboarding", {
        method: "POST",
        body: JSON.stringify({ location: location.trim(), rows, targetMargins }),
      });

      markDone();
      if (res.skippedCount > 0) {
        // Stay on the page so the owner can see what was left out.
        setResult(res);
      } else {
        nav("/app", { replace: true });
      }
    } catch (e) {
      setErr((e as Error).message ?? "Setup failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="mv-page" style={{ maxWidth: 720 }}>
        <h1>Workspace ready</h1>
        <p className="mv-sub">
          {result.productsImported} product{result.productsImported === 1 ? "" : "s"} imported.{" "}
          {result.skippedCount} row{result.skippedCount === 1 ? " was" : "s were"} skipped:
        </p>
        <ul>
          {result.skipped.map((s, i) => (
            <li key={i}>
              Row {s.row}
              {s.sku ? ` (${s.sku})` : ""}: {s.reason}
            </li>
          ))}
        </ul>
        {result.skippedCount > result.skipped.length && (
          <p className="mv-sub">…and {result.skippedCount - result.skipped.length} more.</p>
        )}
        <div className="mv-row" style={{ marginTop: 16 }}>
          <button className="mv-btn" onClick={() => nav("/app", { replace: true })}>
            Go to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mv-page" style={{ maxWidth: 720 }}>
      <h1>Set up your workspace</h1>
      <p className="mv-sub">Step {step} of 3</p>

      {step === 1 && (
        <div className="mv-field">
          <label htmlFor="ob-loc">First location</label>
          <input
            id="ob-loc"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Main warehouse"
            maxLength={120}
          />
        </div>
      )}

      {step === 2 && (
        <>
          <div className="mv-field">
            <label htmlFor="ob-file">Products CSV (optional. You can add products later.)</label>
            <input
              id="ob-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </div>

          {header.length > 0 && (
            <>
              <p className="mv-sub" style={{ marginTop: 16 }}>
                {fileName}: match your columns to ours.{" "}
                <button className="mv-btn secondary" onClick={clearFile} type="button">
                  Remove file
                </button>
              </p>
              <div className="mv-row">
                {FIELDS.map((f) => (
                  <div className="mv-field" key={f}>
                    <label htmlFor={`m-${f}`}>
                      {f}
                      {REQUIRED.includes(f) ? " (required)" : ""}
                    </label>
                    <select
                      id={`m-${f}`}
                      value={map[f] ?? ""}
                      onChange={(e) =>
                        setMap({ ...map, [f]: e.target.value === "" ? undefined : Number(e.target.value) })
                      }
                    >
                      <option value="">Not in my file</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="mv-sub">
                {preview.ok} product{preview.ok === 1 ? "" : "s"} ready to import
                {preview.bad > 0 ? `, ${preview.bad} will be skipped (missing or duplicate SKU, name, or cost)` : ""}.
              </p>
            </>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <p className="mv-sub">
            Set a target margin for each category. Cost-plus pricing uses this. Leave a field empty to use{" "}
            {DEFAULT_MARGIN}%. You can change it later in Settings.
          </p>
          {categories.map((c) => (
            <div className="mv-field" key={c} style={{ marginBottom: 12 }}>
              <label htmlFor={`tm-${c}`}>{c} target margin (%)</label>
              <input
                id={`tm-${c}`}
                type="number"
                min={0}
                max={99}
                placeholder={String(DEFAULT_MARGIN)}
                value={margins[c] ?? ""}
                onChange={(e) => setMargins({ ...margins, [c]: e.target.value })}
              />
            </div>
          ))}
        </>
      )}

      {err && (
        <p className="mv-error" role="alert">
          {err}
        </p>
      )}

      <div className="mv-row" style={{ marginTop: 16 }}>
        {step > 1 && (
          <button className="mv-btn secondary" onClick={() => setStep(step - 1)} disabled={busy}>
            Back
          </button>
        )}
        {step < 3 ? (
          <button className="mv-btn" onClick={next} disabled={busy}>
            {step === 2 && body.length === 0 ? "Skip this step" : "Continue"}
          </button>
        ) : (
          <button className="mv-btn" onClick={finish} disabled={busy}>
            {busy ? "Setting up…" : "Finish setup"}
          </button>
        )}
        <button className="mv-btn secondary" onClick={skipAll} disabled={busy} type="button">
          Skip setup
        </button>
      </div>
    </div>
  );
}