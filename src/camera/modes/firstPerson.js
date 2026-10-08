import { enterFP, fpUpdate, leaveFP } from '../../fp/firstPerson.js';

// Walk the floor as one person. The camera itself is driven by fpUpdate.
const firstPersonMode = {
  id: 'fp',
  enter() { enterFP(); },
  exit() { leaveFP(); },
  update(dt) { fpUpdate(dt); },
};

export { firstPersonMode };
