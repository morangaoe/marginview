import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "./auth";

vi.mock("../db/pool", () => ({ pool: { query: vi.fn() } }));
process.env.JWT_SECRET = "x".repeat(40);
process.env.FRONTEND_URL = "https://app.example.com";

function run(req: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  const next = vi.fn();
  return requireAuth({ headers: {}, ...req } as any, res, next).then(() => ({ res, next }));
}

describe("cookie sessions", () => {
  it("rejects a state-changing cookie request from a foreign origin before touching the database", async () => {
    const { res, next } = await run({
      method: "POST",
      headers: { cookie: "mv_session=abc", origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a state-changing cookie request with no Origin header", async () => {
    const { res } = await run({ method: "DELETE", headers: { cookie: "mv_session=abc" } });
    expect(res.statusCode).toBe(403);
  });

  it("lets a request from the allowed origin through to token verification", async () => {
    const { res } = await run({
      method: "POST",
      headers: { cookie: "mv_session=not-a-jwt", origin: "https://app.example.com" },
    });
    expect(res.statusCode).toBe(401); // passed the origin check, failed as an invalid token
  });

  it("returns 401 with no credentials at all", async () => {
    const { res } = await run({ method: "GET" });
    expect(res.statusCode).toBe(401);
  });
});
