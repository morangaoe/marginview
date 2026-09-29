import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AuthedUser } from "../types";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  try {
    const token = header.slice("Bearer ".length);
    req.user = jwt.verify(token, JWT_SECRET) as AuthedUser;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Restrict a route to one or more roles. Enforced server-side, per TRD
 * section 9, not left to the client to hide a button.
 */
export function requireRole(...roles: AuthedUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to do this" });
    }
    next();
  };
}

export function signToken(user: AuthedUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "12h" });
}
