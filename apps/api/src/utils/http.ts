import type { NextFunction, Request, RequestHandler, Response } from "express";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wraps an async handler so rejections reach the error middleware. */
export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/**
 * Single place that reads the tenant from the authenticated request.
 * ADJUST this if your middleware/auth.ts stores the JWT claims elsewhere.
 */
export function orgIdOf(req: Request): string {
  const id = (req as any).user?.organizationId as string | undefined;
  if (!id) throw new HttpError(401, "Not authenticated");
  return id;
}
export function userIdOf(req: Request): string {
  const id = ((req as any).user?.id ?? (req as any).user?.userId ?? (req as any).user?.sub) as string | undefined;
  if (!id) throw new HttpError(401, "Not authenticated");
  return id;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error("[api] unhandled error", err);
  return res.status(500).json({ error: "Something went wrong. Try again." });
}
