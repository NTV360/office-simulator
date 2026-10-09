import { describe, expect, it } from 'vitest';
import { hasSlot, isAi, isDriven } from './person';

describe('the three kinds of question about a person', () => {
  it('isAi and isDriven split people by who drives them, never both', () => {
    expect(isAi({ controller: 'ai' })).toBe(true);
    expect(isDriven({ controller: 'ai' })).toBe(false);
    expect(isAi({ controller: 'account' })).toBe(false);
    expect(isDriven({ controller: 'account' })).toBe(true);
  });
  it('hasSlot is about the desk, not about who drives', () => {
    const desk = {};
    expect(hasSlot({ slot: desk })).toBe(true);
    expect(hasSlot({})).toBe(false);
    expect(hasSlot({ slot: undefined })).toBe(false);
    // the four kinds of person the phase will have
    expect([isAi({ controller: 'ai' }), hasSlot({ slot: desk })]).toEqual([true, true]);          // unclaimed NPC, or a claimed one on autopilot
    expect([isDriven({ controller: 'account' }), hasSlot({ slot: desk })]).toEqual([true, true]); // an owner who is online
    expect([isDriven({ controller: 'account' }), hasSlot({})]).toEqual([true, false]);            // a guest
  });
});
