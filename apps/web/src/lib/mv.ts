import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../types/inventory"; // your existing authenticated fetch helper

export function mv<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  return apiJson<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

export function useMv<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(() => {
    if (!path) return;
    setLoading(true);
    mv<T>("GET", path).then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}

export const money = (cents: number | null | undefined) =>
  cents == null ? "-" : (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
