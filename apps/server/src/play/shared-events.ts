// Events that happen to the whole office at once. Today that is Hazel's rage: any player may start it, the server decides whether it can
// start now (Hazel must be in, and it can only happen once a minute for everybody) and then tells every page at the same moment.
// See docs/PHASE-4-BREAKDOWN.md, step 5.

/** After a rage starts, nobody can start another for this long (it lasts 10 seconds on the page). */
export const RAGE_COOLDOWN_MS = 60_000;
/** And one player can start one only this often, so a single player cannot keep her angry all day. */
export const RAGE_PER_PLAYER_MS = 5 * 60_000;

export interface RageLookup {
  /** Is Hazel in the office right now? */
  hazelPresent(): boolean;
}

export type RageResult = { ok: true } | { ok: false; reason: 'away' } | { ok: false; reason: 'cooldown'; secondsLeft: number } | { ok: false; reason: 'you-again'; secondsLeft: number };

export class RageService {
  private lastAt = -Infinity;
  private readonly lastBy = new Map<number, number>();

  constructor(private readonly lookup: RageLookup, private readonly now: () => number = Date.now) {}

  /** Someone (an account) asked for the rage. */
  trigger(accountId: number): RageResult {
    const t = this.now();
    if (!this.lookup.hazelPresent()) return { ok: false, reason: 'away' };
    const left = RAGE_COOLDOWN_MS - (t - this.lastAt);
    if (left > 0) return { ok: false, reason: 'cooldown', secondsLeft: Math.ceil(left / 1000) };
    const mine = RAGE_PER_PLAYER_MS - (t - (this.lastBy.get(accountId) ?? -Infinity));
    if (mine > 0) return { ok: false, reason: 'you-again', secondsLeft: Math.ceil(mine / 1000) };
    this.lastAt = t;
    if (this.lastBy.size > 500) this.lastBy.clear();
    this.lastBy.set(accountId, t);
    return { ok: true };
  }
}
