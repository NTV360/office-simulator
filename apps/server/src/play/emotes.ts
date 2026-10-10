import { EMOTE_KINDS, type EmoteKind } from '@office/shared';
import { RateLimiter } from '../auth/rate-limit';

// Emotes: the rules, apart from Nest and the sockets. A player can act out a short fixed list (wave, cheer, clap, nod); everyone playing
// sees it. See docs/PHASE-4-BREAKDOWN.md, step 4.

/** One emote per account per this long. */
export const EMOTE_COOLDOWN_MS = 2_500;

export interface EmoteLookup {
  /** The id of the person this account is playing, or null if they are not playing. */
  personOf(accountId: number): number | null;
}

export type EmoteResult = { ok: true; from: number; kind: EmoteKind } | { ok: false; reason: 'nobody' | 'bad' | 'cooldown' };

export class EmoteService {
  private readonly limiter: RateLimiter;

  constructor(private readonly lookup: EmoteLookup, now: () => number = Date.now) {
    this.limiter = new RateLimiter(1, EMOTE_COOLDOWN_MS, now);
  }

  play(accountId: number, kind: unknown): EmoteResult {
    if (typeof kind !== 'string' || !(EMOTE_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'bad' };
    const from = this.lookup.personOf(accountId);
    if (from === null) return { ok: false, reason: 'nobody' };
    if (!this.limiter.allow(String(accountId))) return { ok: false, reason: 'cooldown' };
    return { ok: true, from, kind: kind as EmoteKind };
  }
}
