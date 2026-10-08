import { buildBody } from '../character/rig.js';
import { people, simEvents } from '@office/shared';
import { select, selected } from '../ui/person.js';
import { peopleGroup } from './group.js';

// The simulation only knows people as data. This is where each person gets a body in the scene, and loses it when
// they are removed. Call initPeopleViews() before the simulation creates anyone.
function attach(p) {
  p.body = buildBody(p.spec);
  p.body.root.traverse(o => { if (o.isMesh) o.userData.person = p; });
  p.body.root.visible = false; p.body.ring.visible = false; // shown from the person's state on the next frame (people/sync.js)
  peopleGroup.add(p.body.root); peopleGroup.add(p.body.ring);
}
function detach(p) {
  peopleGroup.remove(p.body.root); peopleGroup.remove(p.body.ring);
  if (selected === p) select(null);
}

function initPeopleViews() {
  simEvents.on('personAdded', attach);
  simEvents.on('personRemoved', detach);
  people.forEach(p => { if (!p.body) attach(p); });
}

export { initPeopleViews };
