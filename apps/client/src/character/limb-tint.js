import * as THREE from 'three';

// A coloured shell over each body part of a character, shown only while that part is hurt (people/sync.js drives it from
// `mechanics.health`, the same levels as the body figure in the HUD: player/limb-health.js). The pack's own materials are shared between
// people, so they are never touched: these are separate boxes sitting on the joints, so they follow every pose.
const LEVEL_COLOR = { hurt: 0xe8b84a, critical: 0xd6402a, out: 0x6b7075 };
const LEVEL_OPACITY = { hurt: .38, critical: .5, out: .62 };
const materials = Object.fromEntries(Object.keys(LEVEL_COLOR).map(level => [level, new THREE.MeshBasicMaterial({
  color: LEVEL_COLOR[level], transparent: true, opacity: LEVEL_OPACITY[level], depthWrite: false,
})]));
const PAD = .012; // metres the shell stands off the body

/**
 * Add the six shells to a freshly built body (standing at rest, matrices current). `parts` maps each limb to its joint and the meshes
 * that make that part of the body: { head: [joint, meshes], body: [...], leftArm: [...], ... }. `measure(meshes)` returns their
 * world-space Box3. Returns { limb: mesh }, all hidden.
 */
export function addLimbShells(parts, measure) {
  const shells = {};
  const size = new THREE.Vector3(), centre = new THREE.Vector3();
  for (const [limb, [joint, meshes]] of Object.entries(parts)) {
    if (!joint || !meshes.length) continue;
    const box = measure(meshes);
    if (box.isEmpty()) continue;
    box.getSize(size); box.getCenter(centre);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(size.x + PAD * 2, size.y + PAD * 2, size.z + PAD * 2), materials.hurt);
    shell.position.copy(centre); shell.visible = false; shell.renderOrder = 3; shell.name = `Shell-${limb}`;
    joint.attach(shell);
    shells[limb] = shell;
  }
  return shells;
}

/** Colour and show each shell for a limb report (player/limb-health.js limbReport), or hide them all when there is none. */
export function paintLimbShells(shells, report) {
  if (!shells) return;
  const levels = {};
  for (const r of report ?? []) levels[r.limb] = r.level;
  for (const [limb, shell] of Object.entries(shells)) {
    const level = levels[limb];
    const show = level === 'hurt' || level === 'critical' || level === 'out';
    if (shell.visible !== show) shell.visible = show;
    if (show && shell.material !== materials[level]) shell.material = materials[level];
  }
}
