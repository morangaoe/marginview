/**
 * Records failures into error_events for the platform admin dashboard.
 * Writing an event never throws: a broken log must not break the request that failed.
 *
 * API 5xx responses are captured in one place (errorCapture middleware, on response
 * finish). Route handlers that catch their own errors call captureError(req, err) so
 * the stack trace is attached to that row instead of only reaching the console.
 */
import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool";

export type ErrorSource = "api" | "web" | "scraper" | "auth" | "ai" | "worker";

export interface ErrorEventInput {
  source: ErrorSource;
  level?: "error" | "warn";
  message: string;
  stack?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  userId?: string | null;
  organizationId?: string | null;
  context?: Record<string, unknown>;
  /** Override grouping; defaults to source + normalised path + message. */
  fingerprintKey?: string;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Strips ids and numbers so "/products/<uuid>" and "row 17" group with their siblings. */
function normalise(s: string): string {
  return s.replace(UUID_RE, ":id").replace(/\b\d+\b/g, "N").slice(0, 300);
}

function fingerprintOf(e: ErrorEventInput): string {
  const key = e.fingerprintKey ?? `${e.source}|${normalise(e.path ?? "")}|${normalise(e.message)}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

const clip = (s: string | null | undefined, n: number) => (s == null ? null : String(s).slice(0, n));
const asUuid = (s: string | null | undefined) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null);

export async function recordEvent(e: ErrorEventInput): Promise<void> {
  try {
    await pool.query(
      `insert into error_events
         (source, level, fingerprint, message, stack, method, path, status, user_id, organization_id, context)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        e.source,
        e.level ?? "error",
        fingerprintOf(e),
        clip(e.message, 2000) || "(no message)",
        clip(e.stack, 8000),
        clip(e.method, 10),
        clip(e.path, 500),
        e.status ?? null,
        asUuid(e.userId),
        asUuid(e.organizationId),
        JSON.stringify(e.context ?? {}),
      ],
    );
  } catch (err) {
    console.error("[errorLog] could not record event:", (err as Error).message, "| original:", e.message);
  }
}

/** Attach a caught error to this request; errorCapture writes it when the 5xx response finishes. */
export function captureError(req: Request, err: unknown, label?: string): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(label ?? `${req.method} ${req.originalUrl} failed`, e);
  req.res!.locals.capturedError = { message: label ? `${label}: ${e.message}` : e.message, stack: e.stack };
}

/** Records every API response with status >= 500, with the captured error if a handler supplied one. */
export function errorCapture(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    if (res.statusCode < 500) return;
    const captured = res.locals.capturedError as { message: string; stack?: string } | undefined;
    void recordEvent({
      source: "api",
      message: captured?.message ?? `HTTP ${res.statusCode} with no error captured`,
      stack: captured?.stack,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      userId: req.user?.id,
      organizationId: req.user?.organizationId,
    });
  });
  next();
}
