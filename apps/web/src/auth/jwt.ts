/**
 * Minimal JWT payload decoder for the frontend.
 * NEVER use the result for access control — that happens server-side.
 * This is purely so the UI can display the user's name and role.
 *
 * FIX: The onboarding route signs tokens with { sub, id, userId, email, organizationId, role }.
 * The login route signs with { sub, id, organizationId, role }.
 * JwtPayload now covers both claim shapes, and resolveId() normalises them.
 */
export interface JwtPayload {
  /** Canonical user id — always present after the auth.ts fix */
  id?: string;
  /** Standard JWT subject — mirrors id in our tokens */
  sub?: string;
  /** Legacy alias emitted by some earlier onboarding builds */
  userId?: string;
  organizationId: string;
  role: "owner" | "pricing_manager" | "inventory_manager" | "viewer";
  email?: string;
  iat?: number;
  exp?: number;
}

/** Returns the user id regardless of which claim field the server used. */
export function resolveId(payload: JwtPayload): string | undefined {
  return payload.id ?? payload.sub ?? payload.userId;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

export function isExpired(payload: JwtPayload): boolean {
  if (!payload.exp) return false;
  // Add a 30-second buffer so we log out slightly before the server rejects the token
  return Date.now() / 1000 > payload.exp - 30;
}
