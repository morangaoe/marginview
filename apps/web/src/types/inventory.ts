// Shared API types for Inventory and Pricing. All money is integer CENTS.

export const CATEGORIES = [
  "Skincare",
  "Haircare",
  "Supplements",
  "Home Goods",
  "Apparel",
  "Accessories",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Location {
  id: string;
  name: string;
}

/** One row of GET /api/inventory/levels. `cost` is cents. */
export interface InventoryLevel {
  id: string;
  variant_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  category: string;
  cost: number;
  /** Selling price in cents, or null if none set. */
  price: number | null;
  /** ISO currency of cost and price, e.g. "USD". */
  currency: string;
  location_id: string;
  location_name: string;
  quantity: number;
  reorder_level: number;
}

/** Payload for POST /api/products, and each item of POST /api/products/bulk. */
export interface ProductDraft {
  sku: string;
  name: string;
  category: string;
  cost_cents: number;
  quantity: number;
  reorder_level: number;
  /** Optional selling price in cents. null/absent = no price set yet. */
  price_cents?: number | null;
  /** 3-letter ISO code. Omit to use the workspace default. */
  currency?: string;
  location_id?: string;
}

export type InventoryStatus = "healthy" | "low" | "critical";

export function statusFor(level: Pick<InventoryLevel, "quantity" | "reorder_level">): InventoryStatus {
  if (level.quantity <= 0) return "critical";
  if (level.quantity <= level.reorder_level) return "low";
  return "healthy";
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Must be present (under any recognised header name). */
export const REQUIRED_CSV_COLUMNS = ["SKU", "Product Name", "Cost Price"] as const;
/** Optional: blank cells fall back to defaults (Other / no price / 0 / 0). */
export const OPTIONAL_CSV_COLUMNS = ["Category", "Selling Price", "Stock Quantity", "Reorder Level"] as const;
export const ALL_CSV_COLUMNS = [...REQUIRED_CSV_COLUMNS, ...OPTIONAL_CSV_COLUMNS] as const;
export type CSVFieldKey = (typeof ALL_CSV_COLUMNS)[number];

/** Limits shared by the uploader and the server. */
export const CSV_MAX_ROWS = 2000;
export const CSV_MAX_BYTES = 5 * 1024 * 1024;

export interface CSVRow {
  rowNumber: number;
  SKU?: string;
  "Product Name"?: string;
  Category?: string;
  "Cost Price"?: string;
  "Selling Price"?: string;
  "Stock Quantity"?: string;
  "Reorder Level"?: string;
}

export interface CSVFieldError {
  field: CSVFieldKey;
  message: string;
}

export interface CSVValidatedRow {
  rowNumber: number;
  raw: CSVRow;
  /** Present only when the row has zero errors. Money is already in cents. */
  parsed: ProductDraft | null;
  errors: CSVFieldError[];
  /** True when the SKU is already in the catalog (a hint; the server is authoritative). */
  existing: boolean;
}

export type ImportMode = "skip" | "update";

export interface BulkImportResponse {
  created: number;
  updated: number;
  skipped: number;
  location_id: string;
  skipped_rows: { row: number; sku?: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface PricingWeights {
  cost_plus: number;
  value_based: number;
  keystone: number;
  dynamic: number;
}

export const DEFAULT_PRICING_WEIGHTS: PricingWeights = {
  cost_plus: 10,
  value_based: 20,
  keystone: 30,
  dynamic: 6,
};
export const DEFAULT_MARKUP_PERCENT = 40;

export interface OptimizedPricingResponse {
  variant_id: string;
  cost_cents: number;
  weights_input: PricingWeights;
  weights_normalized: PricingWeights;
  weights_effective: PricingWeights;
  weights_balanced: boolean;
  adjustments: string[];
  trusted_competitors: number;
  stock_pct: number | null;
  baselines: Record<keyof PricingWeights, { price_cents: number; margin_percent: number; warning?: string | null }>;
  breakdown: {
    strategy: keyof PricingWeights;
    weight_pct: number;
    price_cents: number;
    contribution_cents: number;
  }[];
  optimized_price_cents: number;
  margin_percent: number;
}

// ---------------------------------------------------------------------------
// API client
//
// Same conventions as src/api/client.ts and src/lib/useApi.ts:
//  - API origin comes from VITE_API_URL (empty locally, so Vite's /api proxy is used)
//  - auth is a Bearer token from localStorage ("mv_token"), not cookies
// Callers pass full paths that include the "/api" prefix, e.g. "/api/products".
// ---------------------------------------------------------------------------

// Trailing slashes are stripped so "https://api.up.railway.app/" doesn't produce "//api/...".
export const API_BASE: string = ((import.meta as any).env?.VITE_API_URL ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("mv_token");

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // fetch only throws on network/CORS failure ("Failed to fetch"), never on HTTP errors.
    throw new ApiError(
      0,
      API_BASE
        ? `Can't reach the server at ${API_BASE}. Check that it's running and that CORS allows this site.`
        : "Can't reach the server. Make sure the API is running and VITE_API_URL is set for production."
    );
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => undefined);

  if (!res.ok) {
    const message =
      typeof body?.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }

  // A 200 with a non-JSON body usually means the request hit the Vercel SPA rewrite
  // (index.html) because VITE_API_URL isn't set. Fail loudly instead of returning undefined.
  if (body === undefined) {
    throw new ApiError(
      res.status,
      "Server returned a non-JSON response. If this is production, check that VITE_API_URL points to your API."
    );
  }

  return body as T;
}

export function formatCents(cents: number, currency = "USD"): string {
  try {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency });
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`; // unknown currency code
  }
}