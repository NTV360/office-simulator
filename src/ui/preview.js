import * as THREE from 'three';
import { buildBody, disposeBody } from '../character/rig.js';
import { sameLook } from '../character/spec.js';
import { applyPose } from '../people/animation.js';

// A small second 3D view of the player's character, shown inside the creator. It has its own renderer and
// scene, so it works in first person (where you cannot see yourself) and never touches the main scene.
const FRAMES = { full: { y: .95, dist: 3.7 }, head: { y: 1.55, dist: 1.15 } }; // look-at height (metres at scale 1) and camera distance
const SPIN_AFTER = 2, SPIN_RATE = .4; // idle seconds before it turns by itself, and how fast (rad/s)

// Returns { setSpec, setFrame, start, stop }, or null if this browser cannot make another WebGL context.
function makePreview(canvas) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (_) { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, .1, 20);
  scene.add(new THREE.HemisphereLight(0xf4f8fb, 0xaab4bb, 1.4));
  const key = new THREE.DirectionalLight(0xfff3e2, 2.4); key.position.set(2, 4, 3); scene.add(key);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(.7, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .1, depthWrite: false }));
  pad.rotation.x = -Math.PI / 2; pad.position.y = .003; scene.add(pad);

  // the pose code only needs a few fields of a person; "preview" is not a state it knows, so it idles
  const person = { state: 'preview', task: null, pose: {}, animT: 0, walkPhase: 0, body: null };
  let spec = null, yaw = .5, idle = 0, frame = 'full', camY = FRAMES.full.y, camD = FRAMES.full.dist, running = false, raf = 0, last = 0, drag = null;

  function setSpec(next) {
    if (person.body && spec && sameLook(spec, next)) { person.body.root.scale.setScalar(next.scale); spec = next; return; }
    if (person.body) { scene.remove(person.body.root); disposeBody(person.body); }
    spec = next; person.body = buildBody(next); person.body.ring.visible = false; scene.add(person.body.root);
  }
  function setFrame(name) { if (FRAMES[name]) frame = name; }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return false;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    return true;
  }
  function loop(now) {
    if (!running) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (person.body && resize()) {
      idle += dt; if (!drag && idle > SPIN_AFTER) yaw += dt * SPIN_RATE;
      person.animT += dt; applyPose(person, dt);
      person.body.root.rotation.y = yaw;
      const goal = FRAMES[frame], k = 1 - Math.exp(-dt * 8), s = spec.scale;
      camY += (goal.y * s - camY) * k; camD += (goal.dist * s - camD) * k;
      cam.position.set(0, camY + camD * .08, camD); cam.lookAt(0, camY, 0);
      renderer.render(scene, cam);
    }
    raf = requestAnimationFrame(loop);
  }
  function start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  // drag to turn the character
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX }; idle = 0; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} });
  canvas.addEventListener('pointermove', e => { if (!drag) return; yaw += (e.clientX - drag.x) * .012; drag.x = e.clientX; idle = 0; });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

  return { setSpec, setFrame, start, stop };
}

export { makePreview };
