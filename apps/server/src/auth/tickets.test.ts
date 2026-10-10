import { describe, expect, it } from 'vitest';
import { AuthError } from './auth.service';
import { TicketService } from './tickets';

const S = 'a'.repeat(64);

describe('TicketService', () => {
  it('a ticket works once, for the account that asked, and tells who it was', () => {
    const t = new TicketService(() => 0);
    const { ticket, expiresInMs } = t.mint(7, S);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(expiresInMs).toBe(30_000);
    expect(t.redeem(ticket)).toEqual({ accountId: 7, sessionHash: S });
    expect(t.redeem(ticket)).toBeNull(); // used up
  });

  it('runs out after 30 seconds, and a ticket that is tried too late is gone for good', () => {
    let now = 0;
    const t = new TicketService(() => now);
    const a = t.mint(1, S).ticket, b = t.mint(1, S).ticket;
    now = 29_999;
    expect(t.redeem(a)).not.toBeNull();
    now = 30_000;
    expect(t.redeem(b)).toBeNull();
    expect(t.outstanding).toBe(0);
  });

  it('unknown, empty, wrong-type and oversized tickets are simply null', () => {
    const t = new TicketService();
    for (const bad of ['', 'nope', 'x'.repeat(500), 5, null, undefined, {}, ['a']]) expect(t.redeem(bad)).toBeNull();
  });

  it('every ticket is different and unguessable in form', () => {
    const t = new TicketService(() => 0);
    const seen = new Set<string>();
    for (let i = 0; i < 9; i++) seen.add(t.mint(1, S).ticket);
    expect(seen.size).toBe(9);
  });

  it('an account may ask for ten a minute, then must wait', () => {
    let now = 0;
    const t = new TicketService(() => now);
    for (let i = 0; i < 10; i++) t.mint(1, S);
    expect(() => t.mint(1, S)).toThrow(AuthError);
    expect(t.mint(2, S).ticket).toBeTruthy(); // other accounts are not affected
    now = 60_001;
    expect(t.mint(1, S).ticket).toBeTruthy();
  });

  it('cannot be made to hold unlimited tickets', () => {
    let now = 0;
    const t = new TicketService(() => now);
    let made = 0;
    try { for (let account = 1; account <= 2500; account++) { t.mint(account, S); made++; } } catch (e) { expect(e).toBeInstanceOf(AuthError); }
    expect(made).toBe(2000);
    now = 31_000; // everything has expired, so there is room again
    expect(t.mint(9999, S).ticket).toBeTruthy();
  });
});
