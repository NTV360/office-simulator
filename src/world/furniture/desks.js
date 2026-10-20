import * as THREE from "three";
import { DESK_ISLANDS, HAZEL_DESK, SEAT_GAP } from "../../config/desks.js";
import { S, W, wx, wz } from "../../config/plan.js";
import { pick } from "../../core/util.js";
import { M } from "../../render/materials.js";
import { SCREENS } from "../../render/screens.js";
import { addObs, box, cyl, dynamic, frame, staticRoot } from "../helpers.js";
import { N, SO, mkSpot, officeChair } from "./basics.js";
import { buildTrike } from "./trike.js";

// A baby high chair, the kind toddlers eat in: splayed legs, a raised padded seat, a footrest and a tray.
// Hazel's seat (config/desks.js HAZEL_DESK). Local frame like officeChair: +z faces the desk.
const HIGH = {
  frame: new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: 0.45 }),
  pad: new THREE.MeshStandardMaterial({ color: 0x9fd0e4, roughness: 0.8 }),
};
function highChair(f) {
  const g = new THREE.Group();
  f.add(g);
  [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].forEach(([sx, sz]) => {
    const leg = box(
      g,
      0.035,
      0.74,
      0.035,
      HIGH.frame,
      sx * 0.2,
      0.36,
      sz * 0.18,
    );
    leg.rotation.set(-sz * 0.14, 0, sx * 0.14); // feet splayed out wider than the seat
  });
  box(g, 0.5, 0.03, 0.03, HIGH.frame, 0, 0.02, 0.23);
  box(g, 0.5, 0.03, 0.03, HIGH.frame, 0, 0.02, -0.23); // floor bars between the feet
  box(g, 0.3, 0.03, 0.04, HIGH.frame, 0, 0.32, 0.2); // footrest
  box(g, 0.36, 0.05, 0.32, HIGH.frame, 0, 0.66, 0); // seat
  box(g, 0.32, 0.03, 0.28, HIGH.pad, 0, 0.695, 0); // seat cushion
  box(g, 0.34, 0.34, 0.05, HIGH.frame, 0, 0.86, -0.15);
  box(g, 0.3, 0.3, 0.02, HIGH.pad, 0, 0.86, -0.12); // padded back
  [-1, 1].forEach((s) =>
    box(g, 0.03, 0.14, 0.26, HIGH.frame, s * 0.18, 0.76, 0.0),
  ); // side rails
  box(g, 0.42, 0.025, 0.2, HIGH.frame, 0, 0.84, 0.22); // the eating tray
  box(g, 0.42, 0.03, 0.02, HIGH.frame, 0, 0.855, 0.32); // tray lip
  return g;
}

// Desk ids ('D4') printed small on each desk top, in the front-left corner as seen from the chair. All of them
// are cells of one texture so the baked furniture keeps a single draw call for them.
const TAG = {
  w: 0.13,
  h: 0.065,
  cw: 128,
  ch: 64,
  cols: 8,
  font: '600 40px Archivo, "Helvetica Neue", Arial, sans-serif',
  ink: "#56616b",
};
function deskTags(tags) {
  const rows = Math.ceil(tags.length / TAG.cols),
    c = document.createElement("canvas");
  c.width = TAG.cw * TAG.cols;
  c.height = TAG.ch * rows;
  const g = c.getContext("2d"),
    tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = () => {
    g.clearRect(0, 0, c.width, c.height);
    g.font = TAG.font;
    g.fillStyle = TAG.ink;
    g.textBaseline = "middle";
    tags.forEach((t, i) =>
      g.fillText(
        t.id,
        (i % TAG.cols) * TAG.cw + 6,
        (Math.floor(i / TAG.cols) + 0.5) * TAG.ch,
      ),
    );
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.ready.then(draw); // again once the web font is in
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  tags.forEach((t, i) => {
    const geo = new THREE.PlaneGeometry(TAG.w, TAG.h),
      uv = geo.attributes.uv,
      col = i % TAG.cols,
      row = Math.floor(i / TAG.cols);
    for (let k = 0; k < uv.count; k++)
      uv.setXY(
        k,
        (col + uv.getX(k)) / TAG.cols,
        1 - (row + 1 - uv.getY(k)) / rows,
      );
    const m = new THREE.Mesh(geo, mat);
    m.position.set(t.x, 0.762, t.z);
    m.rotation.set(-Math.PI / 2, 0, Math.PI); // flat on the top, reading from the chair
    t.f.add(m);
  });
}

const CHAIR_R = 6.6; // plan pixels: a chair's radius (.27 m)

// Shared desk islands, from the static desk data (config/desks.js). Each chair is a 'desk' spot that knows its
// seat id ('A3') and, for the HR office, the department it belongs to.
function island(def, tags, gap = SEAT_GAP) {
  const { name, cols, sides } = def,
    [x1, y1, x2, y2] = def.rect;
  let seatNo = 0;
  addObs(x1, y1, x2, y2, 0.76);
  const cx = wx((x1 + x2) / 2),
    cz = wz((y1 + y2) / 2),
    w = (x2 - x1) * S,
    d = (y2 - y1) * S;
  box(staticRoot, w, 0.04, d, M.deskTop, cx, 0.74, cz);
  box(staticRoot, w + 0.01, 0.02, d + 0.01, M.deskEdge, cx, 0.71, cz, false);
  [-1, 1].forEach((s) =>
    box(
      staticRoot,
      0.04,
      0.7,
      d - 0.12,
      M.deskEdge,
      cx + s * (w / 2 - 0.06),
      0.36,
      cz,
    ),
  );
  box(staticRoot, w - 0.04, 0.34, 0.035, M.fabric, cx, 0.93, cz);
  const cw = (x2 - x1) / cols;
  for (let i = 1; i < cols; i++)
    box(staticRoot, 0.03, 0.26, d - 0.04, M.fabric, wx(x1 + i * cw), 0.89, cz);
  const half = d / 2,
    edge = gap * S;
  for (const side of sides) {
    const top = side === "top";
    for (let i = 0; i < cols; i++) {
      const px = x1 + (i + 0.5) * cw,
        py = top ? y1 - gap : y2 + gap,
        face = top ? SO : N;
      const deskId = def.id + (seatNo + 1),
        baby = deskId === HAZEL_DESK;
      const spot = mkSpot("desk", px, py, face, {
        sit: true,
        place: name,
        shared: false,
        hipY: baby ? 0.7 : undefined,
      });
      spot.deskId = def.id + ++seatNo;
      spot.label = def.room ? `${name} · desk ${seatNo}` : `${name}${seatNo}`;
      spot.department = def.department ?? null;
      addObs(
        px - CHAIR_R,
        py - CHAIR_R,
        px + CHAIR_R,
        py + CHAIR_R,
        spot.hipY || 0.53,
      ); // the chair is in the way too (people walk around it); seat-top is standable when jumping
      const f = frame(px, py, face);
      if (baby) {
        highChair(f);
        buildTrike(W(x1 - 0.3 / S, (y1 + y2) / 2), SO);
      } // her tricycle, parked along the end of the desk
      else
        officeChair(
          f,
          (i + (top ? 0 : 1)) % 3 === 0 ? M.chairSeat2 : M.chairSeat,
        );
      spot.area = {
        halfW: (cw * S) / 2,
        z0: -0.45,
        z1: edge + half,
        front: edge,
      }; // front: where the desk top starts (people/chick.js) // this seat's chair, desk and monitor, in its own frame (camera/spots.js deskAt)
      tags.push({
        f,
        id: spot.deskId,
        x: (cw * S) / 2 - 0.04 - TAG.w / 2,
        z: edge + 0.05,
      });
      const mz = edge + half - 0.16;
      box(f, 0.22, 0.012, 0.16, M.monitor, 0, 0.766, mz);
      box(f, 0.05, 0.14, 0.04, M.monitor, 0, 0.84, mz + 0.02);
      box(f, 0.58, 0.34, 0.03, M.monitor, 0, 1.03, mz);
      const scr = dynamic(
        new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.3), SCREENS.off),
      );
      scr.position.set(0, 1.03, mz - 0.017);
      scr.rotation.y = Math.PI;
      f.add(scr);
      spot.screen = scr;
      box(f, 0.4, 0.018, 0.13, M.keyboard, -0.03, 0.77, edge + 0.2, false);
      box(f, 0.05, 0.02, 0.08, M.keyboard, 0.26, 0.77, edge + 0.2, false);
      const r = Math.random();
      if (r < 0.3)
        cyl(f, 0.04, 0.035, 0.1, M.white, -0.38, 0.81, edge + 0.32, 10);
      else if (r < 0.45)
        box(
          f,
          0.2,
          0.025,
          0.27,
          pick(M.notebook),
          0.36,
          0.775,
          edge + 0.35,
          false,
        );
      else if (r < 0.52) {
        cyl(f, 0.06, 0.05, 0.1, M.pot, -0.4, 0.81, mz - 0.05, 10);
        const l = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.09, 0),
          M.leaf,
        );
        l.position.set(-0.4, 0.92, mz - 0.05);
        f.add(l);
      }
    }
  }
  return { name, cx, cz, room: !!def.room };
}

let ISLANDS;

function buildDesks() {
  const tags = [];
  ISLANDS = DESK_ISLANDS.map((def) => island(def, tags));
  deskTags(tags);
}

export { ISLANDS, buildDesks };
