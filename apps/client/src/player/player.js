import { buildBody } from '../character/rig.js';
import { DEFAULT_SPEC, normalizeSpec } from '../character/spec.js';
import { peopleGroup } from '../people/group.js';
import { ENTRY } from '../world/entrance.js';
import { N } from '../world/furniture/basics.js';

// The player's character. Same rig and animation as the NPCs, but it is not in the NPC list:
// no seat, no schedule, never picked by the simulation. It appears at the entrance the first
// time it is needed and then stays where it was left.
const player = { person: null, spec: normalizeSpec(DEFAULT_SPEC), sitting: null, moving: false };

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
function setPlayerSpec(raw) {
  player.spec = normalizeSpec(raw);
  const p = player.person; if (!p) return player.spec;
  const visible = p.body.root.visible;
  peopleGroup.remove(p.body.root);
  p.spec = player.spec; p.body = makeBody(player.spec); p.body.root.visible = visible;
  return player.spec;
}

export { player, setPlayerSpec, spawnPlayer };
