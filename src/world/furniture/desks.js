import * as THREE from 'three';
import { DESK_ISLANDS, SEAT_GAP } from '../../config/desks.js';
import { S, wx, wz } from '../../config/plan.js';
import { pick } from '../../core/util.js';
import { M } from '../../render/materials.js';
import { SCREENS } from '../../render/screens.js';
import { N, SO, mkSpot, officeChair } from './basics.js';
import { addObs, box, cyl, dynamic, frame, staticRoot } from '../helpers.js';

const TETO_SEAT = 'F8'; // Kasane Teto's desk: Desk F, south side, east corner

// Shared desk islands, from the static desk data (config/desks.js). Each chair is a 'desk' spot that knows its
// seat id ('A3') and, for the HR office, the department it belongs to.
function island(def, gap = SEAT_GAP) {
  const { name, cols, sides } = def, [x1, y1, x2, y2] = def.rect;
  let seatNo = 0;
  addObs(x1, y1, x2, y2);
  const cx = wx((x1 + x2) / 2), cz = wz((y1 + y2) / 2), w = (x2 - x1) * S, d = (y2 - y1) * S;
  box(staticRoot, w, .04, d, M.deskTop, cx, .74, cz);
  box(staticRoot, w + .01, .02, d + .01, M.deskEdge, cx, .71, cz, false);
  [-1, 1].forEach(s => box(staticRoot, .04, .7, d - .12, M.deskEdge, cx + s * (w / 2 - .06), .36, cz));
  box(staticRoot, w - .04, .34, .035, M.fabric, cx, .93, cz);
  const cw = (x2 - x1) / cols;
  for (let i = 1; i < cols; i++) box(staticRoot, .03, .26, d - .04, M.fabric, wx(x1 + i * cw), .89, cz);
  const half = d / 2, edge = gap * S;
  for (const side of sides) {
    const top = side === 'top';
    for (let i = 0; i < cols; i++) {
      const px = x1 + (i + .5) * cw, py = top ? y1 - gap : y2 + gap, face = top ? SO : N;
      const spot = mkSpot('desk', px, py, face, { sit: true, place: name, shared: false });
      spot.deskId = def.id + (++seatNo); spot.label = def.room ? `${name} · desk ${seatNo}` : `${name}${seatNo}`; spot.department = def.department ?? null;
      const f = frame(px, py, face);
      officeChair(f, (i + (top ? 0 : 1)) % 3 === 0 ? M.chairSeat2 : M.chairSeat);
      const mz = edge + half - .16;
      box(f, .22, .012, .16, M.monitor, 0, .766, mz);
      box(f, .05, .14, .04, M.monitor, 0, .84, mz + .02);
      box(f, .58, .34, .03, M.monitor, 0, 1.03, mz);
      const scr = dynamic(new THREE.Mesh(new THREE.PlaneGeometry(.54, .3), SCREENS.off));
      scr.position.set(0, 1.03, mz - .017); scr.rotation.y = Math.PI; f.add(scr);
      spot.screen = scr;
      if (spot.deskId === TETO_SEAT) spot.sideScreens = sideMonitors(f, mz);
      box(f, .4, .018, .13, M.keyboard, -.03, .77, edge + .2, false);
      box(f, .05, .02, .08, M.keyboard, .26, .77, edge + .2, false);
      const r = spot.deskId === TETO_SEAT ? 1 : Math.random(); // her desk is kept clear
      if (r < .3) cyl(f, .04, .035, .1, M.white, -.38, .81, edge + .32, 10);
      else if (r < .45) box(f, .2, .025, .27, pick(M.notebook), .36, .775, edge + .35, false);
      else if (r < .52) { cyl(f, .06, .05, .1, M.pot, -.4, .81, mz - .05, 10); const l = new THREE.Mesh(new THREE.IcosahedronGeometry(.09, 0), M.leaf); l.position.set(-.4, .92, mz - .05); f.add(l); }
    }
  }
  return { name, cx, cz, room: !!def.room };
}

// Teto's triple-monitor setup: the middle one faces her, the left and right ones angle in toward her chair.
// They hinge on the middle monitor's edges so the three line up as one wrap; the steep angle keeps them inside her station.
function sideMonitors(f, mz) {
  return [1, -1].map(sd => {
    const ang = .95, hw = .29, gap = .012, x = sd * (hw + gap + hw * Math.cos(ang)), z = mz - hw * Math.sin(ang);
    const mon = new THREE.Group(); mon.position.set(x, 0, z); mon.rotation.y = sd * ang; f.add(mon);
    box(mon, .22, .012, .16, M.monitor, 0, .766, 0);
    box(mon, .05, .14, .04, M.monitor, 0, .84, .02);
    box(mon, .58, .34, .03, M.monitor, 0, 1.03, 0);
    const scr = dynamic(new THREE.Mesh(new THREE.PlaneGeometry(.54, .3), SCREENS.off));
    scr.position.set(0, 1.03, -.017); scr.rotation.y = Math.PI; mon.add(scr);
    return scr;
  });
}

let ISLANDS;

function buildDesks() {
  ISLANDS = DESK_ISLANDS.map(def => island(def));
}

export { ISLANDS, TETO_SEAT, buildDesks };
