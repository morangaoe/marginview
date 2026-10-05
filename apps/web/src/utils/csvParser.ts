import {
  ALL_CSV_COLUMNS,
  REQUIRED_CSV_COLUMNS,
  type CSVFieldError,
  type CSVFieldKey,
  type CSVRow,
  type CSVValidatedRow,
} from "../types/inventory";

const INT_MAX = 2_147_483_647;

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

/**
 * Decodes raw file bytes. Tries UTF-8 first; if the bytes aren't valid UTF-8
 * (typical of "CSV" saved from older Excel), falls back to Windows-1252 so
 * accented characters survive instead of turning into garbage.
 */
export function decodeCsvBuffer(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("windows-1252").decode(b);
  }
}

/** Picks the delimiter used by the header line: comma, semicolon (EU Excel) or tab. */
export function detectDelimiter(text: string): string {
  const src = text.replace(/^\uFEFF/, "");
  const end = src.search(/\r|\n/);
  const line = end === -1 ? src : src.slice(0, end);
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    let n = 0;
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Splits CSV text into rows of cells. Honors quoted fields (embedded delimiters,
 * newlines, "" escapes), CRLF / LF / lone-CR line endings, and a leading BOM.
 * The delimiter is auto-detected unless passed in.
 */
export function parseCSVText(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const delim = delimiter ?? detectDelimiter(src);
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
    else if (c === delim) pushField();
    else if (c === "\n") pushRow();
    else if (c === "\r") {
      if (next === "\n") continue; // CRLF: the \n ends the row
      pushRow(); // old-Mac lone CR
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Header spellings we accept, mapped to our canonical column names. */
const HEADER_ALIASES: Record<string, CSVFieldKey> = {
  sku: "SKU", productsku: "SKU", itemsku: "SKU", skucode: "SKU", itemcode: "SKU",
  productname: "Product Name", name: "Product Name", title: "Product Name",
  producttitle: "Product Name", itemname: "Product Name", product: "Product Name",
  category: "Category", productcategory: "Category",
  costprice: "Cost Price", cost: "Cost Price", unitcost: "Cost Price", cogs: "Cost Price",
  costusd: "Cost Price", purchaseprice: "Cost Price", buyingprice: "Cost Price",
  sellingprice: "Selling Price", price: "Selling Price", retailprice: "Selling Price",
  saleprice: "Selling Price", currentprice: "Selling Price", sellprice: "Selling Price",
  stockquantity: "Stock Quantity", quantity: "Stock Quantity", qty: "Stock Quantity",
  stock: "Stock Quantity", onhand: "Stock Quantity", stockonhand: "Stock Quantity",
  instock: "Stock Quantity",
  reorderlevel: "Reorder Level", reorderpoint: "Reorder Level",
  minstock: "Reorder Level", minimumstock: "Reorder Level",
};

export function rowsToObjects(grid: string[][]): {
  rows: CSVRow[];
  missingColumns: CSVFieldKey[];
  ignoredColumns: string[];
} {
  if (grid.length === 0) {
    return { rows: [], missingColumns: [...REQUIRED_CSV_COLUMNS], ignoredColumns: [] };
  }

  const header = grid[0].map((h) => h.trim());
  // column index -> canonical key. First column wins if two map to the same key.
  const colToKey = new Map<number, CSVFieldKey>();
  const claimed = new Set<CSVFieldKey>();
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[norm(h)];
    if (key && !claimed.has(key)) {
      claimed.add(key);
      colToKey.set(i, key);
    } else if (h) {
      ignoredColumns.push(h);
    }
  });

  const missingColumns = REQUIRED_CSV_COLUMNS.filter((c) => !claimed.has(c));
  const rows = grid.slice(1).map((cells, idx) => {
    const obj: Record<string, string | number> = { rowNumber: idx + 2 };
    colToKey.forEach((key, i) => {
      obj[key] = (cells[i] ?? "").trim();
    });
    return obj as unknown as CSVRow;
  });
  return { rows, missingColumns, ignoredColumns };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * Converts an amount string to integer cents using string math (no float drift).
 * Accepts "12", "12.5", "$1,200.50", and European "12,50" / "1.200,50".
 * Returns null if invalid.
 */
export function dollarsToCents(input: string): number | null {
  let s = input.trim().replace(/^[$€£]\s*/, "").replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.200,50
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", "."); // 12,50
  else s = s.replace(/,/g, ""); // 1,200.50

  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "12", "1,000" -> number; anything else (negatives, decimals, text) -> null. */
function wholeNumber(raw: string): number | null {
  const s = /^\d{1,3}(,\d{3})+$/.test(raw) ? raw.replace(/,/g, "") : raw;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n <= INT_MAX ? n : null;
}

export function validateCSVRow(
  row: CSVRow,
  existingSkus: Set<string>,
  seenInFile: Set<string>,
): CSVValidatedRow {
  const errors: CSVFieldError[] = [];
  const err = (field: CSVFieldKey, message: string) => errors.push({ field, message });

  const sku = (row.SKU ?? "").trim();
  const name = (row["Product Name"] ?? "").trim();
  const category = (row.Category ?? "").trim();
  const costRaw = (row["Cost Price"] ?? "").trim();
  const priceRaw = (row["Selling Price"] ?? "").trim();
  const stockRaw = (row["Stock Quantity"] ?? "").trim();
  const reorderRaw = (row["Reorder Level"] ?? "").trim();

  if (!sku) err("SKU", "SKU is required.");
  else if (sku.length > 100) err("SKU", "SKU is longer than 100 characters.");
  else if (seenInFile.has(sku)) err("SKU", `SKU "${sku}" appears more than once in this file.`);
  if (sku) seenInFile.add(sku);

  if (!name) err("Product Name", "Product name is required.");
  else if (name.length > 255) err("Product Name", "Product name is longer than 255 characters.");

  // Any category text is accepted; blank falls back to "Other".
  if (category.length > 80) err("Category", "Category is longer than 80 characters.");

  let costCents = 0;
  if (!costRaw) err("Cost Price", "Cost price is required.");
  else {
    const c = dollarsToCents(costRaw);
    if (c === null) err("Cost Price", `"${costRaw}" is not a valid amount (use e.g. 12.50).`);
    else if (c <= 0) err("Cost Price", "Cost price must be greater than 0.");
    else if (c > INT_MAX) err("Cost Price", "Cost price is too large.");
    else costCents = c;
  }

  let priceCents: number | null = null;
  if (priceRaw) {
    const p = dollarsToCents(priceRaw);
    if (p === null) err("Selling Price", `"${priceRaw}" is not a valid amount (use e.g. 19.99).`);
    else if (p <= 0) err("Selling Price", "Selling price must be greater than 0.");
    else if (p > INT_MAX) err("Selling Price", "Selling price is too large.");
    else priceCents = p;
  }

  let quantity = 0;
  if (stockRaw) {
    const q = wholeNumber(stockRaw);
    if (q === null) err("Stock Quantity", "Stock quantity must be a whole number, 0 or more.");
    else quantity = q;
  }

  let reorder = 0;
  if (reorderRaw) {
    const r = wholeNumber(reorderRaw);
    if (r === null) err("Reorder Level", "Reorder level must be a whole number, 0 or more.");
    else reorder = r;
  }

  return {
    rowNumber: row.rowNumber,
    raw: row,
    errors,
    existing: !!sku && existingSkus.has(sku),
    parsed:
      errors.length === 0
        ? {
            sku,
            name,
            category: category || "Other",
            cost_cents: costCents,
            price_cents: priceCents,
            quantity,
            reorder_level: reorder,
          }
        : null,
  };
}

/** Raw CSV text in, validated rows out. `existingSkus` is the SKU set already known to the client. */
export function parseAndValidateCSV(
  text: string,
  existingSkus: Set<string>,
): { rows: CSVValidatedRow[]; missingColumns: CSVFieldKey[]; ignoredColumns: string[] } {
  const { rows, missingColumns, ignoredColumns } = rowsToObjects(parseCSVText(text));
  const seen = new Set<string>();
  return { rows: rows.map((r) => validateCSVRow(r, existingSkus, seen)), missingColumns, ignoredColumns };
}

/** The downloadable template. Columns match what the uploader recognises. */
export const CSV_TEMPLATE =
  [
    ALL_CSV_COLUMNS.join(","),
    "SKU-001,Vitamin C Serum,Skincare,12.50,24.99,40,10",
    "SKU-002,Linen Throw Blanket,Home Goods,18.00,,15,5",
  ].join("\n") + "\n";