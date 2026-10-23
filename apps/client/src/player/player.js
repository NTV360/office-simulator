import {
  DEFAULT_SPEC,
  ENTRY,
  createInventory,
  defaultCharacterMechanics,
  handBack,
  newProps,
  normalizePlayerSpec,
  normalizeSpec,
  people,
  takeControl as simTakeControl,
  slap,
  slapTakeOver,
} from "@office/shared";
import { buildBody, disposeBody } from "../character/rig.js";
import { peopleGroup } from "../people/group.js";
import { loadLocalSpec, saveLocalSpec } from "../persistence/store.js";
import { N } from "../world/furniture/basics.js";

// The player's character. A person like the NPCs (same rig, animation and list), but controller 'account':
// no desk, no schedule, never stepped or picked by the simulation, and not counted as staff. It appears at the entrance the first
// time it is needed and then stays where it was left.
//
// Online (see net/online.js) the player is not made here: it is the server's person for this account (`player.person` is set from the
// welcome message), `player.online` carries `input` and `act` to the server, and `sitting` and `moving` are read back from what the
// server says. `controlling` is true while a first or third person camera is steering it.
const player = {
  person: null,
  own: null, // your own character while you walk as someone else (takeControl, offline)
  spec: normalizeSpec(DEFAULT_SPEC),
  sitting: null,
  moving: false,
  online: null,
  controlling: false,
  lookAt: null, // who is in the middle of the screen while walking around (player/prompts.js)
  aim: null, // a TV or whiteboard in reach there, that E uses (ui/interact.js)
  gun: 0,
}; // gun: which toy gun the number keys picked (player/guns.js); null for none

/**
 * Is this person the one the user of THIS page is steering right now? (Other people a human drives are drawn like anyone else.)
 * Online, your own person is an ordinary person on the server's list until a first or third person camera is steering it.
 */
const isLocalPlayer = (p) =>
  p === player.person && (!player.online || player.controlling);

/** Can a first or third person view start? Offline always; online only once the server has told us which person is ours. */
const canPlay = () => !player.online || !!player.person;

function makeBody(spec) {
  const body = buildBody(spec);
  body.ring.visible = false; // the activity ring is for NPCs
  peopleGroup.add(body.root);
  return body;
}

function spawnPlayer() {
  if (player.person || player.online) return player.person; // online: the server's person, or none yet

  const p = {
    id: -1,
    name: "You",
    role: "You",
    spec: player.spec,
    body: makeBody(player.spec),
    pos: ENTRY.clone(),
    face: N,
    faceGoal: N,
    controller: "account",
    state: "controlled",
    shown: true,
    props: newProps(),
    task: null,
    chatWith: null,
    walkPhase: 0,
    animT: 0,
    pose: {},
    mechanics: defaultCharacterMechanics(),
    inventory: createInventory(),
  };
  player.person = p;
  people.push(p);
  return p;
}

// Change how the player looks (character creation). Accepts any raw spec; invalid parts fall back.
function setPlayerSpec(raw) {
  player.spec = normalizePlayerSpec(raw);
  const p = player.person;
  if (!p) return player.spec;
  const visible = p.body.root.visible,
    old = p.body;
  peopleGroup.remove(old.root);
  disposeBody(old);
  p.spec = player.spec;
  p.body = makeBody(player.spec);
  p.body.root.visible = visible;
  return player.spec;
}

// Walk as someone in the office instead of as your own character (ui/person.js "Take control", offline only; or
// a side of a fight, ui/slap.js). The sim does the state surgery (shared sim/takeover.ts): whatever they were doing
// stops — a fight goes on, with you slapping for them.
function takeControl(p) {
  if (player.online || player.person === p) return;
  releaseControl();
  player.own = player.person;
  if (player.own) player.own.body.root.visible = false;
  if (p.task?.slap)
    for (const m of slap.matches) {
      const side = m.fighters?.indexOf(p) ?? -1;
      if (side >= 0) slapTakeOver(m, side);
    }
  else simTakeControl(p);
  player.person = p;
  player.sitting = null;
  player.moving = false;
}
// Let go of whoever you control (leaving first/third person): they get on with their day, and your own
// character is back where you left it.
function releaseControl() {
  const p = player.person;
  if (!p || p.id === -1) return;
  for (const m of slap.matches) {
    const side = m.fighters?.indexOf(p) ?? -1;
    if (side >= 0 && m.mine === side) slapTakeOver(m, null);
  }
  if (!p.task?.slap) handBack(p);
  player.person = player.own;
  player.own = null;
  if (player.person) player.person.body.root.visible = true;
}

// Keep the look between visits in this browser (the private office; online the look is the account's, on the server).
function savePlayerSpec() {
  saveLocalSpec(player.spec);
}
function initPlayer() {
  const saved = loadLocalSpec();
  if (saved) player.spec = normalizePlayerSpec(saved); // (a hand-edited store cannot give you Hazel's face)
}

export {
  canPlay,
  initPlayer,
  isLocalPlayer,
  player,
  releaseControl,
  savePlayerSpec,
  setPlayerSpec,
  spawnPlayer,
  takeControl,
};
