/**
 * In-memory fixed-window counter. Good enough for a single API instance;
 * with several instances each one keeps its own count, so limits are per instance.
 */
export function createLimiter(opts: { max: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // Drop expired windows so the map can't grow without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, Math.max(opts.windowMs, 60_000));
  sweep.unref();

  return {
    /** True when the key has used up its allowance for the current window. */
    blocked(key: string): boolean {
      const h = hits.get(key);
      return !!h && h.resetAt > Date.now() && h.count >= opts.max;
    },
    /** Counts one hit; returns true if this hit is over the limit. */
    hit(key: string): boolean {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + opts.windowMs });
        return 1 > opts.max;
      }
      h.count++;
      return h.count > opts.max;
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}
