import { clipChat } from '@office/shared';
import { RateLimiter } from '../auth/rate-limit';

// Local chat: the rules, apart from Nest and the sockets so they can be tested alone. A line is heard by the speaker and by everyone
// within CHAT_RANGE metres of them. See docs/PHASE-4-BREAKDOWN.md, step 3.

/** How far a line carries, in metres. */
export const CHAT_RANGE = 10;
/** At most this many lines in CHAT_WINDOW_MS from one account. */
export const CHAT_LIMIT = 5;
export const CHAT_WINDOW_MS = 10_000;
/** How long "muted or not" is remembered for an account that keeps talking. */
export const MUTE_CACHE_MS = 250;

// What is turned into a space: control characters (newlines and tabs too), format characters (zero-width, direction-changing, the
// invisible tag characters and so on), line and paragraph separators, other kinds of space, and the characters that print as blank
// (soft hyphen, hangul and braille blanks, the combining grapheme joiner, variation selectors, musical formatting).
const UNWANTED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\u00ad\u034f\u115f\u1160\u17b4\u17b5\u180e\u2800\u3164\uffa0\ufe00-\ufe0f\u{1d173}-\u{1d17a}\u{e0000}-\u{e007f}\ufff9-\ufffb]/gu;

/** Make what a player typed into a chat line: plain text, one line, at most MAX_CHAT characters; null if nothing is left. */
export function cleanChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = clipChat(
    raw.replace(UNWANTED, ' ')
      .replace(/(\p{M}{3})\p{M}+/gu, '$1') // a letter with a tower of 200 accents would draw far outside its bubble: three is plenty
      .replace(/ {2,}/g, ' ').trim(),
  ).trim();
  return text === '' ? null : text;
}

export interface Speaker { accountId: number; personId: number; name: string; x: number; z: number }
export interface Hearer { accountId: number; x: number; z: number }

export interface ChatLookup {
  speaker(accountId: number): Speaker | null;
  hearers(): Hearer[];
  muted(accountId: number): Promise<boolean>;
}

export type SayResult =
  | { ok: true; from: number; name: string; text: string; to: number[] }
  | { ok: false; reason: 'empty' | 'rate' | 'muted' | 'nobody' };

export class ChatService {
  private readonly limiter: RateLimiter;

  constructor(private readonly lookup: ChatLookup, now: () => number = Date.now) {
    this.limiter = new RateLimiter(CHAT_LIMIT, CHAT_WINDOW_MS, now);
    this.nowFn = now;
  }

  private readonly mutedCache = new Map<number, { muted: boolean; at: number }>();
  private readonly nowFn: () => number;

  /** Is the account muted? Asked of the database, but not more than about four times a second for one account, however fast they type. */
  private async isMuted(accountId: number): Promise<boolean> {
    const t = this.nowFn();
    const hit = this.mutedCache.get(accountId);
    if (hit && t - hit.at < MUTE_CACHE_MS) return hit.muted;
    const muted = await this.lookup.muted(accountId);
    if (this.mutedCache.size > 2000) this.mutedCache.clear();
    this.mutedCache.set(accountId, { muted, at: t });
    return muted;
  }

  /** The player says something. Returns who hears it, or why nobody does. */
  async say(accountId: number, raw: unknown): Promise<SayResult> {
    const text = cleanChat(raw);
    if (text === null) return { ok: false, reason: 'empty' };
    if (!this.lookup.speaker(accountId)) return { ok: false, reason: 'nobody' };
    // the cheap check first: someone over the limit costs no database query
    if (!this.limiter.wouldAllow(String(accountId))) return { ok: false, reason: 'rate' };
    if (await this.isMuted(accountId)) return { ok: false, reason: 'muted' }; // (a refused line does not use up the allowance)
    const speaker = this.lookup.speaker(accountId); // (read again after the wait: where they are now)
    if (!speaker) return { ok: false, reason: 'nobody' };
    if (!this.limiter.allow(String(accountId))) return { ok: false, reason: 'rate' };
    const to = this.lookup.hearers().filter(h => h.accountId === accountId || Math.hypot(h.x - speaker.x, h.z - speaker.z) <= CHAT_RANGE).map(h => h.accountId);
    return { ok: true, from: speaker.personId, name: speaker.name, text, to };
  }
}
