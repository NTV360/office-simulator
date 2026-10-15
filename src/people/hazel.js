import { showFace } from '../character/rig.js';
import { normalizeSpec } from '../character/spec.js';
import { rnd } from '../core/util.js';
import { movieAt } from '../render/screens.js';
import { chickStep } from './chick.js';
import { hazelRide } from './hazelRide.js';

// Hazel Sellote: the one hand-written character. With the real staff list she is whoever has that name;
// without it she is the first person created (see makePerson). She is a smaller cube character with only her
// furious face (character/rig.js hazelize), runs everywhere (at walking speed), sits in a baby high chair at
// her own desk (HAZEL_DESK), watches movies there instead of working (hazelSlack), sometimes rides her cow
// tricycle, has a chick that follows her around (hazelExtras), and always leaves last. Her look can't be edited in the character lab.
const HAZEL_NAME = 'Hazel Sellote';
const HAZEL_LOCKED = "Sorry, you can't make Hazel taller than she is now.";

// Her look: a short blocky character (square head) with a bob, navy pants and a permanently furious face.
const HAZEL_LOOK = {
  type: 'blocky', name: 'Hazel', body: 'female', build: 'average', height: 'short', skin: '#d9a27a', eyes: { color: '#1d1411' },
  hair: { style: 'bob', color: '#2b201b' }, top: { style: 'tshirt', color: '#9b4d62' }, bottom: { style: 'pants', color: '#2f3d6b' }, // pants: they move with her legs when she runs
  shoes: { style: 'simple', color: '#2a2228' }, accessories: [], angry: true, special: 'hazel', // smaller, with only her angry face (character/rig.js hazelize)
};

// Hazel's identity for the first generated person: her name, role and look.
function applyHazel() {
  return { first: 'Hazel', last: 'Sellote', role: 'UX/UI Designer', spec: normalizeSpec(HAZEL_LOOK) };
}

// At her desk she mostly watches a movie, which makes her laugh, and every so often she alt-tabs back to work and
// checks over her shoulders, worried someone saw, before going back to it (or doing a bit of real work).
// `p.slack` holds the mode ('work', 'movie' or 'peek'), the seconds left in it, her face, which movie, and what her screen
// shows (null: her usual work screen; sim/step.js updateScreens). Poses: 'watch' and 'peek' in animation.js.
const PEEK = 2.4; // seconds to alt-tab and look around
function hazelSlack(p, dt) {
  const s = p.slack ??= { mode: 'work', t: 0, face: 'angry', ft: 0, screen: null, movie: Math.floor(Math.random() * 100) };
  const atDesk = p.state === 'doing' && p.task?.kind === 'work' && p.task.spot === p.seat && !p.chatWith;
  if (!atDesk) { s.mode = 'work'; s.t = rnd(2, 6); s.face = 'angry'; s.screen = null; showFace(p.body, 'angry'); return; }
  if ((s.t -= dt) <= 0) {
    if (s.mode === 'movie') { s.mode = 'peek'; s.t = PEEK; s.face = 'worried'; } // alt-tab and look around: did anyone see?
    else if (s.mode === 'work' || Math.random() < .65) { s.movie++; s.mode = 'movie'; s.t = rnd(12, 24); s.ft = rnd(1.5, 3); s.face = 'angry'; } // the next movie each time
    else { s.mode = 'work'; s.t = rnd(6, 14); s.face = 'angry'; }
  }
  if (s.mode === 'movie' && (s.ft -= dt) <= 0) { s.face = s.face === 'laugh' ? 'angry' : 'laugh'; s.ft = rnd(2.5, 5); }
  s.screen = s.mode === 'movie' ? movieAt(s.movie, p.animT) : null;
  showFace(p.body, s.face);
}

// Her tricycle (people/hazelRide.js) and her chick (people/chick.js). `dt` real seconds, `mdt` simulated.
function hazelExtras(p, dt, mdt) { hazelRide(p); chickStep(p, dt, mdt); }

export { HAZEL_LOCKED, HAZEL_NAME, applyHazel, hazelExtras, hazelSlack };
