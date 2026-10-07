import { useCallback, useEffect, useState } from "react";
import { noteResponseStatus } from "../auth/session";

const API_ORIGIN = import.meta.env.VITE_API_URL ?? "";

/**
 * Low-level fetch helper used by Onboarding.tsx and a handful of other pages
 * that import `request` directly.
 *
 * FIX: The original threw Error(JSON.stringify(body.error)) for object-shaped
 * Zod errors, producing unreadable messages in the UI. This version flattens
 * them to a human-readable string in the same way as api/client.ts.
 */
export async function request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let token: string | null = null;
  try {
    token = localStorage.getItem("mv_token");
  } catch {
    /* localStorage may be unavailable */
  }

  const res = await fetch(`${API_ORIGIN}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  noteResponseStatus(res.status);
  if (res.status === 204) return undefined as T;
  if (res.ok) return res.json() as Promise<T>;

  // --- Error path ---
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.error === "string") {
      message = body.error;
    } else if (typeof body?.error === "object" && body.error !== null) {
      const fe = body.error.fieldErrors as Record<string, string[]> | undefined;
      if (fe) {
        message = Object.entries(fe)
          .map(([f, msgs]) => `${f}: ${msgs.join(", ")}`)
          .join(" | ") || "Validation failed.";
      } else {
        message = "Invalid request. Check the form and try again.";
      }
    } else if (typeof body?.message === "string") {
      message = body.message;
    }
  } catch {
    /* non-JSON body */
  }

  throw new Error(message);
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await request<T>(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load };
}
