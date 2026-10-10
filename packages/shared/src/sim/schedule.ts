/* ================= Working hours ================= */
// The sim day runs a full 24 hours, 06:00 to 06:00, so every shift fits: DAY 09:00-18:00, MID 15:00-00:00, NIGHT 21:00-06:00
// (times past midnight are 24:00 and up, e.g. 30:00 is 06:00 the next morning). People work during their shift and only play during
// the breaks: the lunch hour, 15:00 and 17:00 for the day shift, and the same points into any other shift (3, 6 and 8 hours after it
// starts). This is `main`'s `src/sim/schedule.js`.

/** A shift, in minutes since midnight. An end before the start means the next morning. */
export interface Shift { code: string; start: number; end: number }

export const DAY_START = 6 * 60;
export const DAY_END = 30 * 60;
/** A time that never comes (not clocked in today; clocked in and not out yet). A real number, because Infinity cannot travel on the wire or in a save. */
export const NEVER = 100 * 60;
/** Staff without a shift (or made-up staff). */
export const DEFAULT_SHIFT: Shift = { code: 'DAY', start: 9 * 60, end: 18 * 60 };
/** Minutes after the shift starts: the lunch hour, 15:00 and 17:00 for the day shift. */
const BREAKS: ReadonlyArray<readonly [number, number]> = [[3 * 60, 4 * 60], [6 * 60, 6 * 60 + 25], [8 * 60, 8 * 60 + 25]];

/** Shift times on the sim clock (06:00 to 30:00): an end before the start means the next morning. */
export function shiftWindow(shift: Shift | null | undefined): { start: number; end: number } {
  const s = shift ?? DEFAULT_SHIFT;
  const start = s.start < DAY_START ? s.start + 24 * 60 : s.start; // 03:00 is 27:00 on the sim clock
  let end = s.end;
  while (end <= start) end += 24 * 60; // and the shift ends after it starts, whichever morning that is
  return { start, end };
}

/** Which of this person's breaks is on (0 the lunch hour, 1 and 2 the afternoon breaks), or -1 when working. */
export function breakIndex(p: { shiftStart?: number }, t: number): number {
  const from = t - (p.shiftStart ?? DEFAULT_SHIFT.start);
  return BREAKS.findIndex(([a, b]) => from >= a && from < b);
}

/** True during this person's breaks (when games, music and the sofa are allowed). */
export const onBreak = (p: { shiftStart?: number }, t: number): boolean => breakIndex(p, t) >= 0;
