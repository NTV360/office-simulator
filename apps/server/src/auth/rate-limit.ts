/** At most `limit` events per `windowMs` for each key (an address, a username). In memory; the clock can be replaced for tests. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}

  /** Record an event for `key`. Returns false (and records nothing) if the key has used up its allowance. */
  allow(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter(x => t - x < this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(t);
    return true;
  }

  /** Would an event be allowed right now? (Records nothing.) */
  wouldAllow(key: string): boolean {
    const t = this.now();
    return (this.hits.get(key) ?? []).filter(x => t - x < this.windowMs).length < this.limit;
  }

  /** Forget a key (for example after a successful login). */
  reset(key: string): void { this.hits.delete(key); }

  /** Forget every key that starts with `prefix` (all addresses for one username, for example). */
  resetPrefix(prefix: string): void { for (const k of this.hits.keys()) if (k.startsWith(prefix)) this.hits.delete(k); }

  private prune(t: number): void {
    for (const [k, v] of this.hits) if (!v.some(x => t - x < this.windowMs)) this.hits.delete(k);
  }
}
