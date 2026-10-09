import { MAX_CHAT } from '@office/shared';
import { RateLimiter } from '../auth/rate-limit';

// Local chat: the rules, apart from Nest and the sockets so they can be tested alone. A line is heard by the speaker and by everyone
// within CHAT_RANGE metres of them. See docs/PHASE-4-BREAKDOWN.md, step 3.

/** How far a line carries, in metres. */
export const CHAT_RANGE = 10;
/** At most this many lines in CHAT_WINDOW_MS from one account. */
export const CHAT_LIMIT = 5;
export const CHAT_WINDOW_MS = 10_000;

// Control characters (including newlines and tabs), the invisible and direction-changing characters that can hide or reorder text, and
// the byte-order mark. What is left is plain text.
const UNWANTED = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff\ufff9-\ufffb]/g;

/** Make what a player typed into a chat line: plain text, one line, at most MAX_CHAT characters; null if nothing is left. */
export function cleanChat(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(UNWANTED, ' ').replace(/ {2,}/g, ' ').trim().slice(0, MAX_CHAT).trim();
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
  }

  /** The player says something. Returns who hears it, or why nobody does. */
  async say(accountId: number, raw: unknown): Promise<SayResult> {
    const text = cleanChat(raw);
    if (text === null) return { ok: false, reason: 'empty' };
    const speaker = this.lookup.speaker(accountId);
    if (!speaker) return { ok: false, reason: 'nobody' };
    if (await this.lookup.muted(accountId)) return { ok: false, reason: 'muted' };
    if (!this.limiter.allow(String(accountId))) return { ok: false, reason: 'rate' };
    const to = this.lookup.hearers().filter(h => h.accountId === accountId || Math.hypot(h.x - speaker.x, h.z - speaker.z) <= CHAT_RANGE).map(h => h.accountId);
    return { ok: true, from: speaker.personId, name: speaker.name, text, to };
  }
}
