import {
  CATEGORIES,
  REQUIRED_CSV_COLUMNS,
  type CSVFieldError,
  type CSVFieldKey,
  type CSVRow,
  type CSVValidatedRow,
  type ProductDraft,
} from "../types/inventory";

/** Splits CSV text into rows of cells, honoring quoted fields with commas and "" escapes. */
export function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  const src = text.replace(/^\uFEFF/, ""); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\n") pushRow();
    else if (c === "\r") continue;
    else field += c;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function rowsToObjects(grid: string[][]): { rows: CSVRow[]; missingColumns: CSVFieldKey[] } {
  if (grid.length === 0) return { rows: [], missingColumns: [...REQUIRED_CSV_COLUMNS] };
  const header = grid[0].map((h) => h.trim());
  const missingColumns = REQUIRED_CSV_COLUMNS.filter((c) => !header.includes(c));
  const rows = grid.slice(1).map((cells, idx) => {
    const obj: Record<string, string | number> = { rowNumber: idx + 2 };
    header.forEach((name, i) => {
      if ((REQUIRED_CSV_COLUMNS as readonly string[]).includes(name)) obj[name] = (cells[i] ?? "").trim();
    });
    return obj as unknown as CSVRow;
  });
  return { rows, missingColumns };
}

/**
 * Converts a dollar string ("12", "12.5", "$1,200.50") to integer cents using
 * string math, so there is no floating-point drift. Returns null if invalid.
 */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

const isCategory = (v: string) => (CATEGORIES as readonly string[]).includes(v);

export function validateCSVRow(row: CSVRow, existingSkus: Set<string>, seenInFile: Set<string>): CSVValidatedRow {
  const errors: CSVFieldError[] = [];
  const err = (field: CSVFieldKey, message: string) => errors.push({ field, message });

  const sku = (row.SKU ?? "").trim();
  const name = (row["Product Name"] ?? "").trim();
  const category = (row.Category ?? "").trim();
  const costRaw = (row["Cost Price"] ?? "").trim();
  const stockRaw = (row["Stock Quantity"] ?? "").trim();
  const reorderRaw = (row["Reorder Level"] ?? "").trim();

  if (!sku) err("SKU", "SKU is required.");
  else if (seenInFile.has(sku)) err("SKU", `SKU "${sku}" appears more than once in this file.`);
  else if (existingSkus.has(sku)) err("SKU", `SKU "${sku}" already exists.`);
  if (sku) seenInFile.add(sku);

  if (!name) err("Product Name", "Product name is required.");

  if (!category) err("Category", "Category is required.");
  else if (!isCategory(category)) err("Category", `"${category}" is not a recognized category.`);

  let costCents = 0;
  if (!costRaw) err("Cost Price", "Cost price is required.");
  else {
    const c = dollarsToCents(costRaw);
    if (c === null) err("Cost Price", `"${costRaw}" is not a valid amount (use e.g. 12.50).`);
    else if (c <= 0) err("Cost Price", "Cost price must be greater than 0.");
    else costCents = c;
  }

  const wholeNumber = (raw: string, field: CSVFieldKey, label: string): number => {
    if (!raw) {
      err(field, `${label} is required.`);
      return 0;
    }
    if (!/^\d+$/.test(raw)) {
      err(field, `${label} must be a whole number, 0 or more.`);
      return 0;
    }
    return Number(raw);
  };
  const quantity = wholeNumber(stockRaw, "Stock Quantity", "Stock quantity");
  const reorder = wholeNumber(reorderRaw, "Reorder Level", "Reorder level");

  return {
    rowNumber: row.rowNumber,
    raw: row,
    errors,
    parsed:
      errors.length === 0
        ? { sku, name, category, cost_cents: costCents, quantity, reorder_level: reorder }
        : null,
  };
}

/** Raw CSV text in, validated rows out. `existingSkus` is the SKU set already known to the client. */
export function parseAndValidateCSV(
  text: string,
  existingSkus: Set<string>
): { rows: CSVValidatedRow[]; missingColumns: CSVFieldKey[] } {
  const { rows, missingColumns } = rowsToObjects(parseCSVText(text));
  const seen = new Set<string>();
  return { rows: rows.map((r) => validateCSVRow(r, existingSkus, seen)), missingColumns };
}
