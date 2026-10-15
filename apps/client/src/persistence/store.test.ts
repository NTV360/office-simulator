import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLocalSpec, saveLocalSpec } from './store.js';

describe('local player spec persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a player spec through localStorage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    vi.stubGlobal('localStorage', storage);

    const spec = { skin: 'warm', hair: 'short', colors: { shirt: '#f00' } };
    saveLocalSpec(spec);

    expect(values.get('officeSim.playerSpec')).toBe(JSON.stringify(spec));
    expect(loadLocalSpec()).toEqual(spec);
  });
});
