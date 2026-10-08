import { angDiff } from '@office/shared';
import { beginControl, ctl, driveLocomotion, endControl, tickPrompts } from '../../player/control.js';
import { player, spawnPlayer } from '../../player/player.js';
import { camera } from '../../render/renderer.js';
import { $ } from '../../ui/dom.js';
import { select } from '../../ui/person.js';
import { armFraction } from '../collide.js';
import { settleOn } from '../state.js';

// Over-the-shoulder camera behind the player's character. The camera sits above and behind, shifted
// to one side so the character stands off-centre and the crosshair looks past them.
const tp = {
  dist: 3.4, minDist: 1.6, maxDist: 6.5, // how far behind the head
  offset: .6,                           // sideways shift, metres
  side: 1, sideNow: 1,                  // +1 = right shoulder, -1 = left; sideNow eases between them
  clear: 1,                             // fraction of the arm that is free of walls (eased)
  head: 1.55,                           // current head height (eased)
};
const HIDE_BODY_BELOW = .55;            // camera closer than this to the head: hide the body

const thirdPersonMode = {
  id: 'third',
  enter() {
    const p = spawnPlayer();
    select(null);
    if (!player.sitting) p.task = null;
    beginControl('tp', p, { title: 'Third person', keys: 'WASD move · drag look · wheel zoom · C swap shoulder · Shift run · E sit · V first person · Esc exit' });
    ctl.pitchMin = -.75; ctl.pitchMax = .7; ctl.pitch = -.14;
    ctl.keyHook = k => { if (k === 'c') tp.side = -tp.side; };
    ctl.wheelHook = dy => { tp.dist = Math.max(tp.minDist, Math.min(tp.maxDist, tp.dist * Math.exp(dy * .0008))); };
    tp.clear = 1; tp.sideNow = tp.side; tp.head = (player.sitting ? 1.15 : 1.55) * p.spec.scale;
    camera.fov = 55; camera.near = .1; camera.updateProjectionMatrix();
    p.body.root.visible = true;
    $('crosshair').hidden = false;
  },
  exit(ctrl) {
    const p = player.person;
    endControl(ctrl.nextId);
    camera.fov = 38; camera.near = .1; camera.updateProjectionMatrix();
    $('crosshair').hidden = true;
    if (p) { p.body.root.visible = true; p.task = player.sitting ? p.task : null; settleOn(p); }
  },
  update(dt) {
    const p = player.person; if (!p) return;
    const { dx, dz } = driveLocomotion(dt, p);
    // the character turns toward where it walks; when seated it faces its seat
    if (player.sitting) p.face = p.faceGoal = player.sitting.face;
    else { if (dx || dz) p.faceGoal = Math.atan2(dx, dz); p.face += angDiff(p.face, p.faceGoal) * (1 - Math.exp(-dt * 12)); }

    tp.sideNow += (tp.side - tp.sideNow) * (1 - Math.exp(-dt * 8));
    const headGoal = (player.sitting ? 1.15 : 1.55) * p.spec.scale; tp.head += (headGoal - tp.head) * (1 - Math.exp(-dt * 8));
    const yaw = ctl.yaw, pit = ctl.pitch, cp = Math.cos(pit), sp = Math.sin(pit);
    const dirX = Math.sin(yaw) * cp, dirY = sp, dirZ = Math.cos(yaw) * cp;       // where the camera looks
    const rightX = -Math.cos(yaw), rightZ = Math.sin(yaw);
    const hx = p.pos.x, hy = tp.head, hz = p.pos.z;                               // the head: start of the arm
    const wx = hx + rightX * tp.offset * tp.sideNow - dirX * tp.dist;
    const wy = hy - dirY * tp.dist;
    const wz = hz + rightZ * tp.offset * tp.sideNow - dirZ * tp.dist;             // where the camera wants to be

    let t = armFraction(hx, hy, hz, wx, wy, wz);
    if (wy < .3) t = Math.min(t, Math.max(0, (hy - .3) / (hy - wy)));            // stay above the floor
    if (t < tp.clear) tp.clear = t; else tp.clear += (t - tp.clear) * (1 - Math.exp(-dt * 4)); // snap in, ease out
    camera.position.set(hx + (wx - hx) * tp.clear, hy + (wy - hy) * tp.clear, hz + (wz - hz) * tp.clear);
    camera.lookAt(camera.position.x + dirX * 10, camera.position.y + dirY * 10, camera.position.z + dirZ * 10);
    p.body.root.visible = tp.clear * Math.hypot(wx - hx, wy - hy, wz - hz) >= HIDE_BODY_BELOW;
    tickPrompts(dt);
  },
};

export { thirdPersonMode, tp };
