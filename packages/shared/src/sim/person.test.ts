import { describe, expect, it } from 'vitest';
import { isControlled, isStaff } from './person';

describe('controller', () => {
  it('splits people into staff and human-controlled, never both', () => {
    expect(isStaff({ controller: 'ai' })).toBe(true);
    expect(isControlled({ controller: 'ai' })).toBe(false);
    expect(isStaff({ controller: 'account' })).toBe(false);
    expect(isControlled({ controller: 'account' })).toBe(true);
  });
});
