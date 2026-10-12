import * as THREE from 'three';
import { buildBody, disposeBody } from '../character/rig.js';
import { renderer } from '../render/renderer.js';

// A head-and-shoulders render of a person's own 3D model, as a data URL kept on the person (p.portrait).
// Used as Kasane Teto's avatar picture, since she has no profile photo (see ui/teto.js).
const SIZE = 192, OUT = 96;
let ctx = null;

function makeCtx() {
  const sc = new THREE.Scene(); sc.background = new THREE.Color('#d9e1e8');
  sc.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1.2, 2.2, 2); sc.add(key);
  const cv = document.createElement('canvas'), out = document.createElement('canvas');
  cv.width = cv.height = SIZE; out.width = out.height = OUT;
  return { sc, cv, out, rt: new THREE.WebGLRenderTarget(SIZE, SIZE), cam: new THREE.PerspectiveCamera(24, 1, .05, 10), px: new Uint8Array(SIZE * SIZE * 4) };
}

const toSrgb = v => { const c = v / 255; return 255 * (c <= .0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - .055); };

function portrait(p) {
  if (p.portrait) return p.portrait;
  if (!ctx) ctx = makeCtx();
  const { sc, cv, out, rt, cam, px } = ctx;
  const mmd = p.body.mmd;
  const b = mmd ? { root: new THREE.Group() } : buildBody(p.spec), y = mmd ? 1.42 : b.eyeY - .04; // eye height
  if (mmd) {
    // clone() deep-copies userData via JSON, and the model's (and the props riding on her bones) link back to
    // the person, so set those aside while cloning
    const ud = mmd.mesh.userData, held = mmd.holders.map(h => [h, h.parent]);
    held.forEach(([h, par]) => par.remove(h)); mmd.mesh.userData = {};
    const m = mmd.clone(mmd.mesh); // SkeletonUtils.clone, loaded with the model
    mmd.mesh.userData = ud; held.forEach(([h, par]) => par.add(h));
    m.pose(); m.scale.setScalar(mmd.K); b.root.add(m); // standing rest pose for the photo
  }
  sc.add(b.root);
  cam.position.set(.3, y + .03, 1.2); cam.lookAt(0, y - .06, 0);
  const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.render(sc, cam);
  renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, px); renderer.setRenderTarget(prev);
  sc.remove(b.root); if (!mmd) disposeBody(b);
  const g = cv.getContext('2d'), img = g.createImageData(SIZE, SIZE);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const i = ((SIZE - 1 - r) * SIZE + c) * 4, o = (r * SIZE + c) * 4; // render targets are bottom-up
    img.data[o] = toSrgb(px[i]); img.data[o + 1] = toSrgb(px[i + 1]); img.data[o + 2] = toSrgb(px[i + 2]); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const og = out.getContext('2d'); og.imageSmoothingQuality = 'high'; og.drawImage(cv, 0, 0, OUT, OUT);
  return (p.portrait = out.toDataURL());
}

export { portrait };
