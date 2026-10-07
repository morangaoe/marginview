/**
 * Tiny structured logger for the scraping pipeline.
 * One line per event: `[scope] message key=value ...` so failures are grep-able,
 * e.g. `grep '\[scrape\]' api.log | grep source=<id>`.
 * Set SCRAPE_DEBUG=true to also print per-tier fetch attempts.
 */
type Fields = Record<string, unknown>;

function fmt(fields?: Fields): string {
  if (!fields) return "";
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${/\s/.test(s) ? JSON.stringify(s) : s}`;
    })
    .join(" ");
}

export const debugEnabled = () => process.env.SCRAPE_DEBUG === "true";

export function logger(scope: string) {
  const line = (msg: string, fields?: Fields) => `[${scope}] ${msg}${fields ? " " + fmt(fields) : ""}`;
  return {
    info: (msg: string, fields?: Fields) => console.log(line(msg, fields)),
    warn: (msg: string, fields?: Fields) => console.warn(line(msg, fields)),
    error: (msg: string, fields?: Fields) => console.error(line(msg, fields)),
    debug: (msg: string, fields?: Fields) => {
      if (debugEnabled()) console.log(line(msg, fields));
    },
  };
}

/** Hides credentials in connection strings before they reach the logs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<unparseable url>";
  }
}
