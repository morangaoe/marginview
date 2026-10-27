/**
 * Centralised API client for apps/web.
 *
 * In production set VITE_API_URL to your deployed API origin
 * (e.g. https://marginview-api.up.railway.app).
 * Locally this stays unset and Vite's dev server proxies /api → localhost:4000.
 *
 * FIX: The original handle() re-JSON-stringified the error body, which meant
 * pages received Error messages like '{"fieldErrors":{"email":["Invalid email"]}}'
 * instead of a readable string. This version unwraps the error intelligently.
 */

import { noteResponseStatus } from "../auth/session";

const API_ORIGIN = import.meta.env.VITE_API_URL ?? "";
const BASE = `${API_ORIGIN}/api`;

// The session is an httpOnly cookie, so requests just opt in to sending it.
const CRED: RequestInit = { credentials: "include" };

/**
 * Turns a non-2xx response into a thrown Error whose .message is a
 * human-readable string the UI can display directly.
 */
async function handle<T>(res: Response, path = ""): Promise<T> {
  noteResponseStatus(res.status, path);
  if (res.status === 204) return undefined as T;

  if (res.ok) return res.json();

  // Try to extract a useful error message from the JSON body
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.error === "string") {
      message = body.error;
    } else if (typeof body?.error === "object" && body.error !== null) {
      // Zod flatten() shape: { formErrors: [], fieldErrors: { field: [msg] } }
      const fieldErrors = body.error.fieldErrors as Record<string, string[]> | undefined;
      if (fieldErrors) {
        const lines = Object.entries(fieldErrors)
          .map(([f, msgs]) => `${f}: ${msgs.join(", ")}`)
          .join(" | ");
        message = lines || "Validation failed. Check the form and try again.";
      } else {
        message = "Invalid request. Check the form and try again.";
      }
    } else if (typeof body?.message === "string") {
      message = body.message;
    }
  } catch {
    // Non-JSON body — use the status-based message
  }

  throw new Error(message);
}

export const api = {
  get: <T>(path: string) =>
    fetch(`${BASE}${path}`, { ...CRED }).then((r) => handle<T>(r, path)),

  post: <T>(path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      ...CRED,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r, path)),

  patch: <T>(path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      ...CRED,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r, path)),

  put: <T>(path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, {
      ...CRED,
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handle<T>(r, path)),

  delete: <T>(path: string) =>
    fetch(`${BASE}${path}`, {
      ...CRED,
      method: "DELETE",
    }).then((r) => handle<T>(r, path)),
};
