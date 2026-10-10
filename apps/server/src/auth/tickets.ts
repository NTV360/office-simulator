import { randomBytes } from 'node:crypto';
import { AuthError } from './auth.service';
import { RateLimiter } from './rate-limit';

export interface TicketInfo {
  accountId: number;
  /** The session (hex of its hash) the ticket was asked for with; if that session ends, the connection it opens ends too. */
  sessionHash: string;
}

const LIFETIME_MS = 30_000;
const MAX_OUTSTANDING = 2000;

/**
 * One-time tickets for opening the realtime connection. A browser that is logged in asks for one, then says it in its first
 * message; the secret session cookie never goes near the socket and nothing secret ever appears in a URL. A ticket works once,
 * for about 30 seconds, and only for the account that asked.
 */
export class TicketService {
  private readonly tickets = new Map<string, TicketInfo & { expires: number }>();
  private readonly askedPerAccount: RateLimiter;

  constructor(private readonly now: () => number = Date.now) {
    this.askedPerAccount = new RateLimiter(10, 60_000, this.now);
  }

  mint(accountId: number, sessionHash: string): { ticket: string; expiresInMs: number } {
    if (!this.askedPerAccount.allow(String(accountId))) throw new AuthError('rate', 'too many tickets asked for; try again in a minute');
    if (this.tickets.size >= MAX_OUTSTANDING) {
      this.purge();
      if (this.tickets.size >= MAX_OUTSTANDING) throw new AuthError('rate', 'the server is busy; try again in a moment');
    }
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { accountId, sessionHash, expires: this.now() + LIFETIME_MS });
    return { ticket, expiresInMs: LIFETIME_MS };
  }

  /** Use a ticket: returns who it was for, or null if it is unknown, already used, or out of date. It is removed either way. */
  redeem(ticket: unknown): TicketInfo | null {
    if (typeof ticket !== 'string' || ticket.length > 128) return null;
    const t = this.tickets.get(ticket);
    if (!t) return null;
    this.tickets.delete(ticket);
    if (t.expires <= this.now()) return null;
    return { accountId: t.accountId, sessionHash: t.sessionHash };
  }

  /** Forget tickets that have run out. */
  purge(): void {
    const t = this.now();
    for (const [k, v] of this.tickets) if (v.expires <= t) this.tickets.delete(k);
  }

  get outstanding(): number { return this.tickets.size; }
}
