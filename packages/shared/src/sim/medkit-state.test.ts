import { beforeEach, describe, expect, it } from 'vitest';
import { MEDKIT_MAX, medkitContents, resetMedkitState, returnToMedkit, stepMedkits, takeFromMedkit } from './medkit-state';

beforeEach(() => resetMedkitState());

describe('a medkit box', () => {
  it('starts full: 10 bandages and 5 first-aid boxes', () => {
    expect(medkitContents(7)).toEqual({ bandage: 10, 'first-aid-box': 5 });
  });

  it('gives one at a time, and nothing when it is empty', () => {
    for (let i = 0; i < MEDKIT_MAX.bandage; i++) expect(takeFromMedkit(7, 'bandage')).toBe(true);
    expect(takeFromMedkit(7, 'bandage')).toBe(false);
    expect(medkitContents(7)).toEqual({ bandage: 0, 'first-aid-box': 5 });
  });

  it('boxes are separate', () => {
    takeFromMedkit(1, 'first-aid-box');
    expect(medkitContents(1)['first-aid-box']).toBe(4);
    expect(medkitContents(2)['first-aid-box']).toBe(5);
  });

  it('makes a bandage every 5 seconds and a first-aid box every 15, up to the most it holds', () => {
    for (let i = 0; i < 10; i++) takeFromMedkit(3, 'bandage');
    for (let i = 0; i < 5; i++) takeFromMedkit(3, 'first-aid-box');
    expect(stepMedkits(4.9)).toEqual([]);
    expect(medkitContents(3)).toEqual({ bandage: 0, 'first-aid-box': 0 });
    expect(stepMedkits(.1)).toEqual([3]); // 5 s: the first bandage
    expect(medkitContents(3)).toEqual({ bandage: 1, 'first-aid-box': 0 });
    stepMedkits(10); // 15 s: two more bandages, and the first first-aid box
    expect(medkitContents(3)).toEqual({ bandage: 3, 'first-aid-box': 1 });
    stepMedkits(1000);
    expect(medkitContents(3)).toEqual({ bandage: 10, 'first-aid-box': 5 });
    expect(stepMedkits(100)).toEqual([]); // full: nothing changes
  });

  it('a full box does not bank time towards the next one', () => {
    medkitContents(4);
    stepMedkits(100);
    takeFromMedkit(4, 'bandage');
    stepMedkits(4);
    expect(medkitContents(4).bandage).toBe(9);
    stepMedkits(1);
    expect(medkitContents(4).bandage).toBe(10);
  });

  it('ignores a time that is not a positive number', () => {
    takeFromMedkit(5, 'bandage');
    for (const dt of [0, -1, NaN, Infinity]) stepMedkits(dt);
    expect(medkitContents(5).bandage).toBe(9);
  });

  it('takes a returned item back, never above the most it holds', () => {
    takeFromMedkit(6, 'bandage');
    returnToMedkit(6, 'bandage');
    returnToMedkit(6, 'bandage');
    expect(medkitContents(6).bandage).toBe(10);
  });
});
