import type { CharacterSpec } from '../character/spec';

// Hazel Sellote: the one hand-written character. She is the first person created, has her own look and
// always leaves last. (Her HUD buttons and rage effect are client features.)
export const HAZEL_NAME = 'Hazel Sellote';

/** Give the first generated person Hazel's identity. Mutates the spec; returns her name and role. */
export function applyHazel(spec: CharacterSpec): { first: string; last: string; role: string } {
  Object.assign(spec, { style: 'bob', cube: true, hair: '#2b201b', scale: .7, skirt: '#2f3d6b', angry: true, glasses: false, headphones: null, jacket: null, shirt: '#9b4d62', pants: '#2a2228', skin: '#d9a27a' });
  return { first: 'Hazel', last: 'Sellote', role: 'UX/UI Designer' };
}
