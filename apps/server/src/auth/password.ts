import { hash, verify } from '@node-rs/argon2';

// Passwords are hashed with argon2id at the settings OWASP recommends as a minimum (19 MiB, 2 passes, 1 lane).
const PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN = 8;
/** Long passwords are fine, but an unbounded one would be a cheap way to make the server work hard. */
export const PASSWORD_MAX = 128;

const COMMON = new Set(['password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'letmein1', 'admin123', 'welcome1', 'office123', 'changeme']);

/** The rules a new password must meet; returns the reason it does not, or null if it is fine. */
export function passwordProblem(password: unknown, username: string): string | null {
  if (typeof password !== 'string') return 'the password must be text';
  if (password.length < PASSWORD_MIN) return `the password must be at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `the password must be at most ${PASSWORD_MAX} characters`;
  const lower = password.toLowerCase();
  if (lower === username.toLowerCase()) return 'the password must not be the same as the username';
  if (COMMON.has(lower)) return 'that password is too common; pick another';
  if (/^(.)\1+$/.test(password)) return 'the password must not be one repeated character';
  return null;
}

export const hashPassword = (password: string): Promise<string> => hash(password, PARAMS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try { return await verify(stored, password); } catch { return false; }
}

// A hash of nothing in particular, verified against when the username does not exist, so a wrong username takes as long
// as a wrong password and the two cannot be told apart by timing.
let dummy: Promise<string> | null = null;
/** Make the dummy hash now (at start-up) so the first wrong name is not slower than the rest. */
export function warmDummy(): Promise<string> {
  dummy ??= hashPassword('this is nobody password, only here to spend the same time');
  return dummy;
}
export function verifyAgainstDummy(password: string): Promise<boolean> {
  return warmDummy().then(h => verifyPassword(h, password));
}
