// In production, set VITE_API_URL to your deployed API's full origin
// (e.g. https://marginview-api.up.railway.app). Locally this stays
// unset and falls back to the relative "/api" path, which Vite's
// dev server proxies to http://localhost:4000 (see vite.config.ts).
const API_ORIGIN = import.meta.env.VITE_API_URL || "";
const BASE = `${API_ORIGIN}/api`;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("mv_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) =>
    fetch(`${BASE}${path}`, { headers: { ...authHeaders() } }).then((r) => handle<T>(r)),

  post: <T>(path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),

  patch: <T>(path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r)),

  delete: <T>(path: string) =>
    fetch(`${BASE}${path}`, {
      method: "DELETE",
      headers: { ...authHeaders() },
    }).then((r) => handle<T>(r)),
};