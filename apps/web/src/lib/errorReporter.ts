/**
 * Sends browser crashes to POST /api/errors/client so they show up on the platform
 * admin dashboard. Never throws, never retries, and caps reports per page load so a
 * render loop can't flood the API.
 */
const API_ORIGIN = import.meta.env.VITE_API_URL ?? "";
const MAX_REPORTS_PER_PAGE = 20;

let sent = 0;
const seen = new Set<string>();

export interface ClientErrorReport {
  kind: "render" | "uncaught" | "unhandledrejection" | "api";
  message: string;
  stack?: string;
  componentStack?: string;
}

export function reportClientError(report: ClientErrorReport): void {
  const key = `${report.kind}|${report.message}`;
  if (seen.has(key) || sent >= MAX_REPORTS_PER_PAGE) return;
  seen.add(key);
  sent++;

  let token: string | null = null;
  try {
    token = localStorage.getItem("mv_token");
  } catch {
    /* storage unavailable */
  }
  try {
    void fetch(`${API_ORIGIN}/api/errors/client`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        ...report,
        message: report.message.slice(0, 2000),
        stack: report.stack?.slice(0, 8000),
        componentStack: report.componentStack?.slice(0, 4000),
        url: window.location.href.slice(0, 500),
        userAgent: navigator.userAgent.slice(0, 300),
      }),
    }).catch(() => undefined);
  } catch {
    /* reporting must never break the page */
  }
}

export function installErrorReporting(): void {
  window.addEventListener("error", (e) => {
    // Resource load failures (img/script) have no error object and are noise.
    if (!e.error && !e.message) return;
    reportClientError({ kind: "uncaught", message: e.message || String(e.error), stack: e.error?.stack });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    reportClientError({
      kind: "unhandledrejection",
      message: r instanceof Error ? r.message : typeof r === "string" ? r : JSON.stringify(r ?? null),
      stack: r instanceof Error ? r.stack : undefined,
    });
  });
}
