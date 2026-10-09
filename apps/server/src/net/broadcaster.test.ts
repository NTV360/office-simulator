import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLog, decode, live, resetLive, setMode, interactables, hasSlot, makeStaff, people, removeStaff, setSeed, simEvents, type Snapshot, type Welcome } from '@office/shared';
import { World, type WorldOptions } from '../world/world';
import { Broadcaster } from './broadcaster';

const options: WorldOptions = { tickRate: 20, slotCount: 40, speed: 1, paused: false, seed: 3 };
let world: World;
let bc: Broadcaster;

afterEach(() => resetLive());
beforeEach(() => {
  simEvents.clear();
  world = new World(options); world.init();
  bc = new Broadcaster({ tickRate: 20 });
});

const snapshot = (tick: number) => decode(bc.snapshot(tick)) as Snapshot;

describe('Broadcaster', () => {
  it('welcome lists everyone and does not disturb change tracking', () => {
    const w = decode(bc.welcome(0)) as Welcome;
    expect(w.people).toHaveLength(40);
    expect(w.people.every(p => p.info.slot >= 0 && interactables.all()[p.info.slot].kind === 'desk')).toBe(true);
    // a welcome must not make the next snapshot think nothing changed for the other clients
    const first = snapshot(2);
    expect(first.people).toHaveLength(40);
  });

  it('says in every welcome and snapshot whether the clock is Live or Simulate', () => {
    expect([(decode(bc.welcome(0)) as Welcome).live, snapshot(2).live]).toEqual([false, false]);
    setMode('live');
    expect(live.mode).toBe('live');
    expect([(decode(bc.welcome(0)) as Welcome).live, snapshot(4).live]).toEqual([true, true]);
  });

  it('sends only people who changed, staff on every second tick, and everyone on a keyframe', () => {
    snapshot(1); snapshot(2); // settle
    for (let i = 0; i < 200; i++) world.step();
    const odd = snapshot(3);
    expect(odd.people).toHaveLength(0); // staff are only due on even ticks
    const even = snapshot(4);
    expect(even.full).toBe(false);
    expect(even.people.length).toBeLessThan(40);
    const again = snapshot(6); // nothing moved between 4 and 6 only if the world did not step: it did not
    expect(again.people).toHaveLength(0);
    const key = snapshot(20); // 20 ticks per second: a keyframe
    expect(key.full).toBe(true);
    expect(key.people).toHaveLength(40);
  });

  it('a person who moves shows up again', () => {
    snapshot(2);
    const p = people.filter(hasSlot).find(q => q.state === 'doing')!;
    p.pos.x += 0.5;
    const s = snapshot(4);
    expect(s.people.some(x => x.id === p.id && Math.abs(x.x - p.pos.x) < 1e-4)).toBe(true);
  });

  it('a change in only the clocked-in or the toilet flag still shows up (they are not position or task changes)', () => {
    snapshot(2);
    const p = people.filter(hasSlot).find(q => q.state === 'doing')!;
    p.absent = true;
    expect(snapshot(4).people.find(x => x.id === p.id)?.absent).toBe(true);
    p.absent = false; p.toiletUntil = 700;
    expect(snapshot(6).people.find(x => x.id === p.id)?.toilet).toBe(true);
    p.toiletUntil = null;
    expect(snapshot(8).people.find(x => x.id === p.id)?.toilet).toBe(false);
  });

  it('announces people who join or leave', () => {
    const gone = removeStaff()!;
    const left = decode(bc.left(gone.id));
    expect(left).toEqual({ type: 'leave', id: gone.id });
    const added = makeStaff()!;
    const joined = decode(bc.joined(added));
    expect(joined).toMatchObject({ type: 'person', info: { id: added.id, name: added.name } });
    // a leave removes the person from change tracking, so a keyframe does not mention them
    removeStaff();
    expect(snapshot(20).people.every(p => p.id !== added.id)).toBe(true);
  });

  it('turns new log lines into events, oldest first, once', () => {
    expect(bc.events()).toHaveLength(0);
    addLog('first'); addLog('second');
    const ev = bc.events().map(b => decode(b));
    expect(ev.map(e => (e as { text: string }).text)).toEqual(['first', 'second']);
    expect(bc.events()).toHaveLength(0);
    addLog('third');
    expect(bc.events().map(b => (decode(b) as { text: string }).text)).toEqual(['third']);
  });

  it('does not replay the log from before it started', () => {
    addLog('old news');
    const fresh = new Broadcaster({ tickRate: 20 });
    expect(fresh.events()).toHaveLength(0);
  });

  it('measured bandwidth for one viewer over two simulated minutes stays inside the budget', () => {
    setSeed(1);
    let bytes = 0, n = 0;
    for (let t = 1; t <= 20 * 120; t++) { world.step(); bytes += bc.snapshot(t).length; n++; for (const e of bc.events()) bytes += e.length; }
    const perSecond = bytes / 120;
    console.log(`BANDWIDTH  ${(perSecond / 1024).toFixed(2)} KB/s per viewer for 40 staff (${(bytes / n).toFixed(0)} B per snapshot)`);
    expect(perSecond).toBeLessThan(40 * 1024);
    setSeed(null);
  });

  it('a person a human drives is sent every tick, the autopilot crowd every second tick', () => {
    snapshot(2);
    const driven = people.filter(hasSlot).find(q => q.state === 'doing')!;
    driven.controller = 'account'; driven.state = 'controlled';
    driven.pos.x += 0.3;
    const odd = snapshot(3);
    expect(odd.people.map(x => x.id)).toEqual([driven.id]);
    driven.pos.x += 0.3;
    expect(snapshot(5).people.map(x => x.id)).toEqual([driven.id]);
  });
});
