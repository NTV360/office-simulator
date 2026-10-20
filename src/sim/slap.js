import { SLAP_LATE, SLAP_ROUNDS, SLAP_TIME, koChance } from '../config/slap.js';
import { pick, rnd, shuffle } from '../core/util.js';
import { recordKill } from '../player/guns.js';
import { addLog, people } from './state.js';
import { arrive, endTask, goDo, goExit, placeNow, putBucketBack } from './tasks.js';
import { ENTRY } from '../world/entrance.js';
import { interactables } from '../world/interactables.js';

/* ================= Power Slap ================= */
// Two people settle it face to face at the end of a dining table (the 'slap' spots, world/furniture/dining.js).
// They take turns, one slap each per round (config/slap.js). Whoever is being slapped keeps their hands behind
// their back; a hard slap knocks them down (KO), otherwise they see birds for a moment (people/dizzy.js). No KO
// after the last round: the one with the most slap power wins on points.
// Fights start from an argument over code at someone's desk or a whiteboard (slapArgue), from the user challenging
// someone (ui/slap.js: their own character fights), or between two people online (server/slap.js referees those
// and ui/slap.js passes its events to slapTurn, slapHit and slapEnd). The others are refereed here (updateSlap).
// A match: { id, online, names, fighters: [a, b] (null when they are not in this office), spots, phase ('gather',
// 'wind', 'after' or 'end'), t (seconds into the phase), turn (slaps so far), slapper (0 or 1), power (each one's
// slap power so far), last (the last slap's power), ko, winner (0, 1 or null for a draw), how ('ko', 'points' or
// 'draw'), mine (which fighter the user slaps for with the power meter, or null), waiting (for the meter), away
// (who came in just for it), reason (what an argument was about) }.
const slap = { matches: [] };
const CHANCE = { chat: .04, whiteboard: .08 }; // that an argument at a chat or a whiteboard ends in a fight
const GATHER = 45; // seconds to get to the table before they are put there
const REASONS = ['a bug', 'a merge conflict', 'whose code broke the build', 'tabs vs spaces', 'a code review comment', 'a flaky test', 'a hotfix on a Friday', 'a missing semicolon'];
let nextId = 1;

const firstName = p => p.id === -1 ? 'You' : p.name.split(' ')[0];
const inSlap = p => slap.matches.some(m => m.fighters?.includes(p));
// The standing spots in pairs, one pair per table.
function tables() { const s = interactables.of('slap'); return Array.from({ length: s.length / 2 }, (_, i) => [s[2 * i], s[2 * i + 1]]); }

// When someone's chat at a desk or whiteboard discussion is up (sim/step.js), it may have turned into an argument
// over code, settled with a Power Slap. One such fight at a time.
function slapArgue(p) {
  const t = p.task; if (p.state !== 'doing' || !t || !(t.kind in CHANCE) || Math.random() > CHANCE[t.kind]) return false;
  const rival = t.partner ?? people.find(q => q.task?.kind === 'whiteboard' && q.task.partner === p && q.state === 'doing');
  if (!rival || rival.state !== 'doing' || rival.meeting || inSlap(rival)) return false;
  if (slap.matches.some(m => m.reason)) return false;
  return !!startSlap(p, rival, { reason: pick(REASONS) });
}

// Start a fight between a and b at a free table, or at table `o.table` (online fights: the server picks it). For
// an online fight a and b may be null (not in this office): it is then only followed on the fight card.
// Returns the match, or null when no table is free.
function startSlap(a, b, o = {}) {
  const fighters = a && b ? [a, b] : null, all = tables();
  const spots = o.table != null ? all[o.table % all.length] : shuffle(all.filter(([x, y]) => !x.occupant && !y.occupant))[0];
  if (!spots) return null;
  // an online fight goes ahead whatever the office is doing: a fight at its table, or with either of them, stops
  if (fighters) for (const m of [...slap.matches]) if (m.spots[0] === spots[0] || m.fighters?.some(p => fighters.includes(p))) stopSlap(m);
  const m = {
    id: o.id ?? `office-${nextId++}`, online: !!o.online, names: o.names ?? [firstName(a), firstName(b)], fighters, spots,
    phase: 'gather', t: 0, turn: 0, slapper: o.first ?? (Math.random() < .5 ? 0 : 1), power: [0, 0], last: 0, ko: false,
    winner: null, how: null, mine: o.mine ?? null, waiting: false, away: [false, false], reason: o.reason ?? null,
  };
  fighters?.forEach((p, i) => {
    if (p.state === 'away') { comeIn(p); m.away[i] = true; }
    p.speed ??= 1.3; // the player's character has no walking speed of its own
    const task = { kind: 'slap', cat: 'break', anim: 'slapReady', spot: spots[i], until: Infinity, run: true, partner: fighters[1 - i], slap: m };
    if (!goDo(p, task)) placeNow(p, task);
  });
  slap.matches.push(m);
  addLog(o.reason ? `${m.names[0]} and ${m.names[1]} are fighting over ${o.reason}: Power Slap!` : `${m.names[0]} challenged ${m.names[1]} to a Power Slap`);
  return m;
}
// Someone who is not in (today, in this office) comes in through the front door for an online fight.
function comeIn(p) {
  if (p.toiletUntil) { p.toiletUntil = null; putBucketBack(p); }
  p.pos.copy(ENTRY); p.face = p.faceGoal = Math.PI; p.state = 'idle'; p.body.root.visible = p.body.ring.visible = true;
}

// Whose turn it is to slap. Anyone still on the way to the table is put there.
function slapTurn(m, side) {
  Object.assign(m, { phase: 'wind', t: 0, slapper: side, waiting: m.mine === side });
  m.fighters?.forEach(p => { if (p.state === 'walking') arrive(p); });
}
function slapHit(m, power, ko) {
  m.power[m.slapper] += power;
  Object.assign(m, { phase: 'after', t: 0, turn: m.turn + 1, last: power, ko, waiting: false });
}
function slapEnd(m, winner, how) {
  Object.assign(m, { phase: 'end', t: 0, winner, how, waiting: false });
  if (how === 'ko' && winner !== null && m.fighters?.[winner]) recordKill(m.fighters[winner]);
  const [w, l] = winner === null ? m.names : [m.names[winner], m.names[1 - winner]], them = l === 'You' ? 'you' : l;
  addLog(how === 'ko' ? `${w} knocked out ${them} in a Power Slap` : how === 'draw' ? `${w} and ${them} drew a Power Slap` : `${w} beat ${them} in a Power Slap on points`);
}
// The user takes over one side of a fight in the office (not an online one: real people slap for themselves)
// and slaps for them with the power meter; null hands it back.
function slapTakeOver(m, side) {
  if (m.online || m.phase === 'end') return;
  m.mine = side;
  m.waiting = side !== null && m.phase === 'wind' && m.slapper === side;
  if (m.waiting) m.t = 0;
}
// The user's slap, from the power meter. Online fights are refereed by the server: the caller sends it there.
function slapPower(m, power) {
  if (!m.waiting) return;
  m.waiting = false;
  if (!m.online) slapHit(m, power, Math.random() < koChance(power));
}

// The fight is over (or called off): back to what they were doing; anyone who came in just for it goes home.
function stopSlap(m) {
  slap.matches.splice(slap.matches.indexOf(m), 1);
  m.fighters?.forEach((p, i) => {
    p.dizzy = false;
    const ours = p.task?.slap === m;
    if (ours) { endTask(p); p.path = null; }
    // your own character, or whoever you control (player/player.js): yours again, whatever stopped the fight
    if (p.id === -1 || p.controlled) { if (p.state !== 'away' && (ours || p.state !== 'player')) { p.state = 'player'; p.task = null; p.path = null; } }
    else if (ours) { if (m.away[i]) goExit(p); else p.state = 'idle'; }
  });
}

// The office's own fights: get to the table, take turns, and after the last round the one with the most power wins.
function referee(m) {
  if (m.phase === 'gather') { if (m.fighters.every(p => p.state === 'doing') || m.t > GATHER) slapTurn(m, m.slapper); }
  else if (m.phase === 'wind') {
    if (m.waiting) { if (m.t > SLAP_TIME.think) slapPower(m, SLAP_LATE); }
    else if (m.t > SLAP_TIME.wind) { const power = m.fighters[m.slapper].hazel ? rnd(.7, 1) : rnd(.3, 1); slapHit(m, power, Math.random() < koChance(power)); } // Hazel is furious
  } else if (m.phase === 'after' && m.t > SLAP_TIME.after) {
    if (m.ko) slapEnd(m, m.slapper, 'ko');
    else if (m.turn >= SLAP_ROUNDS * 2) { const [a, b] = m.power; slapEnd(m, a > b ? 0 : b > a ? 1 : null, a === b ? 'draw' : 'points'); }
    else slapTurn(m, 1 - m.slapper);
  }
}
// Each fighter's pose for the moment (people/animation.js); `dizzy` puts the birds round their head.
function pose(m) {
  m.fighters.forEach((p, i) => {
    let a = 'slapReady';
    if (m.phase === 'wind') a = i === m.slapper ? 'slapWind' : 'slapBrace';
    else if (m.phase === 'after') a = i === m.slapper ? (m.t < .7 ? 'slapHit' : 'slapReady') : m.ko ? 'slapKO' : m.t < .5 ? 'slapTake' : 'slapDizzy';
    else if (m.phase === 'end') a = i === m.winner ? 'cheer' : m.how === 'ko' ? 'slapKO' : 'slapReady';
    if (p.state === 'doing') p.task.anim = a;
    p.dizzy = p.state === 'doing' && a === 'slapDizzy';
  });
}

// Per frame, in real seconds while the sim runs: referee the office's fights, pose the fighters, and stop a fight
// whose fighters were taken away (the day ended, the People slider removed them).
function updateSlap(dt) {
  for (let i = slap.matches.length - 1; i >= 0; i--) {
    const m = slap.matches[i]; m.t += dt;
    if (m.fighters?.some(p => p.task?.slap !== m || (p.id !== -1 && !people.includes(p)))) { stopSlap(m); continue; }
    if (m.phase === 'end' && m.t > SLAP_TIME.end) { stopSlap(m); continue; }
    if (!m.online) referee(m);
    if (m.fighters) pose(m);
  }
}

export { inSlap, slap, slapArgue, slapEnd, slapHit, slapPower, slapTakeOver, slapTurn, startSlap, stopSlap, updateSlap };
