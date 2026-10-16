import { HAZEL_NAME, vrnd as rnd } from '@office/shared';
import { showFace } from '../character/rig.js';
import { movieAt } from '../render/screens.js';
import { chickStep } from './chick.js';
import { hazelRide } from './hazelRide.js';

// Hazel Sellote's extras. They are all drawn on this page from her mirrored state (her name, where she is, what she is doing): the simulation
// knows nothing of them, so they cost nothing on the wire and every player sees the same Hazel. Her look is in people/views.js (`special: 'hazel'`),
// her desk and her busier day are in the simulation (packages/shared/src/sim/hazel.ts, tasks.ts).
//
// At her desk she mostly watches a movie, which makes her laugh, and every so often she alt-tabs back to work and checks over her shoulders,
// worried someone saw, before going back to it (or doing a bit of real work). `p.slack` holds the mode ('work', 'movie' or 'peek'), the seconds
// left in it, her face, which movie, and what her screen shows (null: her usual work screen; people/screens.js). Poses: 'watch' and 'peek' in
// people/animation.js.
const isHazel = p => p.name === HAZEL_NAME;
const PEEK = 2.4; // seconds to alt-tab and look around
function hazelSlack(p, dt) {
  const s = p.slack ??= { mode: 'work', t: 0, clock: 0, face: 'angry', ft: 0, screen: null, movie: Math.floor(Math.random() * 100) };
  s.clock += dt;
  const atDesk = p.state === 'doing' && p.task?.kind === 'work' && p.task.spot === p.slot && !p.chatWith;
  if (!atDesk) { s.mode = 'work'; s.t = rnd(2, 6); s.face = 'angry'; s.screen = null; showFace(p.body, 'angry'); return; }
  if ((s.t -= dt) <= 0) {
    if (s.mode === 'movie') { s.mode = 'peek'; s.t = PEEK; s.face = 'worried'; } // alt-tab and look around: did anyone see?
    else if (s.mode === 'work' || Math.random() < .65) { s.movie++; s.mode = 'movie'; s.t = rnd(12, 24); s.ft = rnd(1.5, 3); s.face = 'angry'; } // the next movie each time
    else { s.mode = 'work'; s.t = rnd(6, 14); s.face = 'angry'; }
  }
  if (s.mode === 'movie' && (s.ft -= dt) <= 0) { s.face = s.face === 'laugh' ? 'angry' : 'laugh'; s.ft = rnd(2.5, 5); }
  s.screen = s.mode === 'movie' ? movieAt(s.movie, s.clock) : null;
  showFace(p.body, s.face);
}

// Her tricycle (people/hazelRide.js) and her chick (people/chick.js), once a frame. `dt` real seconds, `mdt` simulated.
function hazelFrame(p, dt, mdt) {
  hazelRide(p); chickStep(p, dt, mdt);
  if (p.state !== 'away') hazelSlack(p, mdt);
}

export { hazelFrame, isHazel };
