import {
  angDiff,
  goDo,
  inSlap,
  interactables,
  people,
  pick,
  placeNow,
  sim,
} from "@office/shared";
import * as THREE from "three";
import { keys } from "../camera/input.js";
import { eyeHeight } from "../character/rig.js";
import { ctl } from "../player/control.js";
import { player } from "../player/player.js";
import { updatePrompts } from "../player/prompts.js";
import { standUp } from "../player/seating.js";
import { camera, renderer, scene } from "../render/renderer.js";
import { MY_DARTS, throwDart } from "../world/furniture/darts.js";
import {
  LOUNGE_TV_POS,
  fightState,
  loungeTV,
  startHumanFight,
  stopHumanFight,
} from "../world/furniture/game.js";
import {
  GOLF_HOLE,
  PUTT,
  golfBall,
  putt,
  resetPutt,
} from "../world/furniture/golf.js";
import { $, keyHints } from "./dom.js";

/* ================= Darts and mini golf, played ================= */
// E at the dartboard or by the golf ball (ui/interact.js) starts a game with a view of its own.
// Darts: you stand on the throw line and the board fills the view; the mouse (or the arrow keys) moves the aim ring
// on the board, Space or a click throws, and after three darts the same collects them for the next round.
// Golf: the camera sits behind the ball looking down the line and you stand beside it with the putter; the mouse
// (or A D) turns the line, hold Space (or the mouse button) to build power and let go to putt. The camera follows
// the ball, then you walk up to it for the next stroke. Esc leaves either.
// The PS5: sit at one of the TV lounge's gaming seats and you have the controller; the view is the TV, you are KAI
// in the fight game (world/furniture/game.js) against the CPU, or against someone you invite over, who sits down
// beside you and plays ROSA. Esc gets you up. While you play any of these, the keys are the game's.
const AIM = 0.2; // radians: how far the darts aim can move off the board's middle
const SWAY = 0.006; // metres: the darts aim's gentle hand sway
const PUTT_MAX = 5.5; // metres: a full-power putt
const game = {
  kind: null,
  fov: null,
  held: new Set(),
  msg: "",
  base: { yaw: 0, pitch: 0 },
  eye: new THREE.Vector3(),
  aim: new THREE.Vector3(),
  ring: null,
  darts: [],
  round: 1,
  best: 0,
  t: 0,
  dir: 0,
  charging: false,
  power: 0,
  chargeT: 0,
  rolling: false,
  line: null,
  look: new THREE.Vector3(),
  cam: new THREE.Vector3(),
  from: new THREE.Vector3(),
};
const v = new THREE.Vector3(),
  n = new THREE.Vector3(),
  w = new THREE.Vector3(),
  q = new THREE.Quaternion();
const inGame = () => !!game.kind;
const pingPong = (x) => {
  const k = x % 2;
  return k < 1 ? k : 2 - k;
};

// ----- shared
function begin(kind) {
  Object.assign(game, { kind, fov: camera.fov, held: new Set(), msg: "" });
  keys.clear();
  player.aim = null;
  document.body.classList.add("gaming");
  $(`${kind}Card`).hidden = false;
}
function endGame() {
  const p = player.person,
    kind = game.kind;
  if (!kind) return;
  game.kind = null;
  camera.fov = game.fov;
  camera.updateProjectionMatrix();
  document.body.classList.remove("gaming");
  $("dartsCard").hidden = $("golfCard").hidden = $("ps5Card").hidden = true;
  for (const s of interactables.of(kind))
    if (s.occupant === p) s.occupant = null;
  if (kind === "darts") {
    game.ring.visible = false;
    if (p?.task?.kind === "darts") p.task = null;
  } else if (kind === "ps5") {
    stopHumanFight();
    if (game.rival) letGo();
  } else {
    game.line.visible = false;
    resetPutt();
    if (p) {
      p.body.putter.visible = false;
      p.task = null;
    }
  }
  if (p) p.body.root.visible = ctl.mode !== "fp"; // first person hides you; third person shows you
}

// ----- darts
function startDarts() {
  const p = player.person,
    [a, b] = interactables.of("darts"),
    board = MY_DARTS.board;
  begin("darts");
  for (const s of [a, b]) if (!s.occupant) s.occupant = p; // nobody else comes to throw meanwhile
  p.pos.set((a.pos.x + b.pos.x) / 2, 0, (a.pos.z + b.pos.z) / 2); // on the throw line, in front of the board
  game.eye.set(p.pos.x, eyeHeight(p.body), p.pos.z);
  board.getWorldPosition(v);
  game.base.yaw = Math.atan2(v.x - p.pos.x, v.z - p.pos.z);
  game.base.pitch = Math.atan2(
    v.y - game.eye.y,
    Math.hypot(v.x - p.pos.x, v.z - p.pos.z),
  );
  p.face = p.faceGoal = game.base.yaw;
  ctl.yaw = game.base.yaw;
  ctl.pitch = game.base.pitch;
  camera.fov = 26;
  camera.updateProjectionMatrix(); // the board fills the view
  p.body.root.visible = ctl.mode === "tp"; // first person: from your own eyes; third person: over your shoulder
  p.task = { kind: "darts", anim: "dartAim", throwT: 9 };
  if (!game.ring) game.ring = makeRing();
  game.ring.visible = true;
  game.darts = MY_DARTS.thrown ? game.darts : [];
}
function makeRing() {
  const g = new THREE.Group(),
    m = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.022, 32), m),
    dot = new THREE.Mesh(new THREE.CircleGeometry(0.004, 12), m);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.022, 0.026, 32),
    new THREE.MeshBasicMaterial({
      color: 0x15191d,
      depthTest: false,
      transparent: true,
      opacity: 0.55,
    }),
  );
  for (const x of [halo, ring, dot]) {
    x.renderOrder = 20;
    g.add(x);
  }
  scene.add(g);
  return g;
}
// Where the aim is on the board's face this frame: the look angles (kept near the middle) plus a little sway.
function dartsAim(dt) {
  const board = MY_DARTS.board;
  game.t += dt;
  ctl.yaw =
    game.base.yaw +
    Math.max(-AIM, Math.min(AIM, angDiff(game.base.yaw, ctl.yaw)));
  ctl.pitch =
    game.base.pitch +
    Math.max(-AIM, Math.min(AIM, ctl.pitch - game.base.pitch));
  board.getWorldPosition(v);
  board.getWorldQuaternion(q);
  n.set(0, 0, 1).applyQuaternion(q);
  const cp = Math.cos(ctl.pitch);
  w.set(Math.sin(ctl.yaw) * cp, Math.sin(ctl.pitch), Math.cos(ctl.yaw) * cp); // where you look
  const t =
    (n.x * (v.x - game.eye.x) +
      n.y * (v.y - game.eye.y) +
      n.z * (v.z - game.eye.z)) /
    w.dot(n);
  game.aim.copy(game.eye).addScaledVector(w, t);
  game.aim.y += Math.sin(game.t * 1.7) * SWAY;
  const side = Math.cos(game.t * 1.3) * SWAY;
  game.aim.x -= n.z * side;
  game.aim.z += n.x * side;
  game.ring.position.copy(game.aim).addScaledVector(n, 0.01);
  game.ring.quaternion.copy(q);
  // the camera: your eyes on the board's middle; in third person over your right shoulder, you in the picture
  if (ctl.mode === "tp") {
    const a = game.base.yaw,
      fx = Math.sin(a),
      fz = Math.cos(a);
    camera.position.set(
      game.eye.x - fx * 1.8 - fz * 0.75,
      game.eye.y + 0.4,
      game.eye.z - fz * 1.8 + fx * 0.75,
    );
    player.person.body.root.visible = true;
  } else camera.position.copy(game.eye);
  camera.lookAt(v);
  player.person.task.throwT += dt;
}
function throwNow() {
  if (MY_DARTS.flying) return;
  if (MY_DARTS.thrown === 3) {
    game.best = Math.max(game.best, MY_DARTS.total);
    game.round++;
    game.darts = [];
    throwDart(game.eye, game.eye);
    return;
  } // collect them
  const a = game.base.yaw; // from your right hand, a little in front
  const from = new THREE.Vector3(
    game.eye.x + Math.sin(a) * 0.3 - Math.cos(a) * 0.14,
    game.eye.y - 0.12,
    game.eye.z + Math.cos(a) * 0.3 + Math.sin(a) * 0.14,
  );
  const to = game.aim.clone(),
    jit = () => (Math.random() - 0.5) * 0.02,
    side = jit(); // never quite where you aimed
  to.y += jit();
  to.x -= n.z * side;
  to.z += n.x * side;
  game.darts.push(throwDart(from, to));
  player.person.task.throwT = 0;
}
function renderDarts() {
  const slots = $("dartsSlots").children;
  for (let i = 0; i < 3; i++) {
    const d = game.darts[i],
      li = slots[i],
      text = d ? `${d.label}|${d.points}` : "";
    if (
      li.dataset.v === text &&
      li.classList.contains("next") === (i === game.darts.length)
    )
      continue;
    li.dataset.v = text;
    li.classList.toggle("next", i === game.darts.length);
    li.classList.toggle("miss", !!d && !d.points);
    li.firstChild.textContent = d ? (d.points ? d.label : "Miss") : "—";
    li.lastChild.textContent =
      d && d.label !== String(d.points) && d.points ? String(d.points) : ""; // T20 · 60, but just 5
  }
  $("dartsRound").textContent = `Darts · round ${game.round}`;
  $("dartsTotal").textContent = String(MY_DARTS.total);
  $("dartsBest").textContent = game.best ? `best ${game.best}` : "best —";
  keyHintsOnce("dartsKeys", MY_DARTS.thrown === 3 ? "collect" : "throw");
}
let hintsFor = "";
function keyHintsOnce(id, what) {
  if (hintsFor === id + what) return;
  hintsFor = id + what;
  keyHints(
    $(id),
    id === "dartsKeys"
      ? [
          ["Mouse", "aim"],
          ["Space", what],
        ]
      : [
          ["Mouse A D", "aim"],
          ["Space", what],
        ],
  ); // (Esc: the Leave button)
}

// ----- golf
function startGolf() {
  const p = player.person;
  begin("golf");
  interactables.of("golf")[0].occupant = p; // the strip is yours: nobody else starts putting
  if (!game.line) {
    // the aim line: a thin strip on the green from the ball along +z, stretched to the putt's length
    game.line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.025, 1)
        .rotateX(-Math.PI / 2)
        .translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    game.line.renderOrder = 5;
    scene.add(game.line);
  }
  p.body.putter.visible = true;
  p.task = { kind: "golf", anim: "putter", swing: 9 };
  Object.assign(game, { charging: false, power: 0, rolling: false });
  stance(true);
}
// Stand beside the ball, the line to the hole on your left (a right-handed putt), and look down the line.
function stance(snap) {
  const p = player.person,
    b = golfBall().position;
  game.dir = Math.atan2(GOLF_HOLE.x - b.x, GOLF_HOLE.z - b.z);
  ctl.yaw = game.dir;
  ctl.pitch = 0;
  if (snap) {
    game.cam.set(
      b.x - Math.sin(game.dir) * 2,
      1.15,
      b.z - Math.cos(game.dir) * 2,
    );
    game.look.copy(b);
  }
  placeGolfer(p, b);
}
function placeGolfer(p, b) {
  const f = game.dir - Math.PI / 2; // facing across the line
  p.pos.set(b.x - Math.sin(f) * 0.42, 0, b.z - Math.cos(f) * 0.42);
  p.face = p.faceGoal = f;
}
function golfFrame(dt) {
  const p = player.person,
    b = golfBall().position,
    k = 1 - Math.exp(-dt * 4);
  const rolling = Math.hypot(PUTT.vel.x, PUTT.vel.z) > 0.01 || PUTT.resetIn > 0;
  if (game.rolling && !rolling) stance(false); // it stopped (or went in and came back to the tee): walk up to it
  game.rolling = rolling;
  if (!rolling) {
    for (const [code, s] of [
      ["KeyA", 1],
      ["ArrowLeft", 1],
      ["KeyD", -1],
      ["ArrowRight", -1],
    ])
      if (game.held.has(code)) ctl.yaw += s * 1.2 * dt;
    game.dir = ctl.yaw;
    placeGolfer(p, b);
  }
  p.face = p.faceGoal = game.dir - Math.PI / 2; // (first and third person set it from the look; the golfer keeps their stance)
  if (game.charging) {
    game.chargeT += dt;
    game.power = pingPong(game.chargeT / 1.1);
  }
  p.task.swing += dt;
  // the aim line: as long as the putt would roll
  game.line.visible = !rolling;
  if (!rolling) {
    game.line.position.set(b.x, 0.03, b.z);
    game.line.rotation.y = game.dir;
    game.line.scale.set(
      1,
      1,
      game.charging ? 0.3 + game.power * PUTT_MAX : 1.2,
    );
    game.line.material.opacity = game.charging ? 0.9 : 0.45;
  }
  // the camera: behind the ball down the line, on the side away from you; while it rolls it stays back there,
  // a little higher, and watches the ball
  const d = game.dir,
    from = rolling ? game.from : b,
    sd = Math.sin(d),
    cd = Math.cos(d);
  v.set(
    from.x - sd * (rolling ? 1.5 : 2) - cd * 0.3,
    rolling ? 2.1 : 1.2,
    from.z - cd * (rolling ? 1.5 : 2) + sd * 0.3,
  );
  game.cam.lerp(v, k);
  game.look.lerp(
    rolling
      ? v.set(b.x, 0.05, b.z)
      : v.set(b.x + sd * 1.4, 0.1, b.z + cd * 1.4),
    k,
  );
  camera.position.copy(game.cam);
  camera.lookAt(game.look);
  p.body.root.visible = true;
  game.msg =
    PUTT.result ||
    (rolling
      ? ""
      : game.charging
        ? "Let go to putt"
        : "Hold Space to build power");
}
function startCharge() {
  if (game.kind !== "golf" || game.rolling || game.charging) return;
  Object.assign(game, { charging: true, chargeT: 0, power: 0 });
}
function release() {
  if (game.kind !== "golf" || !game.charging) return;
  game.charging = false;
  const b = golfBall().position,
    d = 0.3 + game.power * PUTT_MAX;
  game.from.copy(b);
  putt(
    new THREE.Vector3(
      b.x + Math.sin(game.dir) * d,
      0.05,
      b.z + Math.cos(game.dir) * d,
    ),
  );
  player.person.task.swing = 0;
  game.rolling = true;
}
function renderGolf() {
  $("golfStroke").textContent = String(PUTT.strokes + (game.rolling ? 0 : 1));
  $("golfFill").style.width = `${(game.power * 100).toFixed(1)}%`;
  $("golfNote").textContent = game.msg;
  keyHintsOnce("golfKeys", "hold to putt");
}

// ----- the PS5
const PAD = {
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyS: "block",
  ArrowDown: "block",
};
const MOVES = { KeyJ: "punch", KeyK: "kick", KeyL: "uppercut" };
const TV = { w: 1.89, h: 1.06, y: 1.48 }; // metres: the lounge TV's screen (world/furniture/tv.js) and the height of its middle
const BUSY = [
  "has a deadline",
  "is on a call soon",
  "says they only play darts",
  "is in the middle of a bug",
];
const firstName = (q) => q.name.split(" ")[0];
function startConsole() {
  begin("ps5");
  startHumanFight();
  Object.assign(game, {
    rival: null,
    coming: false,
    asking: false,
    matches: fightState.matches,
    msg: "You against the CPU",
  });
  camera.fov = 45;
  camera.updateProjectionMatrix();
  keyHints($("ps5Keys"), [
    ["A D", "move"],
    ["S", "block"],
    ["J", "punch"],
    ["K", "kick"],
    ["L", "uppercut"],
  ]);
  fillRivals();
}
// Who you can invite: anyone in the office who is free (not in a meeting, a fight or on the way out).
function fillRivals() {
  const me = player.person,
    list = people
      .filter(
        (q) =>
          q !== me &&
          q.state !== "away" &&
          !q.toiletUntil &&
          !q.meeting &&
          !inSlap(q) &&
          q.task?.kind !== "exit",
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  $("ps5Who").replaceChildren(
    ...list.map((q) => new Option(q.name, String(people.indexOf(q)))),
  );
}
function invite() {
  const r = people[+$("ps5Who").value];
  if (!r || game.asking || game.rival) return;
  game.asking = true;
  game.msg = `Waiting for ${firstName(r)} to answer…`;
  setTimeout(() => {
    game.asking = false;
    if (game.kind !== "ps5") return;
    const why =
      r.state === "away"
        ? "is not in the office"
        : r.meeting
          ? "is in a meeting"
          : inSlap(r)
            ? "is in a Power Slap"
            : !r.hazel && Math.random() < 0.25
              ? pick(BUSY)
              : null; // Hazel always plays
    if (why) {
      game.msg = `${firstName(r)} said no: ${why}`;
      return;
    }
    const seat = interactables.of("lounge").find((s) => s.game && !s.occupant);
    if (!seat) {
      game.msg = "Both controllers are taken";
      return;
    }
    const task = {
      kind: "game",
      cat: "break",
      anim: "game",
      spot: seat,
      until: Infinity,
      onStart: (r) => {
        r.body.pad.visible = true;
      },
      onEnd: (r) => {
        r.body.pad.visible = false;
      },
    };
    if (!goDo(r, task)) placeNow(r, task);
    Object.assign(game, {
      rival: r,
      coming: true,
      msg: `${firstName(r)} is coming over`,
    });
  }, 1200);
}
// Your opponent gets up and goes back to what they were doing.
function letGo() {
  const r = game.rival;
  game.rival = null;
  if (r?.task?.kind === "game" && r.until === Infinity) r.until = sim.t;
}
function consoleFrame() {
  const p = player.person,
    F = fightState,
    r = game.rival;
  // the view: straight in front of the screen, just far enough back that all of it fits above the card
  const half = Math.tan((camera.fov * Math.PI) / 360),
    back = Math.max(
      (TV.h * 0.75) / half,
      (TV.w * 0.62) / (half * camera.aspect),
    );
  loungeTV.getWorldQuaternion(q);
  w.set(0, 0, 1).applyQuaternion(q); // the way the screen faces
  camera.position.set(
    LOUNGE_TV_POS.x + w.x * back,
    TV.y,
    LOUNGE_TV_POS.z + w.z * back,
  );
  camera.lookAt(v.set(LOUNGE_TV_POS.x, TV.y - 0.22, LOUNGE_TV_POS.z));
  p.body.root.visible = false;
  if (r && r.task?.kind !== "game") {
    game.rival = null;
    game.msg = `${firstName(r)} had to go`;
  } // called away
  else if (r && game.coming && r.state === "doing") {
    game.coming = false;
    startHumanFight();
    game.matches = F.matches;
    game.msg = `You against ${firstName(r)}`;
  }
  if (F.matches !== game.matches) {
    // a best-of-three is over
    game.matches = F.matches;
    const them = r ? firstName(r) : "The CPU";
    game.msg =
      F.champ === 0
        ? `You beat ${r ? them : "the CPU"}!`
        : `${them} won the match`;
    if (r) {
      letGo();
      game.msg += " · good game";
    }
  }
}
function renderConsole() {
  const F = fightState,
    r = game.rival;
  $("ps5Rival").textContent = r ? firstName(r) : "CPU";
  $("ps5Score").textContent = `${F.wins[0]} – ${F.wins[1]}`;
  $("ps5Note").textContent = game.msg;
  $("ps5Invite").disabled = !!r || game.asking;
  $("ps5Ask").hidden = !!r;
}

// ----- input: the keys and the mouse button are the game's while you play
function onKey(e) {
  if (
    !game.kind ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey
  )
    return;
  const down = e.type === "keydown";
  if (e.key === "Escape") {
    e.stopPropagation();
    if (down) {
      if (game.kind === "ps5") getUp();
      else endGame();
    }
    return;
  }
  if (e.key.length !== 1 && !e.key.startsWith("Arrow")) return; // Shift, Tab, F-keys...
  e.preventDefault();
  e.stopPropagation();
  if (down) game.held.add(e.code);
  else game.held.delete(e.code);
  if (game.kind === "ps5") {
    const I = fightState.input;
    if (e.code in PAD) I[PAD[e.code]] = down;
    else if (down && !e.repeat && e.code in MOVES) I.attack = MOVES[e.code];
    return;
  }
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "KeyE") {
    if (game.kind === "darts") {
      if (down) throwNow();
    } else if (down) startCharge();
    else release();
  }
  if (game.kind === "darts" && down && e.code.startsWith("Arrow")) {
    const s = 0.02;
    if (e.code === "ArrowLeft") ctl.yaw += s;
    if (e.code === "ArrowRight") ctl.yaw -= s;
    if (e.code === "ArrowUp") ctl.pitch += s;
    if (e.code === "ArrowDown") ctl.pitch -= s;
  }
}
// A click throws or putts once the mouse is locked to the view; a first click just locks it.
function onPointer(e) {
  if (
    !game.kind ||
    document.pointerLockElement !== renderer.domElement ||
    e.button !== 0
  )
    return;
  e.stopImmediatePropagation();
  if (e.type === "pointerdown") {
    if (game.kind === "darts") throwNow();
    else startCharge();
  } else release();
}

// Per frame, after the walking camera: the game's own view and card.
function updateGames(dt) {
  const seat = ctl.active ? player.sitting : null;
  if (seat?.game && !game.kind) startConsole(); // you sat down at the PS5
  if (!game.kind) return;
  const p = player.person;
  if (
    !ctl.active ||
    !p ||
    p.state !== "controlled" ||
    (game.kind === "ps5" && !seat?.game)
  ) {
    endGame();
    return;
  } // stopped walking around, got up, or a fight came up
  if (game.kind === "darts") {
    dartsAim(dt);
    renderDarts();
  } else if (game.kind === "golf") {
    golfFrame(dt);
    renderGolf();
  } else {
    consoleFrame();
    renderConsole();
  }
}
function getUp() {
  const p = player.person;
  if (player.sitting && p) {
    standUp(p);
    updatePrompts();
  }
  endGame();
}

function initGames() {
  addEventListener("keydown", onKey, { capture: true });
  addEventListener("keyup", onKey, { capture: true });
  renderer.domElement.addEventListener("pointerdown", onPointer, {
    capture: true,
  });
  renderer.domElement.addEventListener("pointerup", onPointer, {
    capture: true,
  });
  addEventListener("blur", () => {
    game.held.clear();
    release();
  });
  $("dartsLeave").onclick = endGame;
  $("golfLeave").onclick = endGame;
  $("ps5Leave").onclick = getUp;
  $("ps5Invite").onclick = invite;
  $("ps5Who").addEventListener("pointerdown", fillRivals); // who is free right now
}

export { inGame, initGames, startDarts, startGolf, updateGames };
