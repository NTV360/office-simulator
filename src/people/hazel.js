import { normalizeSpec } from '../character/spec.js';

// Hazel Sellote: the one hand-written character. With the real staff list she is whoever has that name;
// without it she is the first person created (see makePerson). She is a smaller cube character with only her
// furious face (character/rig.js hazelize), runs everywhere (at walking speed), sits in a baby high chair at
// her own desk (HAZEL_DESK), and always leaves last. Her look can't be edited in the character lab.
const HAZEL_NAME = 'Hazel Sellote';
const HAZEL_LOCKED = "Sorry, you can't make Hazel taller than she is now.";

// Her look: a short blocky character (square head) with a bob, navy pants and a permanently furious face.
const HAZEL_LOOK = {
  type: 'blocky', name: 'Hazel', body: 'female', build: 'average', height: 'short', skin: '#d9a27a', eyes: { color: '#1d1411' },
  hair: { style: 'bob', color: '#2b201b' }, top: { style: 'tshirt', color: '#9b4d62' }, bottom: { style: 'pants', color: '#2f3d6b' }, // pants: they move with her legs when she runs
  shoes: { style: 'simple', color: '#2a2228' }, accessories: [], angry: true, special: 'hazel', // smaller, with only her angry face (character/rig.js hazelize)
};

// Hazel's identity for the first generated person: her name, role and look.
function applyHazel() {
  return { first: 'Hazel', last: 'Sellote', role: 'UX/UI Designer', spec: normalizeSpec(HAZEL_LOOK) };
}

export { HAZEL_LOCKED, HAZEL_NAME, applyHazel };
