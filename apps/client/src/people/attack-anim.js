// How a punch or a kick looks, as a timeline the page plays itself (people/animation.js), so it does not depend on how often snapshots arrive.
// The server still decides everything that matters (when it was thrown, the reach, the damage); this only draws the swing.
//
//   charging   the arm (or leg) is drawn back, further the longer the button is held, and the body winds up
//   release    a fast strike (about 70 ms: the server's hit lands at the release)
//   hold       a moment at full stretch, then
//   recover    back to standing before the server lets the next attack start (its cooldown is 350 ms)

export const WIND_TIME = .1;       // seconds to draw back
export const STRIKE_TIME = .07;    // release -> fully stretched
export const HOLD_TIME = .06;      // stays stretched
export const RECOVER_TIME = .2;    // back to standing
export const ATTACK_TOTAL = STRIKE_TIME + HOLD_TIME + RECOVER_TIME;

/**
 * Follow a person's punch or kick for the animation (`p._atk`), from the attack the server reports (`attack`, or null) at time `now` (seconds).
 * A swing starts when the server reports a new sequence number, is drawn back while it charges, strikes at the release, and plays out its recovery
 * even after the server has cleared the attack (a quick tap is over on the server in 120 ms). A swing that has finished is never started again by
 * the same sequence number, which the server may go on reporting for a few more snapshots. Bashes are not drawn here.
 */
export function trackAttack(p, attack, now) {
  if (attack && attack.kind !== 'bash' && p._atkDone !== attack.sequence && (!p._atk || p._atk.seq !== attack.sequence)) {
    p._atk = { seq: attack.sequence, kind: attack.kind, side: attack.side, t0: now, rel: null, charge: 0 };
  }
  const t = p._atk;
  if (!t) return;
  if (attack && attack.sequence === t.seq) {
    if (attack.phase !== 'charging' && t.rel === null) { t.rel = now; t.charge = Number.isFinite(attack.charge) ? attack.charge : Math.min(1, (now - t.t0) / .9); }
  } else if (t.rel === null) { t.rel = now; t.charge = Math.min(1, (now - t.t0) / .9); }
  if (t.rel !== null && now - t.rel > ATTACK_TOTAL) { p._atkDone = t.seq; p._atk = null; }
}

const clamp01 = v => Math.max(0, Math.min(1, v));
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeInOut = t => t * t * (3 - 2 * t);

/**
 * Where the swing is: a number from -1 (fully drawn back) through 0 (standing) to 1 (fully stretched), or null when it has finished.
 * `held` is the seconds spent charging so far; `charge` is 0 to 1 (how hard); `sinceRelease` is seconds since the release, or null while charging.
 */
export function swing(held, charge, sinceRelease) {
  const cock = (.55 + .45 * clamp01(charge)) * easeOut(clamp01(held / WIND_TIME)); // a tap still draws back a little
  if (sinceRelease === null) return -cock;
  if (sinceRelease < STRIKE_TIME) return -cock + (1 + cock) * easeOut(clamp01(sinceRelease / STRIKE_TIME));
  const t = sinceRelease - STRIKE_TIME;
  if (t < HOLD_TIME) return 1;
  if (t < HOLD_TIME + RECOVER_TIME) return 1 - easeInOut((t - HOLD_TIME) / RECOVER_TIME);
  return null;
}

// What each swing adds to the standing pose at full draw-back (`cock`) and at full stretch (`hit`), in radians (people/animation.js JOINTS).
// `A` is the attacking side's joint, `O` the other side's. The values are written for a right-handed attack; `ShZ`, `twist` and `headY`
// are sideways angles, so they flip for a left-handed one. A shoulder angle of -1.5 is the arm straight out in front; a hip angle of
// -1.4 is the leg raised in front.
const POSES = {
  punch: {
    cock: { A_ShX: .85, A_El: -.7, O_ShX: -.75, O_El: -.7, O_ShZ: .1, twist: -.42, lean: -.04, headY: .25 },
    hit: { A_ShX: -1.58, A_El: -.1, O_ShX: -.2, O_El: -.35, twist: .38, lean: .14, headY: -.2, hipY: -.015 },
  },
  kick: {
    cock: { A_Hip: .5, A_ShX: -.35, O_ShX: -.35, A_ShZ: -.35, O_ShZ: .35, lean: -.04 },
    hit: { A_Hip: -1.4, O_Hip: .1, A_ShX: -.15, O_ShX: -.15, A_ShZ: -.75, O_ShZ: .75, lean: -.2, hipY: -.04 },
  },
};
const SIDEWAYS = /ShZ$|^twist$|^headY$/;

/** The change to add to a standing pose for this swing: { joint: amount }. `kind` is 'punch' or 'kick', `side` 'left' or 'right', `at` from `swing`. */
export function swingPose(kind, side, at) {
  const set = POSES[kind];
  if (!set || at === null) return {};
  const s = side === 'left' ? -1 : 1, mine = side === 'left' ? 'l' : 'r', other = side === 'left' ? 'r' : 'l';
  const out = {}, amount = Math.abs(at);
  for (const [key, value] of Object.entries(at < 0 ? set.cock : set.hit)) {
    const joint = key.startsWith('A_') ? mine + key.slice(2) : key.startsWith('O_') ? other + key.slice(2) : key;
    out[joint] = value * amount * (SIDEWAYS.test(key) ? s : 1);
  }
  return out;
}
