import { afterEach, describe, expect, it, vi } from "vitest";
import { checkComplianceDetailed, matchRobots, parseRobots } from "./complianceCheck";

const respond = (status: number, body = "") => vi.fn().mockResolvedValue(new Response(body, { status }));

describe("robots parsing", () => {
  it("starts a new group when a user-agent follows rules, even without a blank line", () => {
    const groups = parseRobots("User-agent: Googlebot\nDisallow: /\nUser-agent: *\nDisallow: /private");
    expect(groups).toHaveLength(2);
    expect(matchRobots(groups, "/product/1")).toBeNull();
    expect(matchRobots(groups, "/private/x")?.allow).toBe(false);
  });

  it("does not end a group on a blank line", () => {
    const groups = parseRobots("User-agent: *\n\nDisallow: /cart");
    expect(matchRobots(groups, "/cart")?.allow).toBe(false);
  });

  it("prefers a group that names our bot over *", () => {
    const groups = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: MarginviewBot\nAllow: /");
    expect(matchRobots(groups, "/p/1")?.allow).toBe(true);
  });

  it("supports wildcards and end anchors, and Allow wins ties", () => {
    const groups = parseRobots("User-agent: *\nDisallow: /*?sort=\nDisallow: /*.pdf$\nAllow: /p\nDisallow: /p");
    expect(matchRobots(groups, "/shoes?sort=asc")?.allow).toBe(false);
    expect(matchRobots(groups, "/a.pdf")?.allow).toBe(false);
    expect(matchRobots(groups, "/a.pdf?x=1")).toBeNull();
    expect(matchRobots(groups, "/p/1")?.allow).toBe(true);
  });
});

describe("checkComplianceDetailed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats 4xx robots.txt as no restrictions (RFC 9309)", async () => {
    vi.stubGlobal("fetch", respond(403));
    expect((await checkComplianceDetailed("https://shop.example/p/1")).status).toBe("automated_allowed");
  });

  it("returns unreviewed on 5xx and network errors so the queue re-checks later", async () => {
    vi.stubGlobal("fetch", respond(503));
    expect((await checkComplianceDetailed("https://shop.example/p/1")).status).toBe("unreviewed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect((await checkComplianceDetailed("https://shop.example/p/1")).status).toBe("unreviewed");
  });

  it("is manual_only when robots.txt disallows the page, with the rule in the reason", async () => {
    vi.stubGlobal("fetch", respond(200, "User-agent: *\nDisallow: /search"));
    const r = await checkComplianceDetailed("https://www.google.com/search?q=x");
    expect(r.status).toBe("manual_only");
    expect(r.reason).toContain("Disallow: /search");
  });
});
