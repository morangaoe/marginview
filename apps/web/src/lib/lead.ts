import { apiJson } from "../types/inventory";

const KEY = "mv_lead";

export const getLeadToken = (): string | null => {
  try { return localStorage.getItem(KEY); } catch { return null; }
};

export async function captureLead(email: string, source: "market_search" | "audit"): Promise<void> {
  const r = await apiJson<{ token: string }>("/api/public/leads", { method: "POST", body: JSON.stringify({ email, source }) });
  try { localStorage.setItem(KEY, r.token); } catch { /* private mode: token only lives for this call chain */ }
}

/** Public endpoints take the lead token, not the account token that apiJson sends by default. */
export function publicApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getLeadToken();
  return apiJson<T>(path, { ...init, headers: { Authorization: token ? `Bearer ${token}` : "" } });
}
