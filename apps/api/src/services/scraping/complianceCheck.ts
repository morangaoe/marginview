/**
 * Compliance check: reads robots.txt for the target URL before any automated
 * scrape runs. The system user-agent is "MarginviewBot/1.0". When robots.txt
 * is unreachable or ambiguous the function fails closed to "manual_only" so
 * no automated request is ever sent without explicit clearance.
 */

const BOT_AGENT = "marginviewbot";

export type ComplianceStatus = "automated_allowed" | "manual_only" | "unreviewed";

interface RobotsRule {
  userAgents: string[];
  disallowedPaths: string[];
  allowedPaths: string[];
}

function parseRobots(text: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let current: RobotsRule | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) {
      if (current) {
        rules.push(current);
        current = null;
      }
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      if (!current) current = { userAgents: [], disallowedPaths: [], allowedPaths: [] };
      current.userAgents.push(value.toLowerCase());
    } else if (field === "disallow" && current) {
      if (value) current.disallowedPaths.push(value);
    } else if (field === "allow" && current) {
      if (value) current.allowedPaths.push(value);
    }
  }
  if (current) rules.push(current);
  return rules;
}

function isBlocked(rules: RobotsRule[], path: string): boolean {
  // Collect the most-specific matching rule set for our agent or "*"
  const relevant = rules.filter(
    (r) =>
      r.userAgents.includes(BOT_AGENT) ||
      r.userAgents.includes("*")
  );
  if (relevant.length === 0) return false;

  // Per the Robots Exclusion Protocol: longer matching path = higher precedence
  let blocked = false;
  let longestMatch = -1;

  for (const rule of relevant) {
    for (const disallowed of rule.disallowedPaths) {
      if (path.startsWith(disallowed) && disallowed.length > longestMatch) {
        longestMatch = disallowed.length;
        blocked = true;
      }
    }
    for (const allowed of rule.allowedPaths) {
      if (path.startsWith(allowed) && allowed.length > longestMatch) {
        longestMatch = allowed.length;
        blocked = false;
      }
    }
  }
  return blocked;
}

export async function checkCompliance(targetUrl: string): Promise<ComplianceStatus> {
  try {
    const parsed = new URL(targetUrl);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;

    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": "MarginviewBot/1.0 (pricing intelligence; contact@marginview.io)" },
      signal: AbortSignal.timeout(8_000),
    });

    // 404 = no robots.txt = no restrictions
    if (response.status === 404) return "automated_allowed";

    // Any other non-200 = can't determine, fail closed
    if (!response.ok) return "manual_only";

    const text = await response.text();
    const rules = parseRobots(text);
    const blocked = isBlocked(rules, parsed.pathname || "/");

    return blocked ? "manual_only" : "automated_allowed";
  } catch {
    // Network error, timeout, bad URL — fail closed
    return "manual_only";
  }
}
