import { buildBody, disposeBody } from '../character/rig.js';
import { DEFAULT_SPEC, normalizeSpec } from '../character/spec.js';
import { loadLocalSpec, saveLocalSpec } from '../persistence/store.js';
import { peopleGroup } from '../sim/state.js';
import { ENTRY } from '../world/entrance.js';
import { N } from '../world/furniture/basics.js';

// The player's character. Same rig and animation as the NPCs, but it is not in the NPC list:
// no seat, no schedule, never picked by the simulation. It appears at the entrance the first
// time it is needed and then stays where it was left. Its look is made in the character lab
// (ui/creator.js) and kept in this browser.
const player = { person: null, spec: normalizeSpec(DEFAULT_SPEC), sitting: null, moving: false };
const PROPS = ['mug', 'phone', 'pad', 'putter', 'guitar', 'bucket', 'rag', 'mop'];

function makeBody(spec) {
  const body = buildBody(spec);
  body.ring.visible = false; // the activity ring is for NPCs
  peopleGroup.add(body.root);
  return body;
}

function spawnPlayer() {
  if (player.person) return player.person;
  const p = {
    id: -1, name: 'You', role: 'You', spec: player.spec, body: makeBody(player.spec),
    pos: ENTRY.clone(), face: N, faceGoal: N, state: 'player', task: null, chatWith: null,
    walkPhase: 0, animT: 0, pose: {},
  };
  player.person = p;
  return p;
}

// Change how the player looks. Accepts any raw spec; invalid parts fall back. Returns the clean spec.
function setPlayerSpec(raw) {
  player.spec = normalizeSpec(raw);
  const p = player.person; if (!p) return player.spec;
  const old = p.body, body = makeBody(player.spec);
  body.root.visible = old.root.visible;
  for (const k of PROPS) body[k].visible = old[k].visible; // keep what an activity put in the hands
  peopleGroup.remove(old.root); disposeBody(old);
  p.spec = player.spec; p.body = body;
  return player.spec;
}

// Keep the look between visits, in this browser.
function savePlayerSpec() { saveLocalSpec(player.spec); }
function initPlayer() {
  const saved = loadLocalSpec();
  if (saved) player.spec = normalizeSpec(saved);
}

export { initPlayer, player, savePlayerSpec, setPlayerSpec, spawnPlayer };
