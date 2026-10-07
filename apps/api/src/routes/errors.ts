/**
 * POST /api/errors/client — the web app reports its own crashes here (render errors,
 * uncaught exceptions, unhandled promise rejections). Works signed out too, so public
 * pages are covered; a valid session token only adds who hit it. Rate-limited per IP.
 */
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { jwtSecret } from "../middleware/auth";
import { recordEvent } from "../services/errorLog";
import { createLimiter } from "../utils/rateLimit";

export const errorsRouter = Router();
const limiter = createLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

const clientErrorSchema = z.object({
  kind: z.enum(["render", "uncaught", "unhandledrejection", "api"]).default("uncaught"),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  componentStack: z.string().max(4000).optional(),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(300).optional(),
});

function sessionOf(header?: string): { id?: string; organizationId?: string } {
  if (!header?.startsWith("Bearer ")) return {};
  try {
    const c = jwt.verify(header.slice(7), jwtSecret(), { algorithms: ["HS256"] }) as Record<string, any>;
    return c.kind === "lead" ? {} : { id: c.id ?? c.sub, organizationId: c.organizationId };
  } catch {
    return {};
  }
}

errorsRouter.post("/client", async (req, res) => {
  if (limiter.hit(req.ip ?? "unknown")) return res.status(429).end();
  const parsed = clientErrorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).end();
  const e = parsed.data;
  const who = sessionOf(req.headers.authorization);
  const page = e.url ? safePath(e.url) : null;

  await recordEvent({
    source: "web",
    message: e.message,
    stack: [e.stack, e.componentStack && `Component stack:${e.componentStack}`].filter(Boolean).join("\n\n") || null,
    path: page,
    userId: who.id,
    organizationId: who.organizationId,
    context: { kind: e.kind, url: e.url, userAgent: e.userAgent ?? req.headers["user-agent"] },
  });
  res.status(204).end();
});

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0];
  }
}
