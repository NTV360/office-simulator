import { buildBody } from '../character/rig.js';
import { DEFAULT_SPEC, ENTRY, newProps, normalizeSpec, people } from '@office/shared';
import { peopleGroup } from '../people/group.js';
import { N } from '../world/furniture/basics.js';

// The player's character. A person like the NPCs (same rig, animation and list), but controller 'account':
// no desk, no schedule, never stepped or picked by the simulation, and not counted as staff. It appears at the entrance the first
// time it is needed and then stays where it was left.
//
// Online (see net/online.js) the player is not made here: it is the server's person for this account (`player.person` is set from the
// welcome message), `player.online` carries `input` and `act` to the server, and `sitting` and `moving` are read back from what the
// server says. `controlling` is true while a first or third person camera is steering it.
const player = { person: null, spec: normalizeSpec(DEFAULT_SPEC), sitting: null, moving: false, online: null, controlling: false };

/**
 * Is this person the one the user of THIS page is steering right now? (Other people a human drives are drawn like anyone else.)
 * Online, your own person is an ordinary person on the server's list until a first or third person camera is steering it.
 */
const isLocalPlayer = p => p === player.person && (!player.online || player.controlling);

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
    id: -1, name: 'You', role: 'You', spec: player.spec, body: makeBody(player.spec),
    pos: ENTRY.clone(), face: N, faceGoal: N, controller: 'account', state: 'controlled', shown: true, props: newProps(), task: null, chatWith: null,
    walkPhase: 0, animT: 0, pose: {},
  };
  player.person = p;
  people.push(p);
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

export { canPlay, isLocalPlayer, player, setPlayerSpec, spawnPlayer };
