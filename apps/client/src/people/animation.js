import { TAU, angDiff } from '@office/shared';
import { isLocalPlayer, player } from '../player/player.js';
import { LOUNGE_TV_POS } from '../world/furniture/game.js';

/* ================= Animation ================= */
const JOINTS = ['hipY', 'lean', 'lShX', 'lShZ', 'lEl', 'rShX', 'rShZ', 'rEl', 'lHip', 'lKnee', 'rHip', 'rKnee', 'headY', 'headX'];
function animKey(p) {
  if (isLocalPlayer(p)) return player.sitting ? (p.task?.anim || 'listenSit') : (player.moving ? 'walk' : 'stand');
  if (p.state === 'controlled') return p.task?.kind === 'playerSit' ? (p.task.anim || 'listenSit') : (p.moving ? 'walk' : 'stand'); // a human somewhere else (online)
  if (p.state === 'walking') return p.task?.run ? 'run' : 'walk';
  if (p.state !== 'doing' || !p.task) return 'stand';
  const t = p.task;
  if (t.kind === 'meeting') return t.meeting && t.meeting.speaker === p ? 'talkSit' : 'listen';
  if (t.kind === 'work' && p.chatWith) return 'listenSit';
  return t.anim;
}
// An emote a player is acting out: arms and head are overridden for a couple of seconds (see net/online.js, which sets `p.emote`). Walking
// ends it at once.
function emoteOverlay(p, o) {
  const em = p.emote;
  if (!em) return;
  const now = performance.now();
  const moving = isLocalPlayer(p) ? player.moving : !!p.moving;
  if (now > em.until || moving || p.state === 'away') { p.emote = null; return; }
  const e = (now - em.t0) / 1000;
  switch (em.kind) {
    case 'wave': o.rShX = -2.55; o.rShZ = -.3; o.rEl = -.5 + Math.sin(e * 11) * .55; o.headY = .25; break;
    case 'cheer':
      o.lShX = o.rShX = -2.75; o.lShZ = .35; o.rShZ = -.35; o.lEl = o.rEl = -.25 + Math.sin(e * 9) * .12; o.headX = -.25;
      if (!p.task) o.hipY = .88 + Math.abs(Math.sin(e * 7)) * .06; // a little jump (not when sitting)
      break;
    case 'clap': { const c = (Math.sin(e * 15) + 1) / 2; o.lShX = o.rShX = -1.05; o.lShZ = -.12 + c * .32; o.rShZ = .12 - c * .32; o.lEl = o.rEl = -1.35; o.headX = .05; break; }
    case 'nod': o.headX = .12 + Math.sin(e * 7) * .3; break;
  }
}

function targetPose(p, k, T) {
  const o = { hipY: .88, lean: 0, lShX: 0, lShZ: .07, lEl: -.12, rShX: 0, rShZ: -.07, rEl: -.12, lHip: 0, lKnee: 0, rHip: 0, rKnee: 0, headY: 0, headX: 0 };
  const breathe = Math.sin(T * 1.6) * .012;
  const sit = () => { o.hipY = p.task?.spot?.hipY ?? .53; const hi = o.hipY > .65; o.lHip = o.rHip = hi ? -1.2 : -1.5; o.lKnee = o.rKnee = hi ? .95 : 1.45; o.lShX = o.rShX = -.45; o.lEl = o.rEl = -.75; };
  switch (k) {
    case 'walk': {
      const s = Math.sin(p.walkPhase), c = Math.cos(p.walkPhase);
      o.lHip = -.5 * s; o.rHip = .5 * s;
      o.lKnee = .08 + .65 * Math.max(0, c); o.rKnee = .08 + .65 * Math.max(0, -c);
      o.lShX = .42 * s; o.rShX = -.42 * s; o.lEl = o.rEl = -.3;
      o.hipY = .87 + .022 * Math.abs(Math.cos(p.walkPhase)); o.lean = .05;
      break;
    }
    case 'run': {
      const s = Math.sin(p.walkPhase), c = Math.cos(p.walkPhase);
      o.lHip = -.85 * s; o.rHip = .85 * s;
      o.lKnee = .2 + 1.1 * Math.max(0, c); o.rKnee = .2 + 1.1 * Math.max(0, -c);
      o.lShX = .8 * s; o.lEl = -1.2; o.rShX = p.body.bucket.visible ? -.1 * s : -.8 * s; o.rEl = p.body.bucket.visible ? -.1 : -1.2; // the bucket hand stays down
      o.hipY = .86 + .05 * Math.abs(Math.cos(p.walkPhase)); o.lean = .22;
      break;
    }
    case 'type': sit(); o.lean = .12; o.lShX = -.6; o.rShX = -.6; o.lEl = -1.2 + Math.sin(T * 13) * .06; o.rEl = -1.2 + Math.sin(T * 13 + 2) * .06; o.lShZ = -.05; o.rShZ = .05; o.headX = .1 + Math.sin(T * .4) * .05; o.headY = Math.sin(T * .23) * .15; break;
    case 'eat': sit(); o.lean = .1; o.lShX = -.5; o.rShX = -.55 - Math.max(0, Math.sin(T * 1.3)) * .5; o.rEl = -1.3 - Math.max(0, Math.sin(T * 1.3)) * .8; o.lEl = -1.1; o.headX = .15; break;
    case 'listen': sit(); o.lean = -.03; o.lShX = o.rShX = -.5; o.lEl = o.rEl = -1.0; o.headX = Math.sin(T * 2.1) * .04; break;
    case 'listenSit': sit(); o.lean = -.02; o.lShX = o.rShX = -.5; o.lEl = o.rEl = -.9; break;
    case 'talkSit': sit(); o.lean = .08; o.lShX = -.5; o.lEl = -.9; o.rShX = -.75 + Math.sin(T * 3.1) * .25; o.rEl = -1.1 + Math.sin(T * 4.3) * .3; o.rShZ = -.2; o.headX = Math.sin(T * 5) * .05; break;
    case 'relax': sit(); o.lean = -.18; o.lShX = o.rShX = -.25; o.lEl = o.rEl = -.6; o.headY = Math.sin(T * .3) * .5; o.headX = -.05; break;
    case 'phone': sit(); o.lean = .02; o.rShX = -.45; o.rShZ = .55; o.rEl = -2.55; o.lShX = -.4 + Math.sin(T * 2.2) * .15; o.lEl = -1.0; o.headY = Math.sin(T * .5) * .3; o.headX = -.05 + Math.sin(T * 4) * .03; break;
    case 'piano': { sit(); o.lean = .1; o.lShX = -.75; o.rShX = -.75; o.lEl = -1.0 + Math.sin(T * 7) * .08; o.rEl = -1.0 + Math.sin(T * 8 + 1) * .08; o.lShZ = .05 + Math.sin(T * 1.3) * .18; o.rShZ = -.05 + Math.sin(T * 1.1 + 2) * .18; o.headX = .2; o.headY = Math.sin(T * .9) * .15; o.lean += Math.sin(T * 2) * .03; break; }
    case 'guitar': { sit(); o.lean = .06; o.lShX = -1.05; o.lShZ = .55; o.lEl = -1.2 + Math.sin(T * 3) * .05; o.rShX = -.35; o.rShZ = -.15; o.rEl = -1.35 + Math.sin(T * 12) * .2; o.headX = .25; o.headY = .35 + Math.sin(T * 2) * .08; break; }
    case 'darts': {
      const ph = (T + (p.task?.spot?.dartOff || 0)) % 6;
      o.lShX = -.3; o.lEl = -.6; o.headX = -.05; o.lean = .04;
      if (ph < .85) { o.rShX = -1.75; o.rEl = -1.85 + ph * .2; o.rShZ = -.1; }
      else if (ph < 1.15) { const q = (ph - .85) / .3; o.rShX = -1.75 + q * .3; o.rEl = -1.7 + q * 1.5; o.lean = .1; }
      else if (ph < 2.4) { o.rShX = -1.3; o.rEl = -.25; }
      else { o.rShX = -.2; o.rEl = -.5; o.headY = Math.sin(T) * .2; }
      break;
    }
    case 'putt': {
      const ph = (T + (p.task?.spot?.pos.z || 0)) % 8, sw = ph < 1.4 ? Math.sin(ph / 1.4 * TAU) * .28 : 0;
      o.lean = .32; o.lShX = -.42; o.rShX = -.42; o.lShZ = -.22 + sw; o.rShZ = .22 + sw; o.lEl = o.rEl = -.12;
      o.lHip = o.rHip = -.12; o.lKnee = o.rKnee = .22; o.hipY = .85;
      o.headX = .45; if (ph > 1.4 && ph < 4.5) { o.headY = .9; o.headX = .15; }
      if (ph > 4.3 && ph < 5.2) { o.rShX = -2.6; o.rEl = -.3; o.headX = -.1; }
      break;
    }
    case 'game': { sit(); o.lean = .06 + Math.sin(T * 1.3) * .04; o.lShX = -.85; o.rShX = -.85; o.lShZ = -.32; o.rShZ = .32; o.lEl = -1.05 + Math.sin(T * 9) * .04; o.rEl = -1.05 + Math.sin(T * 11 + 1) * .04; o.headX = .05; break; }
    case 'drinkSit': { sit(); o.lShX = -.5; o.lEl = -1.1; o.rShX = -.5; o.rEl = -1.4; if ((T % 7) < 1.3) { o.rEl = -2.35; o.rShX = -.6; o.headX = -.18; } o.headY = Math.sin(T * .35) * .5; break; }
    case 'drink': { o.rShX = -.45; o.rEl = -1.5; const sip = (T % 6) < 1.2; if (sip) { o.rEl = -2.35; o.rShX = -.55; o.headX = -.18; } o.lShZ = .12; o.headY = Math.sin(T * .4) * .4; break; }
    case 'sink': o.lean = .2; o.lShX = o.rShX = -.75; o.lEl = -.6 + Math.sin(T * 7) * .15; o.rEl = -.6 + Math.sin(T * 7 + 1.5) * .15; o.headX = .3; break;
    case 'locker': o.lShX = -1.1 + Math.sin(T * 2) * .2; o.lEl = -.4; o.rShX = -.6; o.rEl = -.5 + Math.sin(T * 3) * .2; o.headX = Math.sin(T) * .1; break;
    case 'present': o.rShX = -1.75 + Math.sin(T * 1.7) * .25; o.rShZ = -.25 + Math.sin(T * 2.3) * .2; o.rEl = -.35; o.lShX = Math.sin(T * 1.1) * .15; o.headY = Math.sin(T * .6) * .5; o.headX = -.08; break;
    case 'talkStand': o.rShX = -.55 + Math.sin(T * 2.7) * .3; o.rEl = -1.2 + Math.sin(T * 3.9) * .3; o.rShZ = -.15; o.lShX = Math.sin(T * 1.3) * .1; o.headX = Math.sin(T * 4.4) * .05; break;
    default: o.lShX = Math.sin(T * .9) * .05; o.rShX = -Math.sin(T * .9) * .05; break;
  }
  o.lean += breathe;
  emoteOverlay(p, o);
  // look at someone
  let look = null;
  if (p.task?.meeting && p.task.meeting.speaker && p.task.meeting.speaker !== p) look = p.task.meeting.speaker.pos;
  else if (k === 'listenSit' && p.chatWith) look = p.chatWith.pos;
  else if (k === 'talkSit' && p.task?.meeting) { const others = p.task.meeting.members.filter(q => q !== p); if (others.length) look = others[Math.floor(T / 2.5) % others.length].pos; }
  else if (k === 'talkStand' && p.task?.partner) look = p.task.partner.pos;
  else if ((k === 'game' || (k === 'relax' && p.task?.spot?.game)) && !isLocalPlayer(p)) look = LOUNGE_TV_POS;
  if (look) { const a = Math.atan2(look.x - p.pos.x, look.z - p.pos.z); o.headY = Math.max(-1.1, Math.min(1.1, angDiff(p.face, a))); }
  return o;
}
function applyPose(p, dt) {
  const k = animKey(p), o = targetPose(p, k, p.animT), c = p.pose, rate = 1 - Math.exp(-dt * (k === 'walk' || k === 'run' ? 22 : 9));
  for (const j of JOINTS) c[j] = c[j] === undefined ? o[j] : c[j] + (o[j] - c[j]) * rate;
  const b = p.body;
  b.hips.position.y = c.hipY; b.torso.rotation.x = c.lean;
  b.L.sh.rotation.set(c.lShX, 0, c.lShZ); b.L.el.rotation.x = c.lEl;
  b.R.sh.rotation.set(c.rShX, 0, c.rShZ); b.R.el.rotation.x = c.rEl;
  b.LL.hp.rotation.x = c.lHip; b.LL.kn.rotation.x = c.lKnee;
  b.RL.hp.rotation.x = c.rHip; b.RL.kn.rotation.x = c.rKnee;
  b.head.rotation.set(c.headX, c.headY, 0);
}

export { applyPose };
