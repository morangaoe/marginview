import React, { useState } from "react";
import { CATEGORIES, type InventoryLevel, type Location, type ProductDraft } from "../types/inventory";
import { dollarsToCents } from "../utils/csvParser";
import CompetitorUrlInput, { type CompetitorEntry } from "./inventory/CompetitorUrlInput";
import "../styles/modules.css";

// Dark-theme styling. Override --mv-* variables in your tokens.css to match the live palette.
const C = {
  surface: "var(--mv-surface, #121a16)",
  field: "var(--mv-field, #0c120f)",
  border: "var(--mv-border, rgba(255,255,255,0.12))",
  text: "var(--mv-text, #e8efe9)",
  muted: "var(--mv-muted, #8fa396)",
  accent: "var(--mv-accent, #3fae7a)",
  accentText: "var(--mv-accent-text, #06130d)",
  danger: "var(--mv-danger, #e5735f)",
};

export const primaryButtonStyle: React.CSSProperties = {
  background: C.accent,
  color: C.accentText,
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  fontWeight: 600,
  cursor: "pointer",
};
export const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "8px 16px",
  fontWeight: 500,
  cursor: "pointer",
};

interface Props {
  mode: "add" | "edit";
  /** Existing level when editing (SKU, name, category, cost are editable; stock is edited in the table). */
  initial?: InventoryLevel;
  locations: Location[];
  onClose: () => void;
  /** Resolve with an error message to show inline, or null on success. */
  /** Second argument carries any competitor URLs added in the form (existing callers can ignore it). */
  onSubmit: (draft: ProductDraft, competitors: CompetitorEntry[]) => Promise<string | null>;
}

export function ProductFormModal({ mode, initial, locations, onClose, onSubmit }: Props) {
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [name, setName] = useState(initial?.product_name ?? "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [cost, setCost] = useState(initial ? (initial.cost / 100).toFixed(2) : "");
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : "0");
  const [reorder, setReorder] = useState(initial ? String(initial.reorder_level) : "10");
  const [locationId, setLocationId] = useState(initial?.location_id ?? locations[0]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!sku.trim()) errs.sku = "SKU is required.";
    if (!name.trim()) errs.name = "Product name is required.";
    const costCents = dollarsToCents(cost);
    if (costCents === null || costCents <= 0) errs.cost = "Enter an amount greater than 0 (e.g. 12.50).";
    if (mode === "add") {
      if (!/^\d+$/.test(quantity)) errs.quantity = "Whole number, 0 or more.";
      if (!/^\d+$/.test(reorder)) errs.reorder = "Whole number, 0 or more.";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    setFormError(null);
    const message = await onSubmit({
      sku: sku.trim(),
      name: name.trim(),
      category,
      cost_cents: costCents!,
      quantity: Number(quantity),
      reorder_level: Number(reorder),
      location_id: locationId || undefined,
    }, competitors);
    setSaving(false);
    if (message) setFormError(message);
    else onClose();
  }

  const input = (hasError: boolean): React.CSSProperties => ({
    width: "100%",
    boxSizing: "border-box",
    background: C.field,
    color: C.text,
    border: `1px solid ${hasError ? C.danger : C.border}`,
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 14,
  });
  const label: React.CSSProperties = { display: "block", color: C.muted, fontSize: 13, marginBottom: 4 };
  const errText = (k: string) => errors[k] && <div style={{ color: C.danger, fontSize: 12, marginTop: 4 }}>{errors[k]}</div>;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "add" ? "Add product" : "Edit product"}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        noValidate
        style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, width: "100%", maxWidth: 480, display: "grid", gap: 14 }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>{mode === "add" ? "Add product" : "Edit product"}</h2>

        <div>
          <label style={label} htmlFor="pf-sku">SKU</label>
          <input id="pf-sku" style={input(!!errors.sku)} value={sku} onChange={(e) => setSku(e.target.value)} />
          {errText("sku")}
        </div>
        <div>
          <label style={label} htmlFor="pf-name">Product name</label>
          <input id="pf-name" style={input(!!errors.name)} value={name} onChange={(e) => setName(e.target.value)} />
          {errText("name")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={label} htmlFor="pf-cat">Category</label>
            <select id="pf-cat" style={input(false)} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              {!(CATEGORIES as readonly string[]).includes(category) && <option value={category}>{category}</option>}
            </select>
          </div>
          <div>
            <label style={label} htmlFor="pf-cost">Cost price (USD)</label>
            <input id="pf-cost" inputMode="decimal" style={input(!!errors.cost)} value={cost} onChange={(e) => setCost(e.target.value)} />
            {errText("cost")}
          </div>
        </div>

        {mode === "add" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={label} htmlFor="pf-qty">Stock quantity</label>
                <input id="pf-qty" inputMode="numeric" style={input(!!errors.quantity)} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                {errText("quantity")}
              </div>
              <div>
                <label style={label} htmlFor="pf-reorder">Reorder level</label>
                <input id="pf-reorder" inputMode="numeric" style={input(!!errors.reorder)} value={reorder} onChange={(e) => setReorder(e.target.value)} />
                {errText("reorder")}
              </div>
            </div>
            {locations.length > 0 && (
              <div>
                <label style={label} htmlFor="pf-loc">Location</label>
                <select id="pf-loc" style={input(false)} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {/* Re-map the shared tokens so the competitor controls match this dark modal */}
        <div
          style={{
            "--m-surface": C.surface, "--m-bg": C.field, "--m-border": C.border,
            "--m-text": C.text, "--m-muted": C.muted, "--m-accent": C.accent, "--m-danger": C.danger,
          } as React.CSSProperties}
        >
          <CompetitorUrlInput value={competitors} onChange={setCompetitors} searchHint={name} />
          {mode === "edit" && (
            <div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>
              New URLs are added here. To review, check or remove existing ones, use the Competitors button on the row.
            </div>
          )}
        </div>

        {formError && <div role="alert" style={{ color: C.danger, fontSize: 13 }}>{formError}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>Cancel</button>
          <button type="submit" style={{ ...primaryButtonStyle, opacity: saving ? 0.6 : 1 }} disabled={saving}>
            {saving ? "Saving…" : mode === "add" ? "Add product" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
