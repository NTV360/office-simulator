import { describe, expect, it } from 'vitest';
import { COOPERATIVE, followDisplacement, oppositionContinues, opposedMotion } from './cooperative';

describe('cooperative carrying rules', () => {
  it('recognises meaningful movement against the object', () => {
    expect(opposedMotion({ x: -1, z: 0 }, { x: 1, z: 0 })).toBe(true);
    expect(opposedMotion({ x: 1, z: 0 }, { x: 1, z: 0 })).toBe(false);
    expect(opposedMotion({ x: -.01, z: 0 }, { x: 1, z: 0 })).toBe(false);
  });

  it('uses strict entry and relaxed exit thresholds', () => {
    expect(opposedMotion({ x: -.4, z: .916 }, { x: 1, z: 0 })).toBe(true);
    expect(oppositionContinues({ x: -.1, z: .995 }, { x: 1, z: 0 })).toBe(false);
    expect(oppositionContinues({ x: -.4, z: .916 }, { x: 1, z: 0 })).toBe(true);
    expect(opposedMotion({ x: -.01, z: 0 }, { x: 1, z: 0 })).toBe(false);
    expect(oppositionContinues({ x: -.01, z: 0 }, { x: 1, z: 0 })).toBe(false);
  });

  it('honours the entry and exit boundaries, including the speed cutoff', () => {
    const entryZ = Math.sqrt(1 - COOPERATIVE.opposeDot ** 2);
    const exitZ = Math.sqrt(1 - COOPERATIVE.opposeExitDot ** 2);
    expect(opposedMotion({ x: COOPERATIVE.opposeDot, z: entryZ }, { x: 1, z: 0 })).toBe(true);
    expect(opposedMotion({ x: COOPERATIVE.opposeDot + 1e-6, z: entryZ }, { x: 1, z: 0 })).toBe(false);
    expect(oppositionContinues({ x: COOPERATIVE.opposeExitDot, z: exitZ }, { x: 1, z: 0 })).toBe(true);
    expect(oppositionContinues({ x: COOPERATIVE.opposeExitDot + 1e-6, z: exitZ }, { x: 1, z: 0 })).toBe(false);
    expect(opposedMotion({ x: -COOPERATIVE.opposeSpeed, z: 0 }, { x: 1, z: 0 })).toBe(true);
    expect(opposedMotion({ x: -(COOPERATIVE.opposeSpeed - 1e-6), z: 0 }, { x: 1, z: 0 })).toBe(false);
  });

  it('moves only the bounded excess beyond the comfortable leash', () => {
    expect(followDisplacement(
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
    )).toEqual({ x: COOPERATIVE.followStep, z: 0 });
    expect(followDisplacement(
      { x: 0, y: 1, z: 0 },
      { x: .2, y: 1, z: 0 },
    )).toEqual({ x: 0, z: 0 });
  });
});
