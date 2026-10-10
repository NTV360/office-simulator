import { describe, expect, it } from 'vitest';
import { CATS, FIRST, LAST, SCREEN_VARIANTS, VERB, roleBag } from './data';

describe('people data', () => {
  it('has 48 unique first names and 16 last initials', () => {
    expect(FIRST).toHaveLength(48);
    expect(new Set(FIRST).size).toBe(48);
    expect(LAST).toHaveLength(16);
  });
  it('role bag has the recorded mix', () => {
    const counts: Record<string, number> = {};
    for (const r of roleBag) counts[r] = (counts[r] || 0) + 1;
    expect(counts).toEqual({ 'Developer': 10, 'QA Engineer': 2, 'Designer': 2, 'Product Manager': 2, 'DevOps': 2, 'Support': 1 });
  });
  it('every role in the bag has an activity verb', () => {
    for (const r of roleBag) expect(VERB[r]).toBeTruthy();
  });
  it('every category has a name and a hex colour', () => {
    expect(Object.keys(CATS)).toEqual(['work', 'meeting', 'phone', 'pantry', 'lunch', 'break', 'chat', 'clean', 'walk']);
    for (const c of Object.values(CATS)) { expect(c.name).toBeTruthy(); expect(c.color).toMatch(/^#[0-9a-f]{6}$/i); }
  });
  it('has the recorded number of screen pictures for each kind of work', () => {
    expect(SCREEN_VARIANTS).toEqual({ code: 6, design: 3, dash: 3 });
  });
});
