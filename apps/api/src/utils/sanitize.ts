import { z } from "zod";

/** Control characters (except none: tabs and newlines are not valid in a name either). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g;

/** Strips markup characters, control and bidi-override characters, and collapses whitespace. */
export function cleanText(value: string): string {
  return value.replace(CONTROL_CHARS, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

/** A required single-line name that cannot carry HTML. Rejects values that are empty after cleaning. */
export function nameField(max = 120) {
  return z.string().transform(cleanText).pipe(z.string().min(1, "Required.").max(max, `Must be ${max} characters or fewer.`));
}

export function optionalTextField(max = 255) {
  return z.string().transform(cleanText).pipe(z.string().max(max)).optional();
}

/** Escapes a value for use inside an HTML email body. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Prefixes cells a spreadsheet would run as a formula (=, +, -, @). Use when writing CSV exports. */
export function csvSafeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
