import "dotenv/config";
import { CookieOptions, NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { AuthedUser } from "../types";

const WEAK_SECRETS = new Set(["dev-secret", "change-me-in-production", "secret", "changeme", "jwt-secret"]);
const isDeployed = () => process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;

let cachedSecret: string | null = null;

/**
 * The signing secret. In production a missing or placeholder secret is fatal:
 * anyone who knows the fallback could mint a token for any workspace.
 */
export function jwtSecret(): string {
  if (cachedSecret) return cachedSecret;
  const s = process.env.JWT_SECRET?.trim();
  if (!s || WEAK_SECRETS.has(s)) {
    if (isDeployed()) {
      throw new Error("JWT_SECRET is missing or a placeholder. Set it to a long random value (e.g. `openssl rand -base64 48`).");
    }
    console.warn("[config] JWT_SECRET is not set. Using an insecure dev secret (local only).");
    cachedSecret = "dev-secret";
  } else {
    if (s.length < 32) console.warn("[config] JWT_SECRET is shorter than 32 characters. Use a longer random value.");
    cachedSecret = s;
  }
  return cachedSecret;
}

/** Comma-separated PLATFORM_ADMIN_EMAILS: people who can see every workspace, user and error. */
export function isPlatformAdminEmail(email: string): boolean {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/**
 * Self-service sign-up is off unless ALLOW_PUBLIC_SIGNUP=true. With it off, the only
 * way in is an account created by a workspace owner or a platform admin.
 */
export function publicSignupEnabled(): boolean {
  return process.env.ALLOW_PUBLIC_SIGNUP === "true";
}

export const SIGNUP_DISABLED = {
  error: "Marginview is invite-only. Ask your workspace owner or administrator to add you.",
  code: "signup_disabled",
} as const;

const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SESSION_SQL = `
  select u.id, u.organization_id, u.email, u.status, u.password_changed_at, r.name as role
    from users u
    join user_roles ur on ur.user_id = u.id and ur.location_id is null
    join roles r on r.id = ur.role_id
   where u.id = $1 and u.deleted_at is null
   limit 1`;

export const SESSION_COOKIE = "mv_session";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // matches the token's 12h expiry in signToken

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const isSafeMethod = (m: string) => m === "GET" || m === "HEAD" || m === "OPTIONS";

/** Origins allowed to call the API with a cookie session (same list CORS uses). */
export function allowedOriginList(): string[] {
  return (process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:5174")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * CSRF defence for cookie sessions: a state-changing request must come from our own site.
 * Browsers always send Origin on these; a missing or foreign one is refused. SameSite=Lax on
 * the cookie is the second layer.
 */
function originAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string") return false;
  return allowedOriginList().includes(origin.replace(/\/+$/, ""));
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isDeployed(),
    sameSite: "lax",
    path: "/api",
  };
}

/** Sets the session cookie; the browser never sees the token itself. */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/**
 * Verifies the token, then reloads the user from the database on every request.
 * Organization and role come from the database, never from the token, so disabling
 * a user, changing their role or resetting their password takes effect immediately.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  let raw: string | null = null;
  if (header?.startsWith("Bearer ")) {
    raw = header.slice("Bearer ".length);
  } else {
    // Browser sessions live in an httpOnly cookie that page scripts cannot read.
    raw = readCookie(req, SESSION_COOKIE);
    if (raw && !isSafeMethod(req.method) && !originAllowed(req)) {
      return res.status(403).json({ error: "Request blocked: it did not come from the Marginview site." });
    }
  }
  if (!raw) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  let claims: Record<string, any>;
  try {
    claims = jwt.verify(raw, jwtSecret(), { algorithms: ["HS256"] }) as Record<string, any>;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Lead tokens from /api/public share the secret but are not sessions.
  const id = claims.id ?? claims.userId ?? claims.sub;
  if (claims.kind === "lead" || typeof id !== "string" || !UUID_RE.test(id)) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const { rows } = await pool.query(SESSION_SQL, [id]);
    const u = rows[0];
    if (!u || u.status !== "active") {
      return res.status(401).json({ error: "This account is disabled or no longer exists." });
    }
    const changedAt: Date | null = u.password_changed_at;
    if (changedAt && typeof claims.iat === "number" && claims.iat < Math.floor(changedAt.getTime() / 1000)) {
      return res.status(401).json({ error: "Your password was changed. Sign in again." });
    }
    req.user = {
      id: u.id,
      organizationId: u.organization_id,
      role: u.role,
      email: u.email,
      isPlatformAdmin: isPlatformAdminEmail(u.email),
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Restrict a route to one or more roles. Server-side enforcement only —
 * never rely on the frontend to hide a button.
 */
export function requireRole(...roles: AuthedUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to do this" });
    }
    next();
  };
}

/** Platform operators only (PLATFORM_ADMIN_EMAILS). Must run after requireAuth. */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.isPlatformAdmin) {
    // 404 rather than 403 so the admin surface isn't advertised.
    return res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
  }
  next();
}

/** Claims are for the UI only; requireAuth re-reads organization and role from the database. */
export function signToken(user: Pick<AuthedUser, "id" | "organizationId" | "role">): string {
  return jwt.sign(
    { sub: user.id, id: user.id, organizationId: user.organizationId, role: user.role },
    jwtSecret(),
    { expiresIn: "12h", algorithm: "HS256" },
  );
}
