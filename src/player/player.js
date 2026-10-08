import { buildBody, disposeBody } from '../character/rig.js';
import { DEFAULT_SPEC, normalizeSpec, sameLook } from '../character/spec.js';
import { peopleGroup } from '../sim/state.js';
import { ENTRY } from '../world/entrance.js';
import { N } from '../world/furniture/basics.js';

// The player's character. Same rig and animation as the NPCs, but it is not in the NPC list:
// no seat, no schedule, never picked by the simulation. It appears at the entrance the first
// time it is needed and then stays where it was left.
const player = { person: null, spec: normalizeSpec(DEFAULT_SPEC), sitting: null, moving: false };
const STORE_KEY = 'officeSimPlayerSpec';
const HELD_PROPS = ['mug', 'phone', 'pad', 'putter', 'guitar']; // shown while sitting at things; kept across a rebuild

// Load the look saved by an earlier visit, if there is one.
function initPlayer() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) player.spec = normalizeSpec(JSON.parse(raw)); } catch (_) {}
}
function saveSpec() { try { localStorage.setItem(STORE_KEY, JSON.stringify(player.spec)); } catch (_) {} }

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

// Change how the player looks (character creation). Accepts any raw spec; invalid parts fall back.
// The new look is saved for the next visit. If only the height changed the body is resized, not rebuilt.
function setPlayerSpec(raw) {
  const prev = player.spec, next = normalizeSpec(raw);
  player.spec = next; saveSpec();
  const p = player.person; if (!p) return next;
  p.spec = next;
  if (sameLook(prev, next)) { p.body.root.scale.setScalar(next.scale); return next; }
  const old = p.body;
  peopleGroup.remove(old.root); disposeBody(old);
  p.body = makeBody(next); p.body.root.visible = old.root.visible;
  for (const k of HELD_PROPS) p.body[k].visible = old[k].visible;
  return next;
}

export { initPlayer, player, setPlayerSpec, spawnPlayer };
