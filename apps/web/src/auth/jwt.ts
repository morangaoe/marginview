/**
 * Minimal JWT payload decoder for the frontend.
 * NEVER use the result for access control — that happens server-side.
 * This is purely so the UI can display the user's name and role.
 */
export interface JwtPayload {
  id: string;
  organizationId: string;
  role: "owner" | "pricing_manager" | "inventory_manager" | "viewer";
  iat?: number;
  exp?: number;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const [, payloadB64] = token.split(".");
    const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

export function isExpired(payload: JwtPayload): boolean {
  if (!payload.exp) return false;
  return Date.now() / 1000 > payload.exp;
}
