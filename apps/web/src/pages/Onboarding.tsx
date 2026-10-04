import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { request } from "../lib/useApi";
import "../styles/extra-pages.css";

/**
 * FIXES applied:
 *  1. nav("/dashboard") → nav("/app")  — /dashboard is not a registered route.
 *  2. POST "/onboarding" → POST "/onboarding" (relative, handled by useApi's
 *     request() which prepends /api). This now matches the new route we added
 *     in apps/api/src/routes/onboarding.ts.
 *  3. Error messages are surfaced from the API response properly.
 */

const FIELDS = ["sku", "name", "category", "cost", "price", "quantity"] as const;
type Field = (typeof FIELDS)[number];
const REQUIRED: Field[] = ["sku", "name", "cost"];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export default function Onboarding() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [location, setLocation] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [map, setMap] = useState<Partial<Record<Field, number>>>({});
  const [margins, setMargins] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => {
    if (map.category == null) return ["All products"];
    const set = new Set(body.map((r) => (r[map.category!] || "").trim() || "Uncategorised"));
    return Array.from(set);
  }, [body, map.category]);

  async function onFile(file: File) {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      return setErr("That file has no data rows. Check it has a header row and at least one product.");
    }
    setErr(null);
    setHeader(rows[0]);
    setBody(rows.slice(1));
    const guess: Partial<Record<Field, number>> = {};
    FIELDS.forEach((f) => {
      const i = rows[0].findIndex((h) => h.trim().toLowerCase() === f);
      if (i >= 0) guess[f] = i;
    });
    setMap(guess);
  }

  function next() {
    setErr(null);
    if (step === 1 && !location.trim()) {
      return setErr("Name your first location, for example "Main warehouse".");
    }
    if (step === 2 && body.length > 0) {
      const missing = REQUIRED.filter((f) => map[f] == null);
      if (missing.length) return setErr(`Match these columns: ${missing.join(", ")}.`);
    }
    setStep(step + 1);
  }

  async function finish() {
    setBusy(true);
    setErr(null);
    try {
      const rows = body.map((r) => {
        const o: Record<string, string> = {};
        FIELDS.forEach((f) => { if (map[f] != null) o[f] = (r[map[f]!] || "").trim(); });
        return o;
      });

      // FIX: POST /onboarding (not /dashboard). request() prepends /api automatically.
      await request("/onboarding", {
        method: "POST",
        body: JSON.stringify({ location, rows, targetMargins: margins }),
      });

      // FIX: Navigate to /app, not /dashboard (which is an unregistered route).
      nav("/app", { replace: true });
    } catch (e) {
      setErr((e as Error).message ?? "Setup failed. Please try again.");
    } finally {
      setBusy(false);
    }
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
          />
        </div>
      )}

      {step === 2 && (
        <>
          <div className="mv-field">
            <label htmlFor="ob-file">
              Products CSV (optional — you can add products manually later)
            </label>
            <input
              id="ob-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </div>
          {header.length > 0 && (
            <div className="mv-row" style={{ marginTop: 16 }}>
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
                      setMap({
                        ...map,
                        [f]: e.target.value === "" ? undefined : Number(e.target.value),
                      })
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
              <p className="mv-sub">{body.length} products ready to import.</p>
            </div>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <p className="mv-sub">
            Set a target margin for each category. Cost-plus pricing uses this. You can change
            it later in Settings.
          </p>
          {categories.map((c) => (
            <div className="mv-field" key={c} style={{ marginBottom: 12 }}>
              <label htmlFor={`tm-${c}`}>{c} target margin (%)</label>
              <input
                id={`tm-${c}`}
                type="number"
                min={0}
                max={99}
                value={margins[c] ?? ""}
                onChange={(e) => setMargins({ ...margins, [c]: Number(e.target.value) })}
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
          <button className="mv-btn secondary" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < 3 ? (
          <button className="mv-btn" onClick={next}>
            Continue
          </button>
        ) : (
          <button className="mv-btn" onClick={finish} disabled={busy}>
            {busy ? "Setting up…" : "Finish setup"}
          </button>
        )}
      </div>
    </div>
  );
}
