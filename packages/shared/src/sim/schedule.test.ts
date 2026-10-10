import { describe, expect, it } from 'vitest';
import { DAY_END, DAY_START, DEFAULT_SHIFT, NEVER, breakIndex, onBreak, shiftWindow } from './schedule';

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe('the sim day', () => {
  it('runs 24 hours, 06:00 to 06:00 (30:00 on the sim clock)', () => {
    expect(DAY_START).toBe(h(6));
    expect(DAY_END).toBe(h(30));
  });
});

describe('shift windows', () => {
  it('the default shift is the day shift, 09:00 to 18:00', () => {
    expect(shiftWindow(null)).toEqual({ start: h(9), end: h(18) });
    expect(shiftWindow(undefined)).toEqual({ start: h(9), end: h(18) });
    expect(DEFAULT_SHIFT.code).toBe('DAY');
  });
  it('a mid shift ends at midnight, which is 24:00', () => {
    expect(shiftWindow({ code: 'MID', start: h(15), end: 0 })).toEqual({ start: h(15), end: h(24) });
  });
  it('a night shift ends the next morning (30:00 is 06:00 tomorrow)', () => {
    expect(shiftWindow({ code: 'NIGHT', start: h(21), end: h(6) })).toEqual({ start: h(21), end: h(30) });
  });
  it('a shift that starts after midnight and before 06:00 is on the end of the sim day: 03:00 to 11:00 is 27:00 to 35:00', () => {
    expect(shiftWindow({ code: 'EARLY', start: h(3), end: h(11) })).toEqual({ start: h(27), end: h(35) });
    expect(shiftWindow({ code: 'LATE', start: 0, end: h(8) })).toEqual({ start: h(24), end: h(32) });
  });
  it('every window ends after it starts, for every start and end', () => {
    for (let s = 0; s < 24; s++) for (let e = 0; e < 24; e++) { const w = shiftWindow({ code: 'X', start: h(s), end: h(e) }); expect(w.end, `${s} to ${e}`).toBeGreaterThan(w.start); }
  });
  it('NEVER is a real number past the end of the day (Infinity cannot travel on the wire or in a save)', () => {
    expect(Number.isFinite(NEVER)).toBe(true);
    expect(NEVER).toBeGreaterThan(DAY_END);
  });
});

describe('breaks', () => {
  const day = { shiftStart: h(9) };
  it('the day shift breaks for lunch from 12:00 to 13:00, then 15:00 to 15:25 and 17:00 to 17:25', () => {
    const at = (t: number) => breakIndex(day, t);
    expect([at(h(11, 59)), at(h(12)), at(h(12, 59)), at(h(13))]).toEqual([-1, 0, 0, -1]);
    expect([at(h(14, 59)), at(h(15)), at(h(15, 24)), at(h(15, 25))]).toEqual([-1, 1, 1, -1]);
    expect([at(h(16, 59)), at(h(17)), at(h(17, 24)), at(h(17, 25))]).toEqual([-1, 2, 2, -1]);
  });
  it('another shift has the same breaks, counted from its own start', () => {
    const night = { shiftStart: h(21) };
    expect(onBreak(night, h(24))).toBe(true); // 3 hours in
    expect(onBreak(night, h(24, 59))).toBe(true);
    expect(onBreak(night, h(25))).toBe(false);
    expect(onBreak(night, h(27))).toBe(true); // 6 hours in
    expect(onBreak(night, h(29))).toBe(true); // 8 hours in
    expect(onBreak(night, h(12))).toBe(false);
  });
  it('someone with no shift start is on the day shift', () => {
    expect(onBreak({}, h(12, 30))).toBe(true);
    expect(onBreak({}, h(10))).toBe(false);
  });
  it('nobody is on a break before their shift starts', () => {
    expect(onBreak(day, h(8))).toBe(false);
    expect(onBreak(day, h(6))).toBe(false);
  });
});
