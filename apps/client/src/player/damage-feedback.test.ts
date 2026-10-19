import { describe, expect, it } from 'vitest';
import { LIMB_MAX_HP } from '@office/shared';
// @ts-expect-error: plain JavaScript modules
import { conditionMessage, damageBetween, flashStrength } from './damage-feedback.js';
// @ts-expect-error: plain JavaScript module
import { limbReport } from './limb-health.js';

const full = { ...LIMB_MAX_HP };
const msg = (over: Partial<typeof full>) => conditionMessage(limbReport({ ...full, ...over }));

describe('what a new health reading lost', () => {
  it('reports the loss per part, and which part just broke', () => {
    const d = damageBetween(full, { ...full, body: 72, leftArm: 0 });
    expect(d.total).toBeCloseTo(8 + 35);
    expect(d.parts).toEqual({ body: 8, leftArm: 35 });
    expect(d.newlyOut).toEqual(['leftArm']);
  });
  it('is nothing for healing, no change, or no earlier reading (joining hurt is not a hit)', () => {
    expect(damageBetween({ ...full, body: 50 }, full)).toBeNull();
    expect(damageBetween(full, { ...full })).toBeNull();
    expect(damageBetween(null, full)).toBeNull();
    expect(damageBetween(full, undefined)).toBeNull();
    expect(damageBetween({ ...full, head: 0 }, { ...full, head: 0 })).toBeNull();
  });
  it('a part already at 0 is not newly broken', () => {
    expect(damageBetween({ ...full, head: 0, body: 80 }, { ...full, head: 0, body: 70 }).newlyOut).toEqual([]);
  });
});

describe('how hard the red flash is', () => {
  it('grows with the damage and is never nothing or more than full', () => {
    const light = flashStrength(damageBetween(full, { ...full, body: 72 })), hard = flashStrength(damageBetween(full, { ...full, body: 40 }));
    expect(light).toBeGreaterThanOrEqual(.25);
    expect(light).toBeLessThan(.5);
    expect(hard).toBeGreaterThan(light);
    expect(flashStrength(damageBetween(full, { ...full, body: 0 }))).toBeLessThanOrEqual(1);
    expect(flashStrength(null)).toBe(0);
  });
  it('a part breaking is always a strong flash, even from a small hit', () => {
    expect(flashStrength(damageBetween({ ...full, head: 3 }, { ...full, head: 0 }))).toBeGreaterThanOrEqual(.9);
  });
});

describe('the message at the bottom of the screen', () => {
  it('says nothing when all is well or only a little hurt', () => {
    expect(msg({})).toBeNull();
    expect(msg({ body: 60, leftArm: 20 })).toBeNull();
    expect(conditionMessage(null)).toBeNull();
  });
  it('says which part is almost broken', () => {
    expect(msg({ leftArm: 5 })).toEqual({ text: 'Your left arm is almost broken. Treat it immediately.', tone: 'warn' });
    expect(msg({ head: 10 })?.text).toBe('Your head is almost broken. Treat it immediately.');
  });
  it('groups two parts of a kind', () => {
    expect(msg({ leftArm: 5, rightArm: 5 })?.text).toBe('Both your arms are almost broken. Treat them immediately.');
    expect(msg({ leftLeg: 5, head: 8 })?.text).toBe('Your head and left leg are almost broken. Treat them immediately.');
  });
  it('says what a broken part means, as the game really works', () => {
    expect(msg({ leftLeg: 0 })).toEqual({ text: "Your left leg is broken, you can't walk. Treat it immediately.", tone: 'broken' });
    expect(msg({ leftArm: 0 })?.text).toBe('Your left arm is broken. Treat it immediately.'); // one arm still works: nothing is lost outright
    expect(msg({ leftArm: 0, rightArm: 0 })?.text).toBe("Both your arms are broken, you can't use your hands. Treat them immediately.");
    expect(msg({ body: 0 })?.text).toContain("you can't move or use your hands");
    expect(msg({ head: 0 })?.text).toBe('Your head is broken. Treat it immediately.'); // (sight and hearing are not in the game yet, so it promises nothing)
  });
  it('mentions both what is broken and what is almost', () => {
    expect(msg({ leftLeg: 0, rightArm: 6 })?.text).toBe("Your left leg is broken, you can't walk. Your right arm is almost broken. Treat them immediately.");
  });
  it('calls out the whole body when most of it is failing or little health is left', () => {
    expect(msg({ head: 5, body: 10, leftArm: 4, rightLeg: 6 })).toMatchObject({ tone: 'severe' });
    expect(msg({ head: 5, body: 5, leftArm: 3, rightArm: 3, leftLeg: 4, rightLeg: 4 })?.text).toBe('Your whole body is severely damaged. Get treatment now.');
    expect(msg({ head: 0, body: 12, leftArm: 4, rightArm: 4, leftLeg: 10, rightLeg: 10 })?.text).toContain('parts are broken');
  });
});
