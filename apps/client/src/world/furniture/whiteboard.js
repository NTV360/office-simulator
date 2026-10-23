import { seededRandom } from "@office/shared";
import * as THREE from "three";
import { canvasTex, M } from "../../render/materials.js";
import { box } from "../helpers.js";
import { placeLater, placeObject } from "../objects.js";
import { E, mkSpot } from "./basics.js";

// Whiteboards against the east wall, each beside one of the work-floor TVs (workfloor.js), with the open
// floor in front for the discussion. Each has three standing spots (group 'wb<n>'): whoever starts a
// discussion takes the first and presents, colleagues take the others.
const BOARDS = [
  [672, 453],
  [672, 677],
]; // plan pixels: board centre (it faces west, into the office)
const BOARD_WHITE = "#fbfcfd";
const SURFACES = []; // each board's face mesh + its canvas, for drawing on (ui/interact.js)

// (the scribbles are made from the board's number, so every browser draws the same ones)
const boardMat = (i) =>
  new THREE.MeshStandardMaterial({
    roughness: 0.35,
    map: canvasTex(256, 160, (g, w, h) => {
      const rng = seededRandom(i * 131 + 7);
      g.fillStyle = "#fbfcfd";
      g.fillRect(0, 0, w, h);
      g.lineWidth = 3;
      g.lineCap = "round";
      for (const [c, y] of [
        ["#2f6fd6", 30],
        ["#c8302c", 70],
        ["#2a8a4a", 110],
      ]) {
        g.strokeStyle = c;
        g.beginPath();
        g.moveTo(20, y);
        for (let x = 20; x < 150 + rng() * 80; x += 12)
          g.lineTo(x, y + Math.sin(x * 0.3) * 4);
        g.stroke();
      }
      g.strokeStyle = "#25323d";
      g.strokeRect(160, 22, 70, 46);
      g.beginPath();
      g.moveTo(195, 68);
      g.lineTo(195, 120);
      g.stroke();
    }),
  });

/** Whiteboard number `i` drawn at the origin of `g`, facing +z: the board, its frame, the marker tray, the legs and feet. */
const boardMats = [];
function drawWhiteboard(f, i) {
  boardMats[i] ??= boardMat(i);
  const mat = boardMats[i],
    mesh = box(f, 1.4, 0.9, 0.03, mat, 0, 1.45, 0);
  SURFACES[i] = { mesh, canvas: mat.map.image, tex: mat.map }; // drawn on live, so it is not baked
  box(f, 1.46, 0.04, 0.05, M.steel, 0, 1.92, 0);
  box(f, 1.46, 0.04, 0.05, M.steel, 0, 0.98, 0);
  box(f, 1.2, 0.03, 0.08, M.steel, 0, 1.0, 0.05, false); // marker tray
  [-1, 1].forEach((s) => {
    box(f, 0.04, 1.9, 0.04, M.steel, s * 0.7, 0.95, 0);
    box(f, 0.06, 0.03, 0.5, M.steel, s * 0.7, 0.02, 0);
  });
}
// A whiteboard is an item that carries its three standing spots: wheel it elsewhere and the discussion happens there.
function buildWhiteboards() {
  BOARDS.forEach(([px, py], i) => {
    const g = `wb${i}`;
    const ids = [
      mkSpot("whiteboard", px - 13, py + 8, E, {
        place: "the whiteboard",
        group: g,
      }), // presenter, by the board
      mkSpot("whiteboard", px - 34, py - 14, E, {
        place: "the whiteboard",
        group: g,
      }),
      mkSpot("whiteboard", px - 34, py + 20, E, {
        place: "the whiteboard",
        group: g,
      }),
    ].map((s) => s.id);
    placeLater(() =>
      placeObject("whiteboard", px, py, -Math.PI / 2, {
        variant: i,
        spot: ids[0],
        spots: ids.slice(1),
      }),
    ); // (facing west)
  });
}

// A stroke on a board's front from one point to the next (0-1 across, 0-1 down); an eraser stroke is board white.
function boardStroke(b, u0, v0, u1, v1, color, width) {
  const g = b.canvas.getContext("2d"),
    w = b.canvas.width,
    h = b.canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = color ?? BOARD_WHITE;
  g.lineWidth = width;
  g.lineCap = g.lineJoin = "round";
  g.beginPath();
  g.moveTo(u0 * w, v0 * h);
  g.lineTo(u1 * w, v1 * h);
  g.stroke();
  b.tex.needsUpdate = true;
}
// Wipe a board clean.
function clearBoard(b) {
  const g = b.canvas.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = BOARD_WHITE;
  g.fillRect(0, 0, b.canvas.width, b.canvas.height);
  b.tex.needsUpdate = true;
}

const WHITEBOARD_COUNT = BOARDS.length;

export {
  boardStroke,
  buildWhiteboards,
  clearBoard,
  drawWhiteboard,
  SURFACES,
  WHITEBOARD_COUNT,
};
