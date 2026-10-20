import { S, wx, wz } from "../../config/plan.js";
import { M } from "../../render/materials.js";
import { TV_MATS } from "../../render/screens.js";
import { addObs, box, frame, staticRoot } from "../helpers.js";
import { E, N, SO, WST, mkSpot, officeChair } from "./basics.js";
import { cabinet } from "./cabinet.js";
import { tv } from "./tv.js";

function table(x1, y1, x2, y2, top = M.confTable, legs = M.dark, h = 0.74) {
  addObs(x1, y1, x2, y2, h);
  const cx = wx((x1 + x2) / 2),
    cz = wz((y1 + y2) / 2),
    w = (x2 - x1) * S,
    d = (y2 - y1) * S;
  box(staticRoot, w, 0.045, d, top, cx, h - 0.02, cz);
  [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ].forEach(([a, b]) =>
    box(
      staticRoot,
      0.05,
      h - 0.04,
      0.05,
      legs,
      cx + a * (w / 2 - 0.07),
      (h - 0.04) / 2,
      cz + b * (d / 2 - 0.07),
    ),
  );
}
function confSeat(n, px, py, face) {
  mkSpot("conf", px, py, face, {
    sit: true,
    place: `Conference ${n}`,
    room: n,
  });
  officeChair(frame(px, py, face), M.chairSeat2);
}

// Conference 1 is used as a classroom: its meetings are coding classes (sim/meetings.js) with a teacher standing
// by the TV, which shows the lesson while one runs.
const classroom = { tv: null, idle: null };
// Show lesson `i` (TV_MATS.lesson) on the classroom TV, or its usual slides with null.
function showLesson(i) {
  const m = i == null ? classroom.idle : TV_MATS.lesson[i];
  if (classroom.tv && classroom.tv.material !== m) classroom.tv.material = m;
}

function buildConference() {
  // Conference 1 (the classroom): two tables, eight seats facing the TV on the west wall, the teacher's spot
  // beside the TV
  table(158, 96, 174, 168);
  table(205, 96, 221, 168);
  [107, 124, 141, 158].forEach((y) => {
    confSeat(1, 183, y, WST);
    confSeat(1, 230, y, WST);
  });
  cabinet(119, 180, 158, 191.2);
  classroom.tv = tv(116.5, 108, 127, 156, E, "slides");
  classroom.idle = classroom.tv.material;
  mkSpot("teach", 141, 102, E, {
    place: "Conference 1",
    room: 1,
    shared: false,
  });
  // The old Conference 2 is the HR office now: its desks come from config/desks.js (buildDesks).
  // The room keeps its cabinet and wall TV.
  cabinet(384.5, 115, 397.6, 172);
  tv(267, 108, 277, 156, E, "slides");
  // Conference 3: long table, eight seats (the room runs down to y 329)
  table(150, 228, 186, 288);
  [238, 256, 274].forEach((y) => {
    confSeat(3, 141, y, E);
    confSeat(3, 195, y, WST);
  });
  confSeat(3, 168, 216, SO);
  confSeat(3, 168, 300, N);
  cabinet(128, 319, 188, 326.4);
  tv(116, 234, 126, 282, E, "dash");
}

export { buildConference, showLesson, table };
