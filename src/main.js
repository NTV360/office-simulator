import "./styles/base.css";
import "./styles/chat.css";
import "./styles/controls.css";
import "./styles/creator.css";
import "./styles/first-person.css";
import "./styles/games.css";
import "./styles/hud.css";
import "./styles/interact.css";
import "./styles/ledger.css";
import "./styles/person.css";
import "./styles/reset.css";
import "./styles/responsive.css";
import "./styles/search.css";
import "./styles/slap.css";
import "./styles/tokens.css";
import "./styles/ui-toggle.css";
import "./styles/veil.css";

import { bootstrap } from "./bootstrap.js";
import {
  following,
  setView,
  updateCamera,
  viewId,
} from "./camera/controller.js";
import { keyCam } from "./camera/input.js";
import { tp } from "./camera/modes/thirdPerson.js";
import { camGoal, camState } from "./camera/state.js";
import { toPx } from "./config/plan.js";
import { findPath } from "./nav/astar.js";
import { GC, GR, NAV, supportAt, walkPx, walkPxAt } from "./nav/grid.js";
import { updateBumps } from "./people/bump.js";
import { updateDizzy } from "./people/dizzy.js";
import { roster } from "./people/roster.js";
import { syncBody } from "./people/sync.js";
import { fetchAttendance, fetchEmployees } from "./persistence/store.js";
import { ctl } from "./player/control.js";
import { fire, selectGun, updateGuns } from "./player/guns.js";
import { stepPlayer, tickJump } from "./player/locomotion.js";
import { player } from "./player/player.js";
import { buildLabels, labelGroup, labelState } from "./render/labels.js";
import { updateLight } from "./render/lighting.js";
import { camera, renderer, scene } from "./render/renderer.js";
import { newDay } from "./sim/day.js";
import { applyAttendance, initLive, live, tickLive } from "./sim/live.js";
import { tickMeetings, tryMeeting } from "./sim/meetings.js";
import { DAY_END } from "./sim/schedule.js";
import { updateSlap } from "./sim/slap.js";
import { CLOCK, log, people, sim } from "./sim/state.js";
import { stepPerson, updateScreens } from "./sim/step.js";
import { updateGames } from "./ui/games.js";
import { updateInteract } from "./ui/interact.js";
import { renderUI } from "./ui/ledger.js";
import { selRing, select, selected } from "./ui/person.js";
import { updateSlapCard } from "./ui/slap.js";
import { ENTRY } from "./world/entrance.js";
import { awardsScreen } from "./world/furniture/awards.js";
import { onAir, updateChannels } from "./world/furniture/channels.js";
import { updateDarts } from "./world/furniture/darts.js";
import { updateDiningTv } from "./world/furniture/diningTv.js";
import {
  drawGame,
  gameCanvas,
  gameMat,
  loungeTV,
} from "./world/furniture/game.js";
import { updateGolf } from "./world/furniture/golf.js";
import { updateKitchen } from "./world/furniture/kitchen.js";
import { updateMusic } from "./world/furniture/music.js";
import { scalers, wall } from "./world/helpers.js";
import { interactables } from "./world/interactables.js";

/* ================= Main loop ================= */
let last = performance.now(),
  uiAcc = 0;
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!sim.paused) {
    if (live.mode === "live") {
      if (tickLive()) newDay();
    } // the real office clock
    else sim.t += dt * sim.speed * CLOCK;
    if (Math.floor(sim.t) !== sim.lastMinute) {
      sim.lastMinute = Math.floor(sim.t);
      tryMeeting();
    }
    tickMeetings();
    if (sim.t >= DAY_END) newDay();
    updateBumps(dt);
    for (const p of people) stepPerson(p, dt);
    const you = player.person?.id === -1 ? player.person : null; // (someone you took control of is in people)
    if (you && you.state !== "player") stepPerson(you, dt); // your character in a Power Slap
    updateSlap(dt);
    updateGuns(dt);
    updateScreens();
    updateLight();
  }
  for (const p of people) syncBody(p, dt);
  if (player.person?.id === -1) syncBody(player.person, dt);
  if (selected) {
    selRing.visible = selected.state !== "away";
    selRing.position.set(selected.pos.x, 0.02, selected.pos.z);
    const s = 1 + Math.sin(now / 260) * 0.06;
    selRing.scale.set(s, s, 1);
  }
  const showLabels = labelState.on && !ctl.active && camState.dist > 15;
  if (labelGroup.visible !== showLabels) labelGroup.visible = showLabels;
  if (Math.abs(wall.goal - wall.h) > 0.001) {
    wall.h += (wall.goal - wall.h) * (1 - Math.exp(-dt * 6));
    scalers.forEach((f) => f(wall.h));
  }
  keyCam(dt);
  updateCamera(dt);
  updateGolf(dt);
  updateDarts(now, dt);
  updateMusic(now);
  updateKitchen(dt);
  updateDizzy(dt);
  updateSlapCard();
  updateInteract(dt);
  updateGames(dt);
  // the lounge TV: the game while someone plays, the office awards otherwise (world/furniture/awards.js)
  {
    const gaming =
      people.some((q) => q.state === "doing" && q.task?.kind === "game") ||
      (ctl.active && player.sitting?.game);
    const m = gaming ? gameMat : awardsScreen();
    if (loungeTV.material !== m) loungeTV.material = m;
    if (gaming || onAir("game")) drawGame(dt);
  }
  updateDiningTv(
    dt,
    people.some(
      (q) =>
        q.state === "doing" &&
        (q.task?.kind === "tv" ||
          (q.task?.kind === "lunch" && q.task.spot?.kind === "dining")),
    ),
  );
  updateChannels(dt); // TVs someone changed the channel on (ui/interact.js)
  renderer.render(scene, camera);
  uiAcc += dt;
  if (uiAcc > 0.25) {
    uiAcc = 0;
    renderUI();
  }
  requestAnimationFrame(tick);
}
// Start once the staff list and attendance are in (or the API gave up): the people in the office are the
// real employees, and in live mode only those clocked in.
function start(employees, attendance) {
  roster.list = employees?.length ? employees : null;
  initLive(roster.list ? attendance : null); // starts simulating the day; attendance kept for Live
  bootstrap();
  // keep presence current: clock-ins walk in, clock-outs walk out
  if (live.attendance)
    setInterval(
      () =>
        fetchAttendance().then((a) => {
          if (a) applyAttendance(a.records);
        }),
      60000,
    );
  scalers.forEach((f) => f(wall.h));
  updateLight();
  setView("angle");
  camState.target.copy(camGoal.target);
  camState.dist = camGoal.dist * 1.25;
  camState.yaw = camGoal.yaw + 0.5;
  camState.pitch = camGoal.pitch;
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(
    buildLabels,
    buildLabels,
  );
  renderUI();
  requestAnimationFrame((t) => {
    last = t;
    tick(t);
  });
  window.__simReady = true;
  document.getElementById("veil").classList.add("gone");
  window.__sim = {
    sim,
    people,
    player,
    ctl,
    tp,
    wall,
    interactables,
    NAV,
    GC,
    GR,
    camGoal,
    camState,
    camera,
    updateCamera,
    viewId,
    following,
    select,
    setView,
    gameCanvas,
    drawGame,
    findPath,
    walkPx,
    walkPxAt,
    supportAt,
    stepPlayer,
    tickJump,
    fire,
    selectGun,
    toPx,
    ENTRY,
    advance(n, dt = 0.05) {
      for (let i = 0; i < n; i++) {
        sim.t += dt * sim.speed * CLOCK;
        if (Math.floor(sim.t) !== sim.lastMinute) {
          sim.lastMinute = Math.floor(sim.t);
          tryMeeting();
        }
        tickMeetings();
        if (sim.t >= DAY_END) newDay();
        updateBumps(dt);
        for (const p of people) stepPerson(p, dt);
        updateSlap(dt);
        updateGuns(dt);
      }
    },
    log,
  };
}
Promise.all([fetchEmployees(), fetchAttendance()]).then(
  ([employees, attendance]) => start(employees, attendance),
);
