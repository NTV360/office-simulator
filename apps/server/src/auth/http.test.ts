import { describe, expect, it } from 'vitest';
import { addressKey, clientAddress, clearedCookie, parseCookies, sessionCookie } from './http';

describe('addressKey', () => {
  it('leaves IPv4 alone and unwraps IPv4-in-IPv6', () => {
    expect(addressKey('203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey('::FFFF:10.0.0.1')).toBe('10.0.0.1');
  });
  it('reduces an IPv6 address to its /64, so rotating inside it does not help', () => {
    const a = addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:0db8:0001:0002::/64');
    expect(addressKey('2001:db8:1:2::1')).toBe(a);
    expect(addressKey('2001:DB8:1:2:ffff:ffff:ffff:ffff')).toBe(a);
    expect(addressKey('2001:db8:1:3::1')).not.toBe(a);
    expect(addressKey('::1')).toBe('0000:0000:0000:0000::/64');
    expect(addressKey('fe80::1')).toBe('fe80:0000:0000:0000::/64');
    expect(addressKey('2001:db8::5:6:7:8')).toBe('2001:0db8:0000:0000::/64');
  });
  it('copes with nothing', () => {
    expect(addressKey(undefined)).toBe('unknown');
    expect(addressKey('')).toBe('unknown');
    expect(clientAddress({ headers: {} })).toBe('unknown');
  });
});

describe('cookies', () => {
  it('parse, with the first of a repeated name winning, and bad encoding ignored', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
    expect(parseCookies('a=1; a=2')).toEqual({ a: '1' });
    expect(parseCookies('a=%zz; b=2')).toEqual({ b: '2' });
    expect(parseCookies('=x; y')).toEqual({});
    expect(parseCookies('__proto__=x')).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
    expect(({} as Record<string, string>).polluted).toBeUndefined();
  });
  it('are written HttpOnly, SameSite=Strict, for thirty days, and Secure when asked', () => {
    expect(sessionCookie('tok', false)).toBe('office_session=tok; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000');
    expect(sessionCookie('tok', true)).toMatch(/; Secure$/);
    expect(clearedCookie(false)).toContain('Max-Age=0');
  });
});
