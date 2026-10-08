import { describe, expect, it } from 'vitest';
import { DEFAULTS, PROTOCOL_VERSION, clampSlotCount } from './index';

describe('shared defaults', () => {
  it('match the plan', () => {
    expect(DEFAULTS.tickRate).toBe(20);
    expect(DEFAULTS.maxPlayers).toBe(100);
    expect(PROTOCOL_VERSION).toBe(0);
  });
});

describe('clampSlotCount', () => {
  it('keeps the count between 0 and the number of desks', () => {
    expect(clampSlotCount(40, 70)).toBe(40);
    expect(clampSlotCount(500, 70)).toBe(70);
    expect(clampSlotCount(-3, 70)).toBe(0);
  });
  it('rounds down and ignores nonsense', () => {
    expect(clampSlotCount(12.9, 70)).toBe(12);
    expect(clampSlotCount(Number.NaN, 70)).toBe(0);
    expect(clampSlotCount(Number.POSITIVE_INFINITY, 70)).toBe(0);
  });
});
