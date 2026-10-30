/**
 * A sliding-window counter per key (the MCP route: 20 holds per hour per IP). In memory: each server instance counts
 * on its own and a cold start resets it, which is enough to stop a runaway agent on the demo, not a determined one.
 */
export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    /** Counts one hit for `key`; false (and not counted) when the key already has `max` hits in the window. */
    take(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => at > t - opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      // Keeps the map small: forget keys whose hits all left the window.
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((at) => at <= t - opts.windowMs)) hits.delete(k);
      return true;
    },
  };
}
