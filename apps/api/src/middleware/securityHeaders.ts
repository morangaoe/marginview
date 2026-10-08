import { NextFunction, Request, Response } from "express";

/**
 * Every API response is per-user, so nothing may be stored by a browser or shared proxy.
 * Without this, a shared computer could replay one person's cached GET to the next.
 * Vary: Authorization covers any cache that ignores no-store.
 */
export function apiNoStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Authorization, Origin");
  next();
}

/** Baseline hardening for an API that only returns JSON. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
}
