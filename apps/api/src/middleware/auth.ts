import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AuthedUser } from "../types";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

/**
 * FIX: The onboarding route signs tokens with claims:
 *   { sub, id, userId, email, organizationId, role }
 * The old auth.ts only expected { id, organizationId, role }.
 *
 * This middleware now reads all three id aliases so tokens from BOTH
 * /api/auth/login and /api/onboarding/register are accepted.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  try {
    const token = header.slice("Bearer ".length);
    const raw = jwt.verify(token, JWT_SECRET) as Record<string, any>;

    // Normalise: accept id | userId | sub in that priority order
    const id: string | undefined = raw.id ?? raw.userId ?? raw.sub;
    const organizationId: string | undefined = raw.organizationId ?? raw.organization_id ?? raw.org_id;

    if (!id || !organizationId || !raw.role) {
      return res.status(401).json({ error: "Token is missing required claims" });
    }

    req.user = { id, organizationId, role: raw.role } as AuthedUser;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
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

/**
 * Signs a token whose claims exactly match what requireAuth now reads.
 * Called by /api/auth/login. The onboarding route signs its own token
 * directly, but uses the same field names, so both are now compatible.
 */
export function signToken(user: AuthedUser): string {
  // Include sub so tools like jwt.io can inspect the token correctly
  return jwt.sign(
    { sub: user.id, id: user.id, organizationId: user.organizationId, role: user.role },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}
