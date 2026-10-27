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

// The website is served by this process too, so its pages need a CSP that allows their own assets and Google sign-in.
const WEB_CSP =
  "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; " +
  "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://accounts.google.com/gsi/; " +
  "frame-src https://accounts.google.com/gsi/; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/** Baseline hardening: strict for JSON endpoints, a site-appropriate CSP for the website. */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const isApi = req.path.startsWith("/api/") || req.path.startsWith("/internal/") || req.path === "/health";
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", isApi ? "default-src 'none'; frame-ancestors 'none'" : WEB_CSP);
  res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
}
