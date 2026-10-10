import { normalizeSpec, type CharacterSpec } from '../character/spec';

// Hazel Sellote: the one hand-written character. With the real staff list she is whoever has that name; without it she is the first
// person created (see makeStaff). She has her own look and always leaves last. (Her "Make her angry" button and rage were removed, as on
// `main`: her permanently furious face, `angry`, stays.)
export const HAZEL_NAME = 'Hazel Sellote';

/** Her look: a short blocky character (square head) with a bob, a skirt and a permanently furious face. */
export const HAZEL_LOOK = {
  type: 'blocky', name: 'Hazel', body: 'female', build: 'average', height: 'short', skin: '#d9a27a', eyes: { color: '#1d1411' },
  hair: { style: 'bob', color: '#2b201b' }, top: { style: 'tshirt', color: '#9b4d62' }, bottom: { style: 'skirt', color: '#2f3d6b' },
  shoes: { style: 'simple', color: '#2a2228' }, accessories: [], angry: true,
};

/** Hazel's identity for the first generated person: her name, role and look. */
export function applyHazel(): { first: string; last: string; role: string; spec: CharacterSpec } {
  return { first: 'Hazel', last: 'Sellote', role: 'UX/UI Designer', spec: normalizeSpec(HAZEL_LOOK) };
}
