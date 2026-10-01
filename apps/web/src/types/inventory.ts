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

export const REQUIRED_CSV_COLUMNS = [
  "SKU",
  "Product Name",
  "Category",
  "Cost Price",
  "Stock Quantity",
  "Reorder Level",
] as const;
export type CSVFieldKey = (typeof REQUIRED_CSV_COLUMNS)[number];

export interface CSVRow {
  rowNumber: number;
  SKU?: string;
  "Product Name"?: string;
  Category?: string;
  "Cost Price"?: string;
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
  /** Present only when the row has zero errors. Cost is already in cents. */
  parsed: ProductDraft | null;
  errors: CSVFieldError[];
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
  weights_balanced: boolean;
  baselines: Record<keyof PricingWeights, { price_cents: number; margin_percent: number }>;
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

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
