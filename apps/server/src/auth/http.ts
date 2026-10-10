// Small helpers for the cookie and the request, so the controller stays readable. No cookie package: one cookie, parsed by hand.

export const SESSION_COOKIE = 'office_session';
// The cookie lasts as long as a session can (30 days); the server ends a session sooner when it has not been used for 7 days.

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue;
    try { out[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* a malformed value is simply not a session */ }
  }
  return out;
}

/** The Set-Cookie value for a session. HttpOnly (scripts cannot read it), SameSite=Strict (other sites cannot use it), Secure when the site is on HTTPS. */
export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}${secure ? '; Secure' : ''}`;
}
export function clearedCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

export interface Req {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  secure?: boolean;
  socket?: { remoteAddress?: string };
  method?: string;
  account?: import('./account-store').Account;
  sessionToken?: string;
}
export interface Res {
  setHeader(name: string, value: string): void;
}

export const header = (req: Req, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** HTTPS, whether the connection itself or (with a trusted proxy in front) the original one; or forced by COOKIE_SECURE. */
export const isSecure = (req: Req): boolean => process.env.COOKIE_SECURE === 'true' || req.secure === true;

/**
 * The address to count requests against. An IPv6 user controls a whole /64, so for IPv6 the first 64 bits are the key
 * (otherwise one person could rotate through addresses to dodge the limits); an IPv4-mapped address is its IPv4 address.
 */
export function addressKey(raw: string | undefined): string {
  if (!raw) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1];
  if (!raw.includes(':')) return raw;
  const [head, tail = ''] = raw.split('::');
  const first = head === '' ? [] : head.split(':');
  const last = raw.includes('::') && tail !== '' ? tail.split(':') : [];
  const groups = raw.includes('::') ? [...first, ...Array(Math.max(0, 8 - first.length - last.length)).fill('0'), ...last] : first;
  return groups.slice(0, 4).map(g => g.toLowerCase().padStart(4, '0')).join(':') + '::/64';
}

export const clientAddress = (req: Req): string => addressKey(req.ip ?? req.socket?.remoteAddress);
