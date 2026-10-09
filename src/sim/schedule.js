/* ================= Working hours ================= */
// The sim day runs a full 24 hours, 06:00 to 06:00, so every shift fits: DAY 09:00-18:00, MID 15:00-00:00,
// NIGHT 21:00-06:00 (times past midnight are 24:00 and up, e.g. 30:00 is 06:00 the next morning).
// People work during their shift and only play during the breaks: the lunch hour, 15:00 and 17:00 for the
// day shift, and the same points into any other shift (3, 6 and 8 hours after it starts).
const DAY_START = 6 * 60, DAY_END = 30 * 60;
const DEFAULT_SHIFT = { code: 'DAY', start: 9 * 60, end: 18 * 60 }; // staff without a shift (or made-up staff)
const BREAKS = [[3 * 60, 4 * 60], [6 * 60, 6 * 60 + 25], [8 * 60, 8 * 60 + 25]]; // minutes after shift start: lunch hour, 15:00, 17:00

// Shift times on the sim clock: an end before the start means the next morning.
function shiftWindow(shift) {
  const s = shift ?? DEFAULT_SHIFT;
  return { start: s.start < DAY_START ? s.start + 24 * 60 : s.start, end: s.end <= s.start ? s.end + 24 * 60 : s.end };
}
// Which of this person's breaks is on (0 lunch hour, 1 and 2 the afternoon breaks), or -1 when working.
function breakIndex(p, t) {
  const from = t - p.shiftStart;
  return BREAKS.findIndex(([a, b]) => from >= a && from < b);
}
// True during this person's breaks (when games, music and the sofa are allowed).
function onBreak(p, t) { return breakIndex(p, t) >= 0; }

export { DAY_END, DAY_START, breakIndex, onBreak, shiftWindow };
