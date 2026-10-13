import { describe, expect, it } from 'vitest';
import { classifyFreeSitting, validateFreeSitting, type FreeSitSupport } from './free-sitting';

const support = (over: Partial<FreeSitSupport> = {}): FreeSitSupport => ({
  center: { x: 0, z: 0 }, halfWidth: 1, halfDepth: 1, topY: .75, ...over,
});
const base = (over: Partial<Parameters<typeof classifyFreeSitting>[0]> = {}) => ({
  support: support(), position: { x: 0, z: 0 }, heading: 0,
  standUpCandidates: [{ x: 0, z: 1.5 }], ...over,
});

describe('free sitting classification', () => {
  it('accepts a supported surface with legs down and returns the first safe stand point', () => {
    const result = classifyFreeSitting(base({ standUpCandidates: [{ x: 2, z: 2 }, { x: 0, z: 1.5 }], isClear: p => p.x < 1 }));
    expect(result).toEqual({ ok: true, mode: 'free-legs-down', standUp: { x: 0, z: 1.5 } });
  });

  it('falls back to crossed legs when the longer leg sweep is blocked', () => {
    const result = classifyFreeSitting(base({
      legsDownClearance: .8, crossedLegsClearance: .3,
      isClear: p => p.z < .5 || p.z > 1,
    }));
    expect(result).toMatchObject({ ok: true, mode: 'free-crossed' });
  });

  it('rejects an unsupported surface, an occupied surface, and a carried identity', () => {
    expect(classifyFreeSitting(base({ support: support({ supportsSitting: false }) }))).toEqual({ ok: false, reason: 'unsupported-surface' });
    const other = {};
    expect(classifyFreeSitting(base({ support: support({ occupant: other }) }))).toEqual({ ok: false, reason: 'occupied' });
    expect(classifyFreeSitting(base({ person: other, support: support({ occupant: {} }) }))).toEqual({ ok: false, reason: 'occupied' });
    const person = {};
    expect(classifyFreeSitting(base({ person, support: support({ occupant: person }) }))).toMatchObject({ ok: true });
  });

  it('requires clearance from every support edge, not merely the support centre', () => {
    expect(classifyFreeSitting(base({ position: { x: .85, z: 0 } }))).toEqual({ ok: false, reason: 'edge-clearance' });
    expect(classifyFreeSitting(base({ position: { x: .79, z: 0 } }))).toMatchObject({ ok: true });
  });

  it('rejects blocked legs and has no unsafe stand-up fallback', () => {
    expect(classifyFreeSitting(base({ isClear: () => false }))).toEqual({ ok: false, reason: 'legs-blocked' });
    expect(classifyFreeSitting(base({ isClear: p => p.z < .5, standUpCandidates: [{ x: 0, z: 1 }] }))).toEqual({ ok: false, reason: 'no-safe-stand' });
  });

  it('accepts full extents and aliases the validator', () => {
    const input = base({ support: support({ halfWidth: undefined, halfDepth: undefined, width: 2, depth: 2 }) });
    expect(validateFreeSitting(input)).toEqual(classifyFreeSitting(input));
  });
});
