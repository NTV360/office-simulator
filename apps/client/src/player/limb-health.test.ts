import { describe, expect, it } from 'vitest';
import { LIMB_MAX_HP } from '@office/shared';
// @ts-expect-error: plain JavaScript module
import { limbLevel, limbOutText, limbReport, limbSummary } from './limb-health.js';

const full = { ...LIMB_MAX_HP };

describe('the body-part display rules', () => {
  it('colours a limb by how much health is left', () => {
    expect(limbLevel(35, 35)).toBe('ok');
    expect(limbLevel(34, 35)).toBe('hurt'); // any damage shows
    expect(limbLevel(27, 35)).toBe('hurt'); // one punch on an arm
    expect(limbLevel(13, 35)).toBe('hurt');
    expect(limbLevel(12, 35)).toBe('critical'); // 35% or less left
    expect(limbLevel(1, 35)).toBe('critical');
    expect(limbLevel(0, 35)).toBe('out');
    expect(limbLevel(-3, 35)).toBe('out');
  });
  it('reports all six limbs with their maximum and clamps odd values', () => {
    const r = limbReport({ ...full, leftArm: 99, rightLeg: -5 });
    expect(r.map((x: { limb: string }) => x.limb)).toEqual(['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']);
    expect(r[2]).toMatchObject({ hp: 35, max: 35, level: 'ok' });
    expect(r[5]).toMatchObject({ hp: 0, level: 'out' });
    expect(limbReport(undefined)).toBeNull();
  });
  it('names what is out, and nothing when all works', () => {
    expect(limbOutText(limbReport(full))).toBe('');
    expect(limbOutText(limbReport({ ...full, leftArm: 0 }))).toBe('Left arm out');
    expect(limbOutText(limbReport({ ...full, body: 0, rightLeg: 0 }))).toBe('Body out · Right leg out');
    expect(limbOutText(null)).toBe('');
  });
  it('summarises injuries for screen readers', () => {
    expect(limbSummary(limbReport(full))).toBe('No injuries');
    expect(limbSummary(limbReport({ ...full, head: 10 }))).toBe('Head 10 of 40');
  });
});
