// Events that happen to the whole office at once. Today that is Hazel's rage: any player may start it, the server decides whether it can
// start now (Hazel must be in, and it can only happen once a minute for everybody) and then tells every page at the same moment.
// See docs/PHASE-4-BREAKDOWN.md, step 5.

/** After a rage starts, nobody can start another for this long (it lasts 10 seconds on the page). */
export const RAGE_COOLDOWN_MS = 60_000;

export interface RageLookup {
  /** Is Hazel in the office right now? */
  hazelPresent(): boolean;
}

export type RageResult = { ok: true } | { ok: false; reason: 'away' } | { ok: false; reason: 'cooldown'; secondsLeft: number };

export class RageService {
  private lastAt = -Infinity;

  constructor(private readonly lookup: RageLookup, private readonly now: () => number = Date.now) {}

  /** Someone asked for the rage. */
  trigger(): RageResult {
    const t = this.now();
    if (!this.lookup.hazelPresent()) return { ok: false, reason: 'away' };
    const left = RAGE_COOLDOWN_MS - (t - this.lastAt);
    if (left > 0) return { ok: false, reason: 'cooldown', secondsLeft: Math.ceil(left / 1000) };
    this.lastAt = t;
    return { ok: true };
  }
}
