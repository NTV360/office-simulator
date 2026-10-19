import {
  DESK_ISLANDS,
  HAZEL_DESK,
  S,
  SEAT_GAP,
  W,
  seededRandom,
  wx,
  wz,
} from "@office/shared";
import * as THREE from "three";
import { M } from "../../render/materials.js";
import { attachToObject } from "../../render/objects.js";
import { SCREENS, registerScreen } from "../../render/screens.js";
import { addObs, box, frame, staticRoot } from "../helpers.js";
import { placeLater, placeObject, placeObjectLocal } from "../objects.js";
import { N, SO, mkSpot } from "./basics.js";
import { buildTrike } from "./trike.js";

// Desk ids ('D4') printed small on each desk top, in the front-left corner as seen from the chair. All of them are cells of one texture so the
// baked furniture keeps a single draw call for them.
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

// Each desk seat's chair, desk section and monitor in the seat's own frame (+z toward the desk), by spot id: camera/spots.js deskAt finds a clicked desk
// with it, and people/chick.js where the table top is. (Kept here, not on the spot: a spot is plain data that the layout is made from.)
const deskAreas = new Map();

let seatCounter = 0; // numbers the chairs across all islands: the seed for what is on each desk

// Shared desk islands, from the static desk data (packages/shared/src/layout/desks.ts). Each chair is a 'desk' spot that knows its
// seat id ('A3') and, for the HR office, the department it belongs to.
function island(def, tags, gap = SEAT_GAP) {
  const { name, cols, sides } = def,
    [x1, y1, x2, y2] = def.rect;
  let seatNo = 0;
  addObs(x1, y1, x2, y2);
  addTop(x1, y1, x2, y2, 0.76);
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
      const baby = def.id + (seatNo + 1) === HAZEL_DESK; // Hazel's seat: a baby high chair, so she sits higher
      const spot = mkSpot("desk", px, py, face, {
        sit: true,
        place: name,
        shared: false,
        hipY: baby ? 0.7 : undefined,
      });
      spot.index = ++seatCounter;
      spot.deskId = def.id + ++seatNo;
      spot.label = def.room ? `${name} · desk ${seatNo}` : `${name}${seatNo}`;
      spot.department = def.department ?? null;
      if (baby) buildTrike(W(x1 - 0.3 / S, (y1 + y2) / 2), SO); // her tricycle, parked along the end of the desk
      deskAreas.set(spot.id, {
        halfW: (cw * S) / 2,
        z0: -0.45,
        z1: edge + half,
        front: edge,
      }); // front: where the desk top starts
      const f = frame(px, py, face);
      tags.push({
        f,
        id: spot.deskId,
        x: (cw * S) / 2 - 0.04 - TAG.w / 2,
        z: edge + 0.05,
      });
      const alt = (i + (top ? 0 : 1)) % 3 === 0;
      placeObject("chair-office", px, py, face, {
        variant: baby ? 2 : alt ? 1 : 0,
        spot: spot.id,
        station: spot.id,
      });
      const mz = edge + half - 0.16;
      // the monitor, keyboard and mouse are items (render/objects.js draws them); the monitor's screen is fixed to its face and goes where it goes
      const scr = new THREE.Mesh(
        new THREE.PlaneGeometry(0.54, 0.3),
        SCREENS.off,
      );
      scr.position.set(0, 0.27, -0.017);
      scr.rotation.y = Math.PI;
      registerScreen(spot.id, scr);
      placeLater(
        () =>
          placeObjectLocal("monitor", px, py, face, 0, mz, {
            station: spot.id,
          }),
        (o) => attachToObject(o, scr),
      );
      placeLater(() =>
        placeObjectLocal("keyboard", px, py, face, -0.03, edge + 0.2, {
          station: spot.id,
        }),
      );
      placeLater(() =>
        placeObjectLocal("mouse", px, py, face, 0.26, edge + 0.2, {
          station: spot.id,
        }),
      );
      // what is on the desk: chosen once, from a fixed number per seat (it used to be different on every page load, so no two pages agreed)
      const rng = seededRandom(spot.index * 7919 + 17),
        r = rng(),
        nv = Math.floor(rng() * M.notebook.length);
      // (the notebook sits clear of the mouse: drawn overlapping, it would rest half on the mouse and tip once things have weight)
      if (r < 0.3) {
        placeObjectLocal("mug", px, py, face, -0.38, edge + 0.32, {
          station: spot.id,
        });
      } else if (r < 0.45) {
        placeObjectLocal("notebook", px, py, face, 0.36, edge + 0.38, {
          variant: nv,
          station: spot.id,
        });
      } else if (r < 0.52) {
        placeObjectLocal("plant-desk", px, py, face, -0.4, mz - 0.05, {
          station: spot.id,
        });
      }
    }
  }
  return { name, cx, cz, room: !!def.room };
}

let ISLANDS;

function buildDesks() {
  seatCounter = 0;
  const tags = [];
  deskAreas.clear();
  ISLANDS = DESK_ISLANDS.map((def) => island(def, tags));
  deskTags(tags);
}

export { ISLANDS, buildDesks, deskAreas };
