import { pick, rnd, shuffle } from "../util";
import { HAZEL_NAME } from "./hazel";
import { interactables, type Spot } from "./interactables";
import { ENTRY } from "./spots";
import { addLog, people } from "./state";
import {
  arrive,
  endTask,
  goDo,
  goExit,
  placeNow,
  putBucketBack,
} from "./tasks";
import type { Person, SlapMatch } from "./types";

/* ================= Power Slap ================= */
// Two people settle it face to face at the end of a dining table (the 'slap' spots, world/furniture/dining.js).
// They take turns, one slap each per round (rules below). Whoever is being slapped keeps their hands behind
// their back; a hard slap knocks them down (KO), otherwise they see birds for a moment (people/dizzy.js). No KO
// after the last round: the one with the most slap power wins on points.
// Fights start from an argument over code at someone's desk or a whiteboard (slapArgue), from the user challenging
// someone (ui/slap.js: their own character fights), or between two people online (apps/server play/slap.ts referees
// those and ui/slap.js passes its events to slapTurn, slapHit and slapEnd). The others are refereed here (updateSlap).
// `on` is set by the client: office arguments and offline fights are a client-office thing, so the server never
// starts or referees them.
// Rules, shared with the server's online referee:
const SLAP_ROUNDS = 3; // one slap each per round
// Seconds: a slapper winds up (people), waits for the power meter (you), the hit and the reaction, the result.
// `gather` is how long the server gives online fighters to get to the table.
const SLAP_TIME = { wind: 1.3, think: 10, after: 2.4, end: 4, gather: 12 };
const SLAP_LATE = 0.2; // the power of a slap when the meter runs out
const SLAP_KO_FROM = 0.55; // slaps weaker than this never knock anyone down
// The chance that a slap of this power (0-1) knocks the other one down: none below SLAP_KO_FROM, one in two at full power.
const koChance = (power: number): number =>
  Math.max(0, power - SLAP_KO_FROM) * 1.1;

interface SlapOptions {
  table?: number;
  online?: boolean;
  id?: number | string;
  names?: [string, string];
  first?: 0 | 1;
  mine?: 0 | 1 | null;
  reason?: string;
}

const slap = {
  on: false,
  matches: [] as SlapMatch[],
  // The match a slap-table spot belongs to, while it is live.
  seat: (sp: object) =>
    slap.matches.find((m) => m.spots?.includes(sp as Spot)) ?? null,
};
const CHANCE: Record<string, number> = { chat: 0.04, whiteboard: 0.08 }; // that an argument at a chat or a whiteboard ends in a fight
const GATHER = 45; // seconds to get to the table before they are put there
const REASONS = [
  "a bug",
  "a merge conflict",
  "whose code broke the build",
  "tabs vs spaces",
  "a code review comment",
  "a flaky test",
  "a hotfix on a Friday",
  "a missing semicolon",
];
let nextId = 1;

const firstName = (p: Person): string =>
  p.id === -1 ? "You" : p.name.split(" ")[0];
const inSlap = (p: Person | null | undefined): boolean =>
  !!p && slap.matches.some((m) => m.fighters?.includes(p));
// The standing spots in pairs, one pair per table.
function tables(): [Spot, Spot][] {
  const s = interactables.of("slap") as Spot[];
  return Array.from(
    { length: s.length / 2 },
    (_, i) => [s[2 * i], s[2 * i + 1]] as [Spot, Spot],
  );
}

// When someone's chat at a desk or whiteboard discussion is up (sim/step.ts), it may have turned into an argument
// over code, settled with a Power Slap. One such fight at a time; the client turns `slap.on` (the server does not:
// its fights would be invisible to the pages watching it).
function slapArgue(p: Person): boolean {
  if (!slap.on) return false;
  const t = p.task;
  if (
    p.state !== "doing" ||
    !t ||
    !(t.kind in CHANCE) ||
    Math.random() > CHANCE[t.kind]
  )
    return false;
  const rival =
    t.partner ??
    people.find(
      (q) =>
        q.task?.kind === "whiteboard" &&
        q.task.partner === p &&
        q.state === "doing",
    );
  if (!rival || rival.state !== "doing" || rival.meeting || inSlap(rival))
    return false;
  if (slap.matches.some((m) => m.reason)) return false;
  return !!startSlap(p, rival, { reason: pick(REASONS) });
}

// Start a fight between a and b at a free table, or at table `o.table` (online fights: the server picks it). For
// an online fight a and b may be null (not in this office): it is then only followed on the fight card, and the
// fighters keep doing whatever they are doing (each one's own page drives them).
// Returns the match, or null when no table is free.
function startSlap(
  a: Person | null,
  b: Person | null,
  o: SlapOptions = {},
): SlapMatch | null {
  const fighters = a && b ? ([a, b] as [Person, Person]) : null,
    all = tables();
  const spots =
    o.table != null
      ? all[o.table % all.length]
      : shuffle(all.filter(([x, y]) => !x.occupant && !y.occupant))[0];
  if (!spots) return null;
  // an online fight goes ahead whatever the office is doing: a fight at its table, or with either of them, stops
  if (fighters)
    for (const m of [...slap.matches])
      if (
        m.spots[0] === spots[0] ||
        m.fighters?.some((p) => fighters.includes(p))
      )
        stopSlap(m);
  const m: SlapMatch = {
    id: o.id ?? `office-${nextId++}`,
    online: !!o.online,
    names: o.names ?? [firstName(a!), firstName(b!)],
    fighters,
    spots,
    phase: "gather",
    t: 0,
    turn: 0,
    slapper: o.first ?? (Math.random() < 0.5 ? 0 : 1),
    power: [0, 0],
    last: 0,
    ko: false,
    winner: null,
    how: null,
    mine: o.mine ?? null,
    waiting: false,
    away: [false, false],
    reason: o.reason ?? null,
  };
  if (!m.online)
    fighters?.forEach((p, i) => {
      if (p.state === "away") {
        comeIn(p);
        m.away[i] = true;
      }
      p.speed ??= 1.3; // the player's character has no walking speed of its own
      const task = {
        kind: "slap",
        cat: "break",
        anim: "slapReady",
        spot: spots[i],
        until: Infinity,
        run: true,
        partner: fighters[1 - i],
        slap: m,
      };
      if (!goDo(p, task)) placeNow(p, task);
    });
  slap.matches.push(m);
  addLog(
    o.reason
      ? `${m.names[0]} and ${m.names[1]} are fighting over ${o.reason}: Power Slap!`
      : `${m.names[0]} challenged ${m.names[1]} to a Power Slap`,
  );
  return m;
}
// Someone who is not in (today, in this office) comes in through the front door for a fight.
function comeIn(p: Person): void {
  if (p.toiletUntil) {
    p.toiletUntil = null;
    putBucketBack(p);
  }
  p.pos.x = ENTRY.x;
  p.pos.z = ENTRY.z;
  p.face = p.faceGoal = Math.PI;
  p.state = p.controller === "account" ? "controlled" : "idle";
  p.shown = true;
}

// Whose turn it is to slap. Anyone still on the way to the table is put there.
function slapTurn(m: SlapMatch, side: 0 | 1): void {
  Object.assign(m, {
    phase: "wind" as const,
    t: 0,
    slapper: side,
    waiting: m.mine === side,
  });
  m.fighters?.forEach((p) => {
    if (p.state === "walking") arrive(p);
  });
}
function slapHit(m: SlapMatch, power: number, ko: boolean): void {
  m.power[m.slapper] += power;
  Object.assign(m, {
    phase: "after" as const,
    t: 0,
    turn: m.turn + 1,
    last: power,
    ko,
    waiting: false,
  });
}
function slapEnd(
  m: SlapMatch,
  winner: 0 | 1 | null,
  how: "ko" | "points" | "draw",
): void {
  Object.assign(m, {
    phase: "end" as const,
    t: 0,
    winner,
    how,
    waiting: false,
  });
  const [w, l] =
      winner === null ? m.names : [m.names[winner], m.names[1 - winner]],
    them = l === "You" ? "you" : l;
  addLog(
    how === "ko"
      ? `${w} knocked out ${them} in a Power Slap`
      : how === "draw"
        ? `${w} and ${them} drew a Power Slap`
        : `${w} beat ${them} in a Power Slap on points`,
  );
}
// The user takes over one side of a fight in the office (not an online one: real people slap for themselves)
// and slaps for them with the power meter; null hands it back.
function slapTakeOver(m: SlapMatch, side: 0 | 1 | null): void {
  if (m.online || m.phase === "end") return;
  m.mine = side;
  m.waiting = side !== null && m.phase === "wind" && m.slapper === side;
  if (m.waiting) m.t = 0;
}
// The user's slap, from the power meter. Online fights are refereed by the server: the caller sends it there.
function slapPower(m: SlapMatch, power: number): void {
  if (!m.waiting) return;
  m.waiting = false;
  if (!m.online) slapHit(m, power, Math.random() < koChance(power));
}

// The fight is over (or called off): back to what they were doing; anyone who came in just for it goes home.
function stopSlap(m: SlapMatch): void {
  const at = slap.matches.indexOf(m);
  if (at >= 0) slap.matches.splice(at, 1);
  m.fighters?.forEach((p, i) => {
    p.dizzy = false;
    const ours = p.task?.slap === m;
    if (ours) {
      endTask(p);
      p.path = null;
    }
    // your own character, or whoever you control: yours again, whatever stopped the fight
    if (p.id === -1 || p.controller === "account") {
      if (p.state !== "away" && (ours || p.state !== "controlled")) {
        p.state = "controlled";
        p.task = null;
        p.path = null;
      }
    } else if (ours) {
      if (m.away[i]) goExit(p);
      else p.state = "idle";
    }
  });
}

// The office's own fights: get to the table, take turns, and after the last round the one with the most power wins.
function referee(m: SlapMatch): void {
  if (m.phase === "gather") {
    if (m.fighters!.every((p) => p.state === "doing") || m.t > GATHER)
      slapTurn(m, m.slapper);
  } else if (m.phase === "wind") {
    if (m.waiting) {
      if (m.t > SLAP_TIME.think) slapPower(m, SLAP_LATE);
    } else if (m.t > SLAP_TIME.wind) {
      const power =
        m.fighters![m.slapper].name === HAZEL_NAME ? rnd(0.7, 1) : rnd(0.3, 1);
      slapHit(m, power, Math.random() < koChance(power));
    } // Hazel is furious
  } else if (m.phase === "after" && m.t > SLAP_TIME.after) {
    if (m.ko) slapEnd(m, m.slapper, "ko");
    else if (m.turn >= SLAP_ROUNDS * 2) {
      const [a, b] = m.power;
      slapEnd(m, a > b ? 0 : b > a ? 1 : null, a === b ? "draw" : "points");
    } else slapTurn(m, (1 - m.slapper) as 0 | 1);
  }
}
// Each fighter's pose for the moment (people/animation.js); `dizzy` puts the birds round their head.
function pose(m: SlapMatch): void {
  m.fighters!.forEach((p, i) => {
    let a = "slapReady";
    if (m.phase === "wind") a = i === m.slapper ? "slapWind" : "slapBrace";
    else if (m.phase === "after")
      a =
        i === m.slapper
          ? m.t < 0.7
            ? "slapHit"
            : "slapReady"
          : m.ko
            ? "slapKO"
            : m.t < 0.5
              ? "slapTake"
              : "slapDizzy";
    else if (m.phase === "end")
      a = i === m.winner ? "cheer" : m.how === "ko" ? "slapKO" : "slapReady";
    if (p.state === "doing" && p.task) p.task.anim = a;
    p.dizzy = p.state === "doing" && a === "slapDizzy";
  });
}

// Per frame, in real seconds while the sim runs: referee the office's fights, pose the fighters, and stop a fight
// whose fighters were taken away (the day ended, the People slider removed them).
function updateSlap(dt: number): void {
  if (!slap.matches.length) return;
  for (let i = slap.matches.length - 1; i >= 0; i--) {
    const m = slap.matches[i];
    m.t += dt;
    if (
      !m.online &&
      m.fighters?.some(
        (p) => p.task?.slap !== m || (p.id !== -1 && !people.includes(p)),
      )
    ) {
      stopSlap(m);
      continue;
    }
    if (m.phase === "end" && m.t > SLAP_TIME.end) {
      stopSlap(m);
      continue;
    }
    if (!m.online) referee(m);
    if (m.fighters) pose(m);
  }
}

export {
  inSlap,
  koChance,
  slap,
  SLAP_KO_FROM,
  SLAP_LATE,
  SLAP_ROUNDS,
  SLAP_TIME,
  slapArgue,
  slapEnd,
  slapHit,
  slapPower,
  slapTakeOver,
  slapTurn,
  startSlap,
  stopSlap,
  updateSlap,
};
