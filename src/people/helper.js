import { normalizeSpec } from '../character/spec.js';

// Our office helper: not an employee in the database, so she is added on her own (makeHelper in factory.js).
// She keeps the office clean and tidy all day: wiping the tables and the windows, mopping the floor and
// organising the storage room (sim/tasks.js cleanNext). She always wears a black shirt and black pants.
const HELPER_NAME = 'Office Helper'; // her name, as shown in the office
const HELPER_TITLE = 'Housekeeping';

const HELPER_LOOK = {
  type: 'chibi', name: 'Office Helper', body: 'female', build: 'average', height: 'average', skin: '#cf9772', cheeks: true,
  eyes: { style: 'round', color: '#3b2416' }, hair: { style: 'ponytail', color: '#1c1715' },
  top: { style: 'tshirt', color: '#1b1b1d' }, bottom: { style: 'pants', color: '#1b1b1d' }, shoes: { style: 'simple', color: '#121214' },
  accessories: [],
};

function helperIdentity() {
  return { name: HELPER_NAME, role: 'Support', title: HELPER_TITLE, userId: null, department: null, shift: null, spec: normalizeSpec(HELPER_LOOK) };
}

export { HELPER_NAME, helperIdentity };
