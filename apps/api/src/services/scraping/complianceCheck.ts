/**
 * Compliance check: reads robots.txt for the target URL before any automated
 * scrape runs. The system user-agent is "MarginviewBot/1.0".
 *
 * Status handling follows RFC 9309 (section 2.3.1):
 *   - 2xx            -> parse the rules
 *   - 4xx (not 429)  -> robots.txt is "unavailable": no restrictions apply
 *   - 429, 5xx,
 *     network error  -> "unreachable": we may NOT crawl yet. This is returned as
 *                       "unreviewed" so the queue re-checks before scraping
 *                       instead of stranding the source in manual_only forever.
 *   - bad URL / host -> "manual_only"
 *
 * Fail-closed is preserved: nothing is scraped automatically unless the result
 * is "automated_allowed".
 */
import { logger } from "../../utils/log";

const log = logger("compliance");
const BOT_AGENT = "marginviewbot";
const ROBOTS_UA = "MarginviewBot/1.0 (pricing intelligence; contact@marginview.io)";

export type ComplianceStatus = "automated_allowed" | "manual_only" | "unreviewed";

export interface ComplianceResult {
  status: ComplianceStatus;
  /** Human-readable explanation, safe to show in the UI and logs. */
  reason: string;
}

interface RobotsGroup {
  userAgents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

/**
 * Groups start at a run of User-agent lines and continue until the next
 * User-agent line that follows a rule. Blank lines do not end a group (RFC 9309).
 */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRule = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      if (!current || sawRule) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
        sawRule = false;
      }
      current.userAgents.push(value.toLowerCase());
    } else if ((field === "disallow" || field === "allow") && current) {
      sawRule = true;
      if (value) current.rules.push({ allow: field === "allow", path: value });
    }
  }
  return groups;
}

/** Converts a robots path pattern (supports `*` and a trailing `$`) to a RegExp. */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Returns the rule that decided the outcome, or null when nothing matched (allowed). */
export function matchRobots(groups: RobotsGroup[], pathAndQuery: string): { allow: boolean; path: string } | null {
  // A group naming our bot wins outright; otherwise fall back to "*" groups.
  const specific = groups.filter((g) => g.userAgents.some((ua) => ua.split("/")[0].trim() === BOT_AGENT));
  const relevant = specific.length ? specific : groups.filter((g) => g.userAgents.includes("*"));

  let best: { allow: boolean; path: string } | null = null;
  for (const group of relevant) {
    for (const rule of group.rules) {
      if (!patternToRegExp(rule.path).test(pathAndQuery)) continue;
      // Longest match wins; on a tie, Allow wins (RFC 9309 section 2.2.2).
      if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
        best = rule;
      }
    }
  }
  return best;
}

export async function checkComplianceDetailed(targetUrl: string): Promise<ComplianceResult> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { status: "manual_only", reason: "The URL could not be parsed." };
  }
  const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
  const result = await fetchAndEvaluate(robotsUrl, parsed);
  const fields = { url: targetUrl, status: result.status, reason: result.reason };
  if (result.status === "automated_allowed") log.info("robots check passed", fields);
  else log.warn("robots check did not clear source", fields);
  return result;
}

async function fetchAndEvaluate(robotsUrl: string, target: URL): Promise<ComplianceResult> {
  let response: Response;
  try {
    response = await fetch(robotsUrl, {
      headers: { "User-Agent": ROBOTS_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const detail = err.cause?.code ?? err.name ?? "network error";
    return { status: "unreviewed", reason: `robots.txt was unreachable (${detail}). Will retry before scraping.` };
  }

  if (response.status === 429 || response.status >= 500) {
    return {
      status: "unreviewed",
      reason: `robots.txt returned HTTP ${response.status}. Will retry before scraping.`,
    };
  }
  if (response.status >= 400) {
    return { status: "automated_allowed", reason: `No robots.txt rules apply (HTTP ${response.status}).` };
  }
  if (!response.ok) {
    return { status: "unreviewed", reason: `robots.txt returned unexpected HTTP ${response.status}.` };
  }

  const text = await response.text().catch(() => null);
  if (text === null) return { status: "unreviewed", reason: "robots.txt body could not be read." };

  const rule = matchRobots(parseRobots(text), (target.pathname || "/") + target.search);
  if (rule && !rule.allow) {
    return { status: "manual_only", reason: `robots.txt disallows this page ("Disallow: ${rule.path}").` };
  }
  return { status: "automated_allowed", reason: rule ? `robots.txt allows this page ("Allow: ${rule.path}").` : "robots.txt allows this page." };
}

/** Back-compat wrapper for callers that only need the status. */
export async function checkCompliance(targetUrl: string): Promise<ComplianceStatus> {
  return (await checkComplianceDetailed(targetUrl)).status;
}
