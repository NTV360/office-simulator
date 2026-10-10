import { describe, expect, it } from 'vitest';
import { PROP_KEYS, newProps } from './props';

describe('props', () => {
  it('start with nothing held, and each person gets their own object', () => {
    const a = newProps(), b = newProps();
    expect(Object.keys(a)).toEqual([...PROP_KEYS]);
    expect(Object.values(a).every(v => v === false)).toBe(true);
    a.mug = true;
    expect(b.mug).toBe(false);
  });
});
