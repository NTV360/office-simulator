import * as THREE from 'three';
import { trike } from '../world/furniture/trike.js';

// Hazel on her tricycle (world/furniture/trike.js). Each time she sets off, if the trike is close by, she
// either runs as usual or rides it (same speed: she covers what she'd walk). It is left beside her where she
// gets off, and goes back to its spot by her desk when she sits down there or goes home. `p.riding` picks
// the 'ride' pose (people/animation.js).
const REACH = 2.5;   // metres: further than this from the trike and she just runs
const FRONT_R = .16, BACK_R = .1; // wheel radii, for turning them as it rolls

function park(at, face) { trike.root.position.copy(at); trike.root.rotation.y = face; }
function parkHome() { park(trike.home.pos, trike.home.face); }

function hazelRide(p) {
  if (!trike.root) return;
  const walking = p.state === 'walking';
  if (walking && !p.wasWalking) p.riding = trike.root.position.distanceTo(p.pos) < REACH && Math.random() < .5;
  if (!walking && p.wasWalking && p.riding) {
    p.riding = false;
    // got off: by her desk it goes back to its spot, anywhere else it stays beside her
    if (p.task?.spot === p.slot) parkHome();
    else park(new THREE.Vector3(p.pos.x + Math.cos(p.face) * .5, 0, p.pos.z - Math.sin(p.face) * .5), p.face);
  }
  p.wasWalking = walking;
  if (p.riding) {
    const r = trike.root, moved = Math.hypot(p.pos.x - r.position.x, p.pos.z - r.position.z);
    trike.front.rotation.x += moved / FRONT_R; trike.backs.forEach(w => { w.rotation.x += moved / BACK_R; });
    p.pedal = trike.front.rotation.x; // her legs go round with the pedals
    park(p.pos, p.face);
  } else if (p.state === 'away' || (p.state === 'doing' && p.task?.spot === p.slot)) {
    if (!trike.root.position.equals(trike.home.pos)) parkHome(); // put away for the night, or back by her desk
  }
}

export { hazelRide };
