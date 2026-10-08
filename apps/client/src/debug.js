import { drawCount } from '@office/shared';
import { GC, GR, NAV } from './nav/grid.js';
import { meetings } from './sim/meetings.js';
import { log, people, sim } from './sim/state.js';
import { interactables } from './world/interactables.js';

// A stable summary of the whole simulation, used to prove that a refactor changed nothing: record it
// under a fixed seed before the change, and require the same fingerprint after. Everything is rounded
// so tiny floating-point noise cannot cause false alarms. See docs/PHASE-1-BREAKDOWN.md (step 0).
const r3 = v => Math.round(v * 1000) / 1000;

// FNV-1a: a short, stable hash for comparing big blobs at a glance.
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function fingerprint() {
  const spotIndex = sp => {
    if (!sp) return '';
    const i = interactables.of(sp.kind).indexOf(sp);
    return `${sp.kind}:${i}`;
  };

  const persons = people.map(p => ({
    name: p.name, role: p.role, state: p.state,
    task: p.task ? p.task.kind : '', spot: p.task ? spotIndex(p.task.spot) : '',
    x: r3(p.pos.x), z: r3(p.pos.z), face: r3(p.face),
    until: r3(p.until), arriveAt: r3(p.arriveAt), leaveAt: r3(p.leaveAt), lunchAt: r3(p.lunchAt),
    arrivedAt: p.arrivedAt == null ? null : r3(p.arrivedAt),
    hadLunch: p.hadLunch, coffees: p.coffees,
    chatWith: p.chatWith ? p.chatWith.name : '', queue: p.queue.join(','), pathLeft: p.path ? p.path.length - p.pi : 0,
  }));

  const spots = interactables.kinds().map(kind => {
    const list = interactables.of(kind);
    return {
      kind, count: list.length,
      occupants: list.map(s => s.occupant ? s.occupant.name : '').join('|'),
      owners: list.map(s => s.owner ? s.owner.name : '').join('|'),
    };
  });

  const nav = { cols: GC, rows: GR, walkable: NAV.reduce((a, b) => a + b, 0) };
  let h = 0x811c9dc5;
  for (let i = 0; i < NAV.length; i++) { h ^= NAV[i]; h = Math.imul(h, 16777619); }
  nav.hash = (h >>> 0).toString(16).padStart(8, '0');

  const body = {
    clock: { t: r3(sim.t), day: sim.day },
    rngDraws: drawCount(),
    persons,
    spots,
    meetings: meetings.map(m => ({ room: m.room, start: r3(m.start), end: r3(m.end), members: m.members.map(p => p.name).join('|') })),
    nav,
    log: log.map(l => [r3(l.t), l.msg]),
  };
  return { hash: fnv(JSON.stringify(body)), ...body };
}

export { fingerprint };
