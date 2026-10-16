import * as THREE from 'three';
import { ray } from '../camera/spots.js';
import { camera } from '../render/renderer.js';
import { people } from '../sim/state.js';
import { $, keyed } from '../ui/dom.js';
import { statusText } from '../ui/person.js';
import { ctl } from './control.js';
import { player } from './player.js';
import { nearestSeat } from './seating.js';

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const centerNdc = new THREE.Vector2(0, 0);

// The sit/stand button text, and the name + status of whoever is in the middle of the screen.
function updatePrompts() {
  const p = player.person; if (!p) return;
  let act = '';
  if (player.aim) act = ''; // E uses what you aim at (ui/interact.js)
  else if (player.sitting) act = 'Stand up';
  else if (p.state === 'player') { const sp = nearestSeat(p); if (sp) act = `Sit${sp.place ? ' at ' + (sp.kind === 'desk' && sp.owner === p ? 'your desk' : sp.place) : ''}`; }
  const b = $('fpAct'); b.hidden = !act; if (act) keyed(b, ctl.coarse ? null : 'E', act);
  ray.setFromCamera(centerNdc, camera);
  const hits = ray.intersectObjects(people.filter(q => q.state !== 'away' && q !== p).map(q => q.body.root), true);
  const h = hits.find(x => x.object.userData.person && x.distance < 7);
  player.lookAt = h ? h.object.userData.person : null;
  const who = h ? `<b>${esc(h.object.userData.person.name)}</b> · ${esc(statusText(h.object.userData.person))}` : '';
  if ($('fpLook').innerHTML !== who) $('fpLook').innerHTML = who;
}

export { updatePrompts };
