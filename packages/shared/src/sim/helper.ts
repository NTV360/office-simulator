import { normalizeSpec, type CharacterSpec } from '../character/spec';

// Our office helper: not an employee in the staff list, so she is added on her own (makeHelper in factory.ts). She keeps the office clean
// and tidy all day: wiping the tables and the windows, mopping the floor and organising the storage room (sim/tasks.ts, cleanNext). She has no
// desk, is not saved with the world (the server makes her again at start-up), and always wears a black shirt and black pants.
// (This is `main`'s people/helper.js.)
export const HELPER_NAME = 'Office Helper';
export const HELPER_TITLE = 'Housekeeping';

export const HELPER_LOOK = {
  type: 'chibi', name: 'Office Helper', body: 'female', build: 'average', height: 'average', skin: '#cf9772', cheeks: true,
  eyes: { style: 'round', color: '#3b2416' }, hair: { style: 'ponytail', color: '#1c1715' },
  top: { style: 'tshirt', color: '#1b1b1d' }, bottom: { style: 'pants', color: '#1b1b1d' }, shoes: { style: 'simple', color: '#121214' },
  accessories: [],
};

export function helperIdentity(): { name: string; role: string; title: string; userId: null; department: null; desk: null; shift: null; spec: CharacterSpec } {
  return { name: HELPER_NAME, role: 'Support', title: HELPER_TITLE, userId: null, department: null, desk: null, shift: null, spec: normalizeSpec(HELPER_LOOK) };
}
