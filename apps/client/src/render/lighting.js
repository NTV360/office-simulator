import * as THREE from 'three';
import { hemi, sun } from './renderer.js';
import { sim } from '../sim/state.js';

/* ================= Lighting through the day ================= */
const cWarm = new THREE.Color(0xffc58f), cDay = new THREE.Color(0xfff6ea), cDusk = new THREE.Color(0x8fa6d6);
function updateLight() {
  const h = sim.t / 60, a = Math.min(Math.max((h - 6.5) / 13, 0), 1) * Math.PI;
  const el = Math.sin(a);
  sun.position.set(Math.cos(a) * 34, 8 + el * 30, -6);
  sun.target.position.set(0, 0, 0);
  const warm = Math.max(0, 1 - el * 1.8);
  sun.color.copy(cDay).lerp(cWarm, warm);
  if (h > 18.3) sun.color.lerp(cDusk, Math.min(1, (h - 18.3) / .8));
  sun.intensity = .5 + el * 1.9;
  hemi.intensity = 1.0 + el * .35;
}

export { updateLight };
