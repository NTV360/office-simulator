import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CARE_REACH, createInventory, initDay, initState, loadLayout, makeGuest, medkitContents, objects, officeLayout, placeItem, resetAllObjects, resetSim, roster, setSeed, simEvents,
  stepMedkits, type Employee, type Person,
} from '@office/shared';
import { advanceCare, finishCare, openMedkit, startCare, takeFromMedkitInto } from './medical-care';

// The medkit on the kitchen counter and timed care, as rules (the player manager and the sockets are tested elsewhere).

const staff: Employee[] = Array.from({ length: 40 }, (_, i) => ({ userId: `care-${i}`, firstName: `T${i}`, lastName: 'E', department: 'UI/UX', intern: false, shift: null, character: null, desk: null }));
beforeEach(() => { simEvents.clear(); setSeed(1); resetSim(); roster.list = staff; roster.status = 'ready'; loadLayout(officeLayout); initState(); initDay(); resetAllObjects(); });
afterEach(() => { setSeed(null); resetAllObjects(); roster.list = null; roster.status = 'unavailable'; });

const medkit = () => objects.all().find(o => o.type === 'medkit-box')!;
/** A guest standing at the open end of the counter, a step from the medkit. */
function atCounter(id = 1, name = 'a'): Person { const g = makeGuest(id, name); g.pos.x = 1.85; g.pos.z = 17.4; return g; }
const withItems = (p: Person, ...types: string[]) => { for (const [i, type] of types.entries()) p.inventory = placeItem(p.inventory, { id: `${type}-${i}`, type, x: i % 4, y: Math.floor(i / 4) * 2, rotation: 0 }); };

describe('the medkit', () => {
  it('is on the kitchen counter, fixed, and full to begin with', () => {
    const m = medkit();
    expect(m.x).toBeGreaterThan(.5); expect(m.z).toBeGreaterThan(17.1); expect(m.z).toBeLessThan(18.8);
    expect(medkitContents(m.index)).toEqual({ bandage: 10, 'first-aid-box': 5 });
  });

  it('opens for somebody standing near it, and shows what is in it', () => {
    expect(openMedkit(atCounter(), medkit().index)).toEqual({ ok: true, object: medkit().index, contents: { bandage: 10, 'first-aid-box': 5 } });
  });

  it('refuses from too far away, and for something that is not a medkit', () => {
    const far = atCounter(); far.pos.x = -6; far.pos.z = 0;
    expect(openMedkit(far, medkit().index)).toEqual({ ok: false, reason: 'too-far' });
    expect(openMedkit(atCounter(), objects.all().find(o => o.type === 'mug')!.index)).toEqual({ ok: false, reason: 'not-medkit' });
    expect(openMedkit(atCounter(), 99999)).toEqual({ ok: false, reason: 'not-medkit' });
  });

  it('gives a bandage (one cell) and a first-aid box (two cells) into the inventory, and has one less of each', () => {
    const p = atCounter();
    const a = takeFromMedkitInto(p, medkit().index, 'bandage');
    expect(a.ok).toBe(true);
    if (a.ok) { p.inventory = a.inventory; expect(a.contents.bandage).toBe(9); }
    const b = takeFromMedkitInto(p, medkit().index, 'first-aid-box');
    expect(b.ok).toBe(true);
    if (b.ok) { p.inventory = b.inventory; expect(b.contents['first-aid-box']).toBe(4); }
    expect(p.inventory.items.map(i => i.type).sort()).toEqual(['bandage', 'first-aid-box']);
    const cells = p.inventory.items.flatMap(i => i.type === 'bandage' ? [1] : [1, 1]).length;
    expect(cells).toBe(3);
  });

  it('refuses when it is empty, and takes nothing when the inventory is full', () => {
    const p = atCounter();
    for (let i = 0; i < 10; i++) { const r = takeFromMedkitInto(atCounter(2, 'b'), medkit().index, 'bandage'); expect(r.ok).toBe(true); }
    expect(takeFromMedkitInto(p, medkit().index, 'bandage')).toEqual({ ok: false, reason: 'empty' });
    stepMedkits(5); // one more bandage
    const full = atCounter(3, 'c');
    full.inventory = createInventory(Array.from({ length: 20 }, (_, i) => ({ id: `mug-${i}`, type: 'mug', x: i % 4, y: Math.floor(i / 4), rotation: 0 })));
    expect(takeFromMedkitInto(full, medkit().index, 'bandage')).toEqual({ ok: false, reason: 'no-room' });
    expect(medkitContents(medkit().index).bandage).toBe(1); // (nothing was taken from the box)
  });

  it('puts what is taken on the first free hotbar slots, ready to use', () => {
    const p = atCounter();
    for (const kit of ['bandage', 'first-aid-box', 'bandage', 'bandage', 'bandage'] as const) { const r = takeFromMedkitInto(p, medkit().index, kit); if (r.ok) p.inventory = r.inventory; }
    expect(p.inventory.items).toHaveLength(5);
    expect(p.inventory.hotbar).toEqual(['medkit:bandage:1', 'medkit:first-aid-box:1', 'medkit:bandage:2']); // (three slots; the rest stay in the grid)
  });

  it('names a new item so that it never clashes with one already in the inventory', () => {
    const p = atCounter();
    for (let i = 0; i < 3; i++) { const r = takeFromMedkitInto(p, medkit().index, 'bandage'); if (r.ok) p.inventory = r.inventory; }
    expect(new Set(p.inventory.items.map(i => i.id)).size).toBe(3);
  });
});

describe('timed care', () => {
  const hurt = (p: Person, limb: 'body' | 'leftArm' = 'leftArm', to = 10) => { p.mechanics.health = { ...p.mechanics.health, [limb]: to }; };
  const two = () => { const a = makeGuest(1, 'medic'), b = makeGuest(2, 'patient'); a.pos.x = 1; a.pos.z = 1; b.pos.x = 1; b.pos.z = 1.5; return [a, b] as const; };

  it('a bandage takes 3 seconds and a first-aid box 5, and heals the most-hurt limb of the patient', () => {
    const [medic, patient] = two();
    withItems(medic, 'bandage', 'first-aid-box');
    hurt(patient, 'leftArm', 30); hurt(patient, 'body', 40);
    for (const [item, seconds] of [['bandage-0', 3], ['first-aid-box-1', 5]] as const) {
      const start = startCare(medic, item, patient, 100);
      expect(start.ok).toBe(true);
      if (!start.ok) return;
      expect(start.job.seconds).toBe(seconds);
      expect(advanceCare(start.job, medic, patient, 100 + seconds - .01)).toBe('running');
      expect(advanceCare(start.job, medic, patient, 100 + seconds)).toBe('done');
    }
    const start = startCare(medic, 'bandage-0', patient, 0);
    if (!start.ok) throw new Error('start');
    expect(finishCare(start.job, medic, patient)).toMatchObject({ body: 55, leftArm: 30 }); // (the body, missing 40, first; 15 hp)
  });

  it('works on yourself too, and finishes nothing when the patient is whole', () => {
    const [medic, other] = two();
    withItems(medic, 'bandage');
    expect(startCare(medic, 'bandage-0', medic, 0)).toEqual({ ok: false, reason: 'unhurt' });
    expect(startCare(medic, 'bandage-0', other, 0)).toEqual({ ok: false, reason: 'unhurt' });
    hurt(medic);
    expect(startCare(medic, 'bandage-0', medic, 0).ok).toBe(true);
  });

  it('refuses without a medical item, for a patient too far, a body-broken or a knocked-down patient', () => {
    const [medic, patient] = two();
    hurt(patient);
    expect(startCare(medic, 'nothing', patient, 0)).toEqual({ ok: false, reason: 'not-medical' });
    withItems(medic, 'bandage');
    patient.pos.z = 1 + CARE_REACH + .2;
    expect(startCare(medic, 'bandage-0', patient, 0)).toEqual({ ok: false, reason: 'too-far' });
    patient.pos.z = 1.5;
    patient.mechanics.health.body = 0;
    expect(startCare(medic, 'bandage-0', patient, 0)).toEqual({ ok: false, reason: 'target' });
    patient.mechanics.health.body = 80; patient.mechanics.posture = 'ragdoll';
    expect(startCare(medic, 'bandage-0', patient, 0)).toEqual({ ok: false, reason: 'down' });
  });

  it('ends when the medic walks away, the patient leaves range, either is hit, or either is knocked down', () => {
    const fresh = () => { const [m, p] = two(); withItems(m, 'bandage'); hurt(p); const s = startCare(m, 'bandage-0', p, 0); if (!s.ok) throw new Error('start'); return { m, p, job: s.job }; };
    { const { m, p, job } = fresh(); m.pos.x += CARE_REACH; expect(advanceCare(job, m, p, 1)).toBe('moved'); }
    { const { m, p, job } = fresh(); p.pos.z += .8; expect(advanceCare(job, m, p, 1)).toBe('range'); }
    { const { m, p, job } = fresh(); p.mechanics.health.head -= 5; expect(advanceCare(job, m, p, 1)).toBe('hit'); }
    { const { m, p, job } = fresh(); m.mechanics.health.rightLeg -= 5; expect(advanceCare(job, m, p, 1)).toBe('hit'); }
    { const { m, p, job } = fresh(); p.mechanics.posture = 'ragdoll'; expect(advanceCare(job, m, p, 1)).toBe('hurt'); }
    { const { m, p, job } = fresh(); m.mechanics.locomotion = 'knockback'; expect(advanceCare(job, m, p, 1)).toBe('hurt'); }
    { const { m, p, job } = fresh(); m.inventory = createInventory(); expect(advanceCare(job, m, p, 1)).toBe('gone'); }
    { const { m, job } = fresh(); expect(advanceCare(job, m, undefined, 1)).toBe('gone'); }
    { const { m, p, job } = fresh(); p.controller = 'ai'; expect(advanceCare(job, m, p, 1)).toBe('gone'); }
  });
});
