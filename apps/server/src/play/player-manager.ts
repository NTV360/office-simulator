import {
  HAZEL_NAME, handBack, stepMedkits, type MedkitContents, type MedkitItem, sanitizeInput, sit, sitFree, stand, stepAllDriven, stepPlayer, syncCharacterHoldTransforms, advanceAttack, attackDamage, attackForce, attackIsActive, applyDamage, beginAttack, releaseAttack, updateStruggle, canEscapeStruggle, escapeCharacter, applyImpact, resolveImpact, advanceImpact, useMedicalItem, canUseHands, hasLineOfSight, characterHolds, sim, simEvents, type ActKind, type AttackKind, type AttackSide, type DrivenInput, type Limb, interactables, isAi, makeGuest, normalizeSpec, npcName, people, removeGuest, setLook, takeControl, releaseCharacterPerson, releaseCarried, grabCharacter, releaseCharacter, throwCharacter, type CharacterHoldResult, type Person, objects, carriedBy, CATALOGUE, canUseHand, setHotbarSlot, moveItem, rotateItem, removeItem, employeeById, fullName,
} from '@office/shared';
import type { Account, AccountStore } from '../auth/account-store';
import { assignObjectToInventory, drop, dropInventoryItem, grab, holdInput, place, putBack, putBackStation, throwIt, type InventoryDropResult, type ObjectResult } from './object-actions';
import type { ItemImpact } from '../physics/item-physics';
import { advanceCare, finishCare, openMedkit, startCare, takeFromMedkitInto, type CareJob, type CareRefusal, type MedkitOpen, type MedkitTake } from './medical-care';

// Who is playing which person. The simulation knows how to take a person over and hand them back (shared/sim/takeover.ts);
// this decides *when*: a login takes over the account's own person (or makes a guest), a disconnect starts a grace period
// before the person is handed back, an admin gives or takes away a desk. See docs/PHASE-3-BREAKDOWN.md, step 3.

export type PlayErrorCode = 'no-account' | 'has-desk' | 'no-desk' | 'no-person' | 'claimed' | 'reserved' | 'desk-taken' | 'has-no-desk' | 'has-employee' | 'no-employee' | 'employee-taken' | 'has-no-employee';

/** A refusal an admin can be told about. */
export class PlayError extends Error {
  constructor(readonly code: PlayErrorCode, message: string) { super(message); this.name = 'PlayError'; }
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h as NodeJS.Timeout) };

/** Something for one player alone. `owner`: their own state changed too (inventory, health), so it is sent as well. */
export interface PlayerNote { kind: 'medkit' | 'care' | 'notice'; text: string; owner?: boolean }

export interface PlayerManagerOptions {
  /** Tell one player something only they need (what a medkit holds, how their care is going). */
  notify?: (accountId: number, note: PlayerNote) => void;
  /** How long a person stays under their player's control after the connection drops, so a flaky link does not make them wander off. */
  graceMs?: number;
  timers?: Timers;
  /** Tell the connection of this account to go, and why. */
  kick?: (accountId: number, reason: string) => void;
  log?: { log(msg: string): void; warn(msg: string): void };
}

interface Session {
  person: Person;
  graceTimer: unknown | null;
  /** The tick of the last sit or stand that was taken (they are limited to about one a second). */
  lastActTick: number;
  /** How many things they may still move right now (a small bucket that refills: see OBJECT_BUCKET). */
  objectTokens: number;
  objectTick: number;
  attackHit: number | null;
  /** Care being given right now (hold E on a medical item in the hotbar), or null. */
  care: CareJob | null;
}

/** Moving things tells everybody, so it is limited: a burst of this many, then about three a second. */
export const OBJECT_BUCKET = { burst: 8, perSecond: 3 };

/** Sitting and standing move a person to the seat, so they are limited to one a second: no hopping between seats to get around quickly. */
export const ACT_COOLDOWN_SECONDS = 1;
/** What a medkit holds, as the short text the page is sent: `object,bandages,first-aid boxes`. */
const medkitText = (object: number, c: MedkitContents): string => `${object},${c.bandage},${c['first-aid-box']}`;
/** Maximum horizontal reach for applying a medical item to another controlled person. */
export const MEDICAL_TARGET_REACH = 1.25;

export class PlayerManager {
  private readonly sessions = new Map<number, Session>();
  /** The latest input of each person a human is driving, by person id. */
  private readonly inputs = new Map<number, DrivenInput>();
  // Logins and desk changes run one at a time, so a login cannot slip in between the two halves of an assignment or a release
  private queue: Promise<unknown> = Promise.resolve();
  private readonly graceMs: number;
  private readonly timers: Timers;
  /** Monotonic real-seconds clock for mechanics whose constants are expressed in seconds. */
  private mechanicsTime = 0;
  private kick: ((accountId: number, reason: string) => void) | null;
  private notify: ((accountId: number, note: PlayerNote) => void) | null;
  private readonly log: NonNullable<PlayerManagerOptions['log']>;

  constructor(private readonly store: AccountStore, opts: PlayerManagerOptions = {}) {
    this.graceMs = opts.graceMs ?? 30_000;
    this.timers = opts.timers ?? realTimers;
    this.kick = opts.kick ?? (() => {});
    this.notify = opts.notify ?? null;
    this.log = opts.log ?? { log: () => {}, warn: () => {} };
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Where notes for one player go (the gateway). */
  onNotify(fn: (accountId: number, note: PlayerNote) => void): () => void {
    this.notify = fn;
    return () => { if (this.notify === fn) this.notify = null; };
  }

  /** Where kicks go (the gateway). */
  onKick(fn: (accountId: number, reason: string) => void): () => void {
    this.kick = fn;
    return () => { if (this.kick === fn) this.kick = null; };
  }

  /** Is this account being played right now (including during the grace period)? */
  isOnline(accountId: number): boolean { return this.sessions.has(accountId); }
  /** The person this account is playing, if any. */
  personOf(accountId: number): Person | undefined { return this.sessions.get(accountId)?.person; }
  get online(): number { return this.sessions.size; }

  /**
   * An account has joined. Returns the person it now plays: its own person where it stands, a guest at the entrance if it has
   * no desk, or (if it reconnected within the grace period) the same person it was playing.
   */
  attach(account: Account): Promise<Person> {
    return this.serial(() => this.doAttach(account));
  }

  private async doAttach(passed: Account): Promise<Person> {
    // the account as it is now: an admin may have changed its desk since the caller read it
    const account = (await this.store.byId(passed.id)) ?? passed;
    const existing = this.sessions.get(account.id);
    if (existing) { // reconnecting: carry on with the same person
      if (existing.graceTimer !== null) { this.timers.clear(existing.graceTimer); existing.graceTimer = null; }
      if (!account.employeeId && account.slotSpot) {
        // A saved desk account is identified by its account username, including
        // after a world restore/reconciliation may have replayed the roster name.
        existing.person.name = account.username;
        if (account.spec) setLook(existing.person, account.spec);
      }
      this.inputs.delete(existing.person.id); // the new connection numbers its messages from the start again
      return existing.person;
    }
    let person: Person | undefined;
    if (account.employeeId) {
      // an account linked to an employee plays that employee's person, wherever they sit now
      const owner = people.find(p => p.userId === account.employeeId);
      if (owner && (owner.owner === account.id || (owner.owner === undefined && isAi(owner)))) {
        if (owner.owner === undefined) this.claim(owner, account); // the world did not know yet (for example it was reset)
        person = owner;
        takeControl(person);
      } else this.log.warn(`${account.username} is linked to an employee who is not in the office; playing as a guest`);
    } else if (account.slotSpot) {
      const desk = interactables.of('desk').find(d => d.id === account.slotSpot);
      const owner = desk?.owner as Person | undefined;
      if (owner && owner.name !== HAZEL_NAME && people.includes(owner) && (owner.owner === account.id || owner.owner === undefined)) {
        if (owner.owner === undefined) this.claim(owner, account); // the world did not know yet (for example it was reset): the database says this desk is theirs
        person = owner;
        if (!account.employeeId) person.name = account.username;
        if (account.spec) setLook(person, account.spec);
        takeControl(person);
      } else this.log.warn(`${account.username} has desk ${account.slotSpot}, but it is not available; playing as a guest`);
    }
    person ??= makeGuest(account.id, account.username, account.spec ?? undefined);
    this.inputs.delete(person.id); // a new session starts with no movement and its own message numbers
    this.sessions.set(account.id, { person, graceTimer: null, lastActTick: -Infinity, objectTokens: OBJECT_BUCKET.burst, objectTick: 0, attackHit: null, care: null });
    return person;
  }

  /**
   * A guest who leaves is not kept over a restart, so what they stored goes on the floor around them (a few things may find no room and
   * are lost). Somebody with a desk keeps their inventory.
   */
  private dropGuestInventory(person: Person): void {
    if (person.slot) return;
    releaseCarried(person.id); // (what they carry goes home first, so what they stored is not put down where that is about to land)
    let lost = 0;
    for (const item of [...person.inventory.items]) {
      const result = dropInventoryItem(person, person.inventory, item.id);
      if (result.ok) person.inventory = result.inventory; else lost++;
    }
    person.mechanics.inventoryRevision++;
    if (lost > 0) this.log.warn(`${person.name} left; ${lost} stored item(s) found no room on the floor and were lost`);
  }

  /** The connection is gone. The person stays where they are for the grace period, then goes back to autopilot (a guest leaves). */
  detach(accountId: number): void {
    const s = this.sessions.get(accountId);
    if (!s || s.graceTimer !== null) return;
    s.graceTimer = this.timers.set(() => {
      this.sessions.delete(accountId);
      this.inputs.delete(s.person.id);
      releaseCharacterPerson(s.person.id);
      this.dropGuestInventory(s.person);
      handBack(s.person); // a guest has no desk, so this removes them
    }, this.graceMs);
  }

  /**
   * The player's latest wish about moving. Anything that is not a sane input is ignored; one older than the last (by its number)
   * is ignored too. Returns whether it was taken.
   */
  setInput(accountId: number, raw: unknown, tick: number): boolean {
    const s = this.sessions.get(accountId);
    if (!s) return false;
    const input = sanitizeInput(raw, tick);
    if (!input) return false;
    const last = this.inputs.get(s.person.id);
    if (last && input.seq <= last.seq) return false;
    this.inputs.set(s.person.id, input);
    return true;
  }

  /** What the server knows about a player's person for the `ack` message: the last input number it used, and where the person is. */
  ackFor(accountId: number): { seq: number; x: number; z: number; face: number } | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    return { seq: this.inputs.get(s.person.id)?.seq ?? 0, x: s.person.pos.x, z: s.person.pos.z, face: s.person.face };
  }

  /** Who this account is speaking as, and where: for chat. */
  speaker(accountId: number): { accountId: number; personId: number; name: string; x: number; z: number } | null {
    const s = this.sessions.get(accountId);
    return s ? { accountId, personId: s.person.id, name: s.person.name, x: s.person.pos.x, z: s.person.pos.z } : null;
  }

  /** Look up the authoritative person currently attached to an account. */
  personFor(accountId: number): Person | null { return this.sessions.get(accountId)?.person ?? null; }

  /** Everyone who is playing right now, and where their person is: for working out who hears a chat line. */
  hearers(): Array<{ accountId: number; x: number; z: number }> {
    return [...this.sessions].map(([accountId, s]) => ({ accountId, x: s.person.pos.x, z: s.person.pos.z }));
  }

  /** The player asks to sit or stand. The simulation says whether that is possible right now. */
  act(accountId: number, kind: ActKind, tick: number, tickRate = 20): boolean {
    const s = this.sessions.get(accountId);
    if (!s) return false;
    if (tick - s.lastActTick < ACT_COOLDOWN_SECONDS * tickRate) return false;
    const done = kind === 'sit' ? (sit(s.person) || sitFree(s.person)) : stand(s.person);
    if (done) s.lastActTick = tick;
    return done;
  }

  /** Spend one move from the account's bucket; false when they are moving things too fast. */
  private takeObjectToken(s: Session, tick: number, tickRate: number): boolean {
    s.objectTokens = Math.min(OBJECT_BUCKET.burst, s.objectTokens + Math.max(0, tick - s.objectTick) / tickRate * OBJECT_BUCKET.perSecond);
    s.objectTick = tick;
    if (s.objectTokens < 1) return false;
    s.objectTokens -= 1;
    return true;
  }

  /** Return a token when a throttled request was validly rate-limited but semantically refused. */
  private refundObjectToken(s: Session, result: ObjectResult): ObjectResult {
    if (!result.ok) s.objectTokens = Math.min(OBJECT_BUCKET.burst, s.objectTokens + 1);
    return result;
  }

  /** The player picks up an object (by its index in the layout). Null when they are not playing. */
  grabObject(accountId: number, index: number, tick: number, tickRate = 20, at?: readonly number[]): ObjectResult | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (!this.takeObjectToken(s, tick, tickRate)) return { ok: false, reason: 'too-fast' };
    return this.refundObjectToken(s, grab(s.person, index, at));
  }

  /** The player puts down what they carry. */
  placeObject(accountId: number, x: number, z: number, rot: number, tick: number, tickRate = 20): ObjectResult | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (!this.takeObjectToken(s, tick, tickRate)) return { ok: false, reason: 'too-fast' };
    return this.refundObjectToken(s, place(s.person, x, z, rot));
  }

  /** How the player holds what they hold (turned, hands up or down): sent often, so it costs no move token. */
  holdObject(accountId: number, turn: readonly number[], raise: number): ObjectResult | null {
    const s = this.sessions.get(accountId);
    return s ? holdInput(s.person, turn, raise) : null;
  }

  /** The player lets go of what they hold, or throws it. */
  dropObject(accountId: number, tick: number, tickRate = 20, aim: { power: number; yaw: number; pitch: number } | null = null): ObjectResult | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (!this.takeObjectToken(s, tick, tickRate)) return { ok: false, reason: 'too-fast' };
    const result = aim === null ? drop(s.person) : throwIt(s.person, aim.power, aim.yaw, aim.pitch);
    return this.refundObjectToken(s, result);
  }

  /** Take hold of another person; reach, one-held rule and cycles are checked authoritatively. */
  grabCharacter(accountId: number, targetId: number, az?: number, lift?: number): CharacterHoldResult | null {
    const s = this.sessions.get(accountId);
    return s ? grabCharacter(s.person, targetId, az, lift) : null;
  }

  releaseCharacter(accountId: number): CharacterHoldResult | null {
    const s = this.sessions.get(accountId);
    return s ? releaseCharacter(s.person) : null;
  }

  throwCharacter(accountId: number): CharacterHoldResult | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    // Character throwing is a non-combat release. Combat impacts come from the
    // explicit attack/item paths, so releasing a hold must not ragdoll the target.
    return throwCharacter(s.person);
  }

  /** Authoritative inventory mutation. The revision is compare-and-swap; client inventory contents are never accepted. */
  inventoryAction(accountId: number, action: 'assign' | 'hotbar' | 'drop' | 'move' | 'rotate', revision: number, itemId?: string, slot?: number, objectIndex?: number, x?: number, y?: number): InventoryDropResult | ObjectResult | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (!Number.isInteger(revision) || revision !== s.person.mechanics.inventoryRevision) return { ok: false, reason: 'blocked' };
    if (action === 'drop') {
      if (!itemId) return { ok: false, reason: 'not-movable' };
      const result = dropInventoryItem(s.person, s.person.inventory, itemId);
      if (result.ok) { s.person.inventory = result.inventory; s.person.mechanics.inventoryRevision++; }
      return result;
    }
    if (action === 'hotbar') {
      if (slot === undefined || slot < 0 || slot > 2) return { ok: false, reason: 'blocked' };
      try { s.person.inventory = setHotbarSlot(s.person.inventory, slot, itemId ?? null); } catch { return { ok: false, reason: 'not-movable' }; }
      s.person.mechanics.inventoryRevision++;
      return { ok: true, changed: 1 } as InventoryDropResult;
    }
    if (action === 'move' || action === 'rotate') {
      if (!itemId) return { ok: false, reason: 'not-movable' };
      const next = action === 'move' ? moveItem(s.person.inventory, itemId, x ?? -1, y ?? -1) : rotateItem(s.person.inventory, itemId);
      if (!next) return { ok: false, reason: 'blocked' };
      s.person.inventory = next;
      s.person.mechanics.inventoryRevision++;
      return { ok: true, changed: 1 } as InventoryDropResult;
    }
    if (objectIndex === undefined || !Number.isInteger(objectIndex)) return { ok: false, reason: 'not-movable' };
    const result = assignObjectToInventory(s.person, s.person.inventory, objectIndex);
    if (result.ok) { s.person.inventory = result.inventory; s.person.mechanics.inventoryRevision++; }
    return result;
  }

  /** The player opens a medkit: they are told what it holds now. The page asks again about once a second while the menu is open, so the counts stay current. */
  medkitOpen(accountId: number, index: number): MedkitOpen | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    const r = openMedkit(s.person, index);
    if (r.ok) this.notify?.(accountId, { kind: 'medkit', text: medkitText(r.object, r.contents) });
    return r;
  }

  /** The player takes one item out of a medkit into their inventory. The revision is compare-and-swap like every inventory change. */
  medkitTake(accountId: number, revision: number, index: number, item: MedkitItem): MedkitTake | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (!Number.isInteger(revision) || revision !== s.person.mechanics.inventoryRevision) return { ok: false, reason: 'stale' };
    const r = takeFromMedkitInto(s.person, index, item);
    if (!r.ok) return r;
    s.person.inventory = r.inventory;
    s.person.mechanics.inventoryRevision++;
    this.notify?.(accountId, { kind: 'medkit', text: medkitText(r.object, r.contents), owner: true });
    return r;
  }

  /**
   * The player starts caring for somebody (themselves, or `targetId`) with a medical item from their inventory: hold E on it in the hotbar.
   * It takes 3 seconds (bandage) or 5 (first-aid box) and is ended by anything in `advanceCare`; the item is used up only when it works.
   */
  careStart(accountId: number, itemId: string, targetId?: number): { ok: true; seconds: number } | { ok: false; reason: CareRefusal | 'busy' } | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (s.care) return { ok: false, reason: 'busy' };
    const target = targetId === undefined ? s.person : people.find(p => p.id === targetId);
    if (!target) return this.refuseCare(accountId, 'target');
    const r = startCare(s.person, itemId, target, this.mechanicsTime);
    if (!r.ok) return this.refuseCare(accountId, r.reason);
    s.care = r.job;
    this.notify?.(accountId, { kind: 'care', text: `start:${r.job.seconds}` });
    return { ok: true, seconds: r.job.seconds };
  }

  private refuseCare(accountId: number, reason: CareRefusal): { ok: false; reason: CareRefusal } {
    this.notify?.(accountId, { kind: 'care', text: `cancel:${reason}` });
    return { ok: false, reason };
  }

  /** The player lets go of E: any care they were giving stops and nothing is used up. */
  careStop(accountId: number): void {
    const s = this.sessions.get(accountId);
    if (!s?.care) return;
    s.care = null;
    this.notify?.(accountId, { kind: 'care', text: 'cancel:released' });
  }

  /** Move every care on by one tick: end the ones that must end, finish the ones that are done. */
  private stepCare(now: number): void {
    for (const [accountId, s] of this.sessions) {
      const job = s.care;
      if (!job) continue;
      const target = people.find(p => p.id === job.targetId);
      const state = advanceCare(job, s.person, target, now);
      if (state === 'running') continue;
      s.care = null;
      if (state !== 'done') { this.notify?.(accountId, { kind: 'care', text: `cancel:${state}` }); continue; }
      const health = finishCare(job, s.person, target!);
      if (!health) { this.notify?.(accountId, { kind: 'care', text: 'cancel:unhurt' }); continue; }
      target!.mechanics.health = health;
      s.person.inventory = removeItem(s.person.inventory, job.itemId);
      s.person.mechanics.inventoryRevision++;
      simEvents.emit('personUpdated', target!);
      if (target !== s.person) simEvents.emit('personUpdated', s.person);
      this.notify?.(accountId, { kind: 'care', text: 'done', owner: true });
      if (target !== s.person) {
        for (const [otherId, other] of this.sessions) if (other.person === target) this.notify?.(otherId, { kind: 'notice', text: `${s.person.name} treated you.`, owner: true });
      }
    }
  }

  /** The player puts one object, or everything at their own desk, back where it started. */
  resetObjects(accountId: number, scope: 'object' | 'station', index: number, tick: number, tickRate = 20): ObjectResult | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (!this.takeObjectToken(s, tick, tickRate)) return { ok: false, reason: 'too-fast' };
    const result = scope === 'station' ? putBackStation(s.person) : putBack(s.person, index);
    return this.refundObjectToken(s, result);
  }

  /** Current real-seconds mechanics clock; unlike sim.t this is not a simulated-minute value. */
  mechanicsNow(): number { return this.mechanicsTime; }

  /** Begin or release one authoritative punch/kick. Target selection and damage happen on the server. */
  attack(accountId: number, phase: 'begin' | 'release', kind: AttackKind, now: number = this.mechanicsTime, side?: AttackSide): boolean {
    const s = this.sessions.get(accountId);
    if (!s || !Number.isFinite(now) || (kind !== 'punch' && kind !== 'kick' && kind !== 'bash')) return false;
    const selectedSide = side ?? s.person.mechanics.dominantHand;
    if (phase === 'release' && (!s.person.mechanics.attack || s.person.mechanics.attack.kind !== kind || (side !== undefined && s.person.mechanics.attack.side !== side))) return false;
    if (phase === 'begin') {
      if (kind === 'bash') {
        const held = carriedBy(s.person.id);
        const capability = held ? CATALOGUE[held.type]?.bash : undefined;
        const otherSide = selectedSide === 'left' ? 'right' : 'left';
        if (!capability || !canUseHand(s.person.mechanics, selectedSide) || (capability.hand === 'two' && !canUseHand(s.person.mechanics, otherSide))) return false;
      }
      const next = beginAttack(s.person.mechanics, kind, now, selectedSide);
      if (!next) return false;
      s.person.mechanics = next;
      return true;
    }
    const charging = s.person.mechanics.attack;
    if (charging?.kind === 'bash') {
      const held = carriedBy(s.person.id);
      const bash = held ? CATALOGUE[held.type]?.bash : undefined;
      const otherSide = charging.side === 'left' ? 'right' : 'left';
      // Re-check the live held object and both arms at release: a bash must not
      // survive an arm injury or an object being removed during its charge.
      if (!bash || !canUseHand(s.person.mechanics, charging.side) || (bash.hand === 'two' && !canUseHand(s.person.mechanics, otherSide))) {
        s.person.mechanics = { ...s.person.mechanics, attack: null };
        return false;
      }
    }
    const next = releaseAttack(s.person.mechanics, now);
    if (!next || next === s.person.mechanics) return false;
    const held = next.attack?.kind === 'bash' ? carriedBy(s.person.id) : undefined;
    const bash = held ? CATALOGUE[held.type]?.bash : undefined;
    if (bash && next.attack) next.attack = { ...next.attack, cooldownUntil: now + bash.cooldown };
    s.person.mechanics = next;
    if (next.attack?.phase === 'active' && next.attack.releaseAt === now) this.resolveAttack(s, now);
    return true;
  }

  /** Resolve a moving-item contact after Rapier has observed it; characters remain server-authoritative, not physics bodies. */
  applyItemImpact(contact: ItemImpact, now = this.mechanicsTime): boolean {
    if (!contact.object || contact.object.removed || !Number.isFinite(now)) return false;
    const target = people.find(person => person.id === contact.personId);
    const type = CATALOGUE[contact.object.type];
    if (!target || target.controller !== 'account' || target.mechanics.health.body <= 0 || !type) return false;
    const impact = resolveImpact({ normal: contact.normal, relativeSpeed: contact.relativeSpeed, mass: type.mass });
    if (!impact) return false;
    target.mechanics.health = applyDamage(target.mechanics.health, 'body', Math.min(30, impact.impulse * 2));
    // An impact forcibly ends a player-controlled seat task before changing
    // mechanics; otherwise the stale task/occupant can re-seat or teleport them
    // on a later driven tick.
    if (target.task?.kind === 'playerSit') stand(target);
    const wasRagdoll = target.mechanics.locomotion === 'ragdoll';
    target.mechanics = applyImpact(target.mechanics, impact, now);
    stepPlayer(target, impact.displacement.x, impact.displacement.z, people);
    if (impact.ragdoll && !wasRagdoll) releaseCharacterPerson(target.id);
    return true;
  }

  private resolveAttack(source: Session, now: number): void {
    const attack = source.person.mechanics.attack;
    if (!attack || !attackIsActive(attack, now) || source.attackHit === attack.sequence) return;
    source.attackHit = attack.sequence;
    const held = attack.kind === 'bash' ? carriedBy(source.person.id) : undefined;
    const bash = held ? CATALOGUE[held.type]?.bash : undefined;
    if (attack.kind === 'bash' && !bash) return;
    const range = attack.kind === 'kick' ? 1.15 : attack.kind === 'bash' ? 1.05 : .95;
    let target: Person | undefined, distance = Infinity;
    for (const candidate of people) {
      if (candidate === source.person || candidate.controller !== 'account' || candidate.mechanics.health.body <= 0) continue;
      const dx = candidate.pos.x - source.person.pos.x, dz = candidate.pos.z - source.person.pos.z;
      const d = Math.hypot(dx, dz); if (d > range || d >= distance) continue;
      const facing = Math.sin(source.person.face) * dx + Math.cos(source.person.face) * dz;
      if (facing < -0.15) continue;
      target = candidate; distance = d;
    }
    if (target) {
      const damage = bash?.damage ?? attackDamage(attack.kind, attack.charge);
      target.mechanics.health = applyDamage(target.mechanics.health, 'body', bash ? damage * Math.max(0, Math.min(1, attack.charge)) : damage);
      const dx = target.pos.x - source.person.pos.x, dz = target.pos.z - source.person.pos.z;
      const impact = resolveImpact({
        normal: { x: dx, z: dz },
        relativeSpeed: 0,
        mass: 0,
        force: bash ? bash.force * Math.max(0, Math.min(1, attack.charge)) : attackForce(attack.kind, attack.charge),
      });
      if (impact) {
        if (target.task?.kind === 'playerSit') stand(target);
        const wasRagdoll = target.mechanics.locomotion === 'ragdoll';
        target.mechanics = applyImpact(target.mechanics, impact, now);
        stepPlayer(target, impact.displacement.x, impact.displacement.z, people);
        if (impact.ragdoll && !wasRagdoll) releaseCharacterPerson(target.id);
      }
    }
  }

  /** One tick of movement and attack resolution for everyone a human is driving. */
  stepAll(dt: number, tick: number): void {
    stepAllDriven(this.inputs, dt, tick);
    syncCharacterHoldTransforms();
    // Combat and impact constants are real seconds; simulation time is minutes and
    // changes with the office speed, so keep a separate monotonic mechanics clock.
    this.mechanicsTime += Math.max(0, dt);
    const now = this.mechanicsTime;
    stepMedkits(dt); // (every medkit makes its next bandage and first-aid box in real seconds)
    this.stepCare(now);
    for (const s of this.sessions.values()) {
      const input = this.inputs.get(s.person.id);
      const heldBy = s.person.mechanics.heldBy;
      if (heldBy !== null) {
        const struggling = input?.struggle === true;
        const nextStruggle = updateStruggle(s.person.mechanics.struggle, dt, struggling);
        if (nextStruggle !== s.person.mechanics.struggle) s.person.mechanics.struggle = nextStruggle;
        if (canEscapeStruggle(nextStruggle)) escapeCharacter(s.person);
      } else if (s.person.mechanics.struggle !== 0) {
        s.person.mechanics.struggle = updateStruggle(s.person.mechanics.struggle, dt, false);
      }
      const before = s.person.mechanics;
      const recovered = advanceImpact(before, now);
      if (recovered !== before) s.person.mechanics = recovered;
      const after = advanceAttack(s.person.mechanics, now);
      if (after !== before) s.person.mechanics = after;
      if (s.person.mechanics.attack?.phase === 'active') this.resolveAttack(s, now);
      if (!s.person.mechanics.attack) s.attackHit = null;
    }
  }

  /** Hand everybody back at once (the server is stopping). */
  releaseAll(): void {
    for (const [id, s] of this.sessions) {
      if (s.graceTimer !== null) this.timers.clear(s.graceTimer);
      this.inputs.delete(s.person.id);
      releaseCharacterPerson(s.person.id);
      this.dropGuestInventory(s.person);
      handBack(s.person);
      this.sessions.delete(id);
    }
  }

  /**
   * An admin gives an account the desk `spotId`. The desk must belong to an unclaimed autopilot person (not Hazel). That person
   * becomes the account's: renamed to the account, with the account's look if it has one. An account that is connected as a guest
   * is told to log in again.
   */
  assignSlot(accountId: number, spotId: string): Promise<Person> {
    return this.serial(() => this.doAssign(accountId, spotId));
  }

  private async doAssign(accountId: number, spotId: string): Promise<Person> {
    const account = await this.store.byId(accountId);
    if (!account) throw new PlayError('no-account', 'there is no such account');
    if (account.slotSpot) throw new PlayError('has-desk', `${account.username} already has a desk (${account.slotSpot}); release it first`);
    if (account.employeeId) throw new PlayError('has-employee', `${account.username} plays an employee already; unlink them first`);
    const desk = interactables.of('desk').find(d => d.id === spotId);
    if (!desk) throw new PlayError('no-desk', `there is no desk "${spotId}"`);
    const person = desk.owner as Person | undefined;
    if (!person) throw new PlayError('no-person', `nobody sits at ${spotId} (raise the number of slots first)`);
    if (person.name === HAZEL_NAME) throw new PlayError('reserved', `${spotId} is Hazel's desk and cannot be given away`);
    if (person.owner !== undefined || !isAi(person)) throw new PlayError('claimed', `${spotId} already belongs to an account`);
    const result = await this.store.setSlot(accountId, spotId);
    if (result === 'taken') throw new PlayError('desk-taken', `${spotId} already belongs to an account`);
    if (result === 'missing') throw new PlayError('no-account', 'there is no such account');
    // the database write took a moment: make sure the person is still there and still nobody's (the slot count may have been lowered)
    if (desk.owner !== person || !people.includes(person) || person.owner !== undefined) {
      await this.store.setSlot(accountId, null);
      throw new PlayError('no-person', `${spotId} changed while it was being given out; nothing was assigned`);
    }
    const guest = this.sessions.get(accountId);
    this.claim(person, { ...account, slotSpot: spotId });
    if (guest) { // they were walking around as a guest: they have a desk now, so they log in again to take it
      if (guest.graceTimer !== null) this.timers.clear(guest.graceTimer);
      this.sessions.delete(accountId);
      this.inputs.delete(guest.person.id);
      releaseCharacterPerson(guest.person.id);
      this.dropGuestInventory(guest.person);
      removeGuest(guest.person);
      this.kick?.(accountId, 'your desk was assigned, log in again');
    }
    this.log.log(`desk ${spotId} (${person.name}) given to ${account.username}`);
    return person;
  }

  /**
   * An admin links an account to an employee. The employee's person (they must be in the office) becomes the account's: it keeps the
   * employee's name, and a look the account made before is kept for them if they had none. An account that is connected as a guest is told to
   * log in again.
   */
  linkEmployee(accountId: number, employeeId: string): Promise<Person> {
    return this.serial(() => this.doLink(accountId, employeeId));
  }

  private async doLink(accountId: number, employeeId: string): Promise<Person> {
    const account = await this.store.byId(accountId);
    if (!account) throw new PlayError('no-account', 'there is no such account');
    if (account.employeeId) throw new PlayError('has-employee', `${account.username} already plays an employee; unlink them first`);
    if (account.slotSpot) throw new PlayError('has-desk', `${account.username} has a desk (${account.slotSpot}); release it first`);
    const person = people.find(p => p.userId === employeeId);
    if (!person) throw new PlayError('no-person', 'that employee is not in the office (they need a desk)');
    if (person.owner !== undefined || !isAi(person)) throw new PlayError('claimed', 'that employee already belongs to an account');
    const result = await this.store.setEmployee(accountId, employeeId);
    if (result === 'taken') throw new PlayError('employee-taken', 'that employee already belongs to an account');
    if (result === 'missing') throw new PlayError('no-employee', 'there is no such employee');
    // the database write took a moment: make sure the person is still there and still nobody's
    if (!people.includes(person) || person.owner !== undefined) {
      await this.store.setEmployee(accountId, null);
      throw new PlayError('no-person', 'that employee changed while they were being linked; nothing was linked');
    }
    const guest = this.sessions.get(accountId);
    this.claim(person, { ...account, employeeId });
    if (guest) {
      if (guest.graceTimer !== null) this.timers.clear(guest.graceTimer);
      this.sessions.delete(accountId);
      this.inputs.delete(guest.person.id);
      releaseCharacterPerson(guest.person.id);
      this.dropGuestInventory(guest.person);
      removeGuest(guest.person);
      this.kick?.(accountId, 'you were linked to an employee, log in again');
    }
    this.log.log(`${account.username} linked to ${person.name}`);
    return person;
  }

  /** An admin unlinks an account from its employee. The person stays as an ordinary NPC. If the account is playing them, that ends. */
  unlinkEmployee(accountId: number): Promise<Person | null> {
    return this.serial(() => this.doUnlink(accountId));
  }

  private async doUnlink(accountId: number): Promise<Person | null> {
    const account = await this.store.byId(accountId);
    if (!account) throw new PlayError('no-account', 'there is no such account');
    if (!account.employeeId) throw new PlayError('has-no-employee', `${account.username} is not linked to an employee`);
    const person = people.find(p => p.userId === account.employeeId);
    await this.store.setEmployee(accountId, null); // the database first; everything after this is immediate
    const session = this.sessions.get(accountId);
    if (session) {
      if (session.graceTimer !== null) this.timers.clear(session.graceTimer);
      this.sessions.delete(accountId);
      this.inputs.delete(session.person.id);
      releaseCharacterPerson(session.person.id);
      if (session.person.slot) handBack(session.person); else { this.dropGuestInventory(session.person); removeGuest(session.person); }
      this.kick?.(accountId, 'you were unlinked from your employee by an admin');
    }
    if (person && person.owner === accountId) this.unclaim(person);
    this.log.log(`${account.username} unlinked from an employee`);
    return person ?? null;
  }

  /** An admin takes an account's desk away. The person stays as an ordinary NPC. If the account is playing them, that ends. */
  releaseSlot(accountId: number): Promise<Person | null> {
    return this.serial(() => this.doRelease(accountId));
  }

  private async doRelease(accountId: number): Promise<Person | null> {
    const account = await this.store.byId(accountId);
    if (!account) throw new PlayError('no-account', 'there is no such account');
    if (!account.slotSpot) throw new PlayError('has-no-desk', `${account.username} has no desk`);
    const desk = interactables.of('desk').find(d => d.id === account.slotSpot);
    const person = desk?.owner as Person | undefined;
    await this.store.setSlot(accountId, null); // the database first; everything after this is immediate, with nothing awaited in between
    const session = this.sessions.get(accountId);
    if (session) {
      if (session.graceTimer !== null) this.timers.clear(session.graceTimer);
      this.sessions.delete(accountId);
      this.inputs.delete(session.person.id);
      releaseCharacterPerson(session.person.id);
      if (session.person.slot) handBack(session.person); else { this.dropGuestInventory(session.person); removeGuest(session.person); }
      this.kick?.(accountId, 'your desk was taken away by an admin');
    }
    if (person && person.owner === accountId) this.unclaim(person);
    this.log.log(`desk ${account.slotSpot} taken from ${account.username}`);
    return person ?? null;
  }

  /**
   * After a start-up: make the world agree with the accounts. Every account's desk belongs to its person; a person who says
   * they belong to an account that no longer has that desk becomes an ordinary NPC again. The accounts win.
   */
  async reconcile(): Promise<{ claimed: number; released: number }> {
    const accounts = await this.store.list();
    let claimed = 0, released = 0;
    const wanted = new Map<string, Account>();
    for (const a of accounts) if (a.slotSpot) wanted.set(a.slotSpot, a);
    // accounts linked to an employee: that employee's person is theirs, wherever it sits
    const linked = new Map<string, Account>();
    for (const a of accounts) if (a.employeeId) linked.set(a.employeeId, a);
    for (const [employeeId, account] of linked) {
      const person = people.find(p => p.userId === employeeId);
      if (!person) { this.log.warn(`${account.username} is linked to an employee who is not in the office`); continue; }
      if (person.owner !== account.id) { this.claim(person, account); claimed++; }
      else {
        // Roster imports may rename an employee while their account remains online.
        // Keep the employee identity for linked accounts, while desk-only accounts
        // continue to use their account username.
        const employee = employeeById(employeeId);
        const name = employee ? fullName(employee) : person.name;
        if (person.name !== name) { person.name = name; simEvents.emit('personUpdated', person); }
      }
    }
    for (const [spot, account] of wanted) {
      const person = interactables.of('desk').find(d => d.id === spot)?.owner as Person | undefined;
      if (!person) { this.log.warn(`${account.username} has desk ${spot}, which has nobody at it`); continue; }
      if (person.name === HAZEL_NAME) { this.log.warn(`${account.username} has desk ${spot}, which is Hazel's and cannot be given away; ignored`); continue; }
      if (person.owner !== account.id) { this.claim(person, account); claimed++; }
      else if (!account.employeeId) {
        // A saved desk account owns the character even when roster sync restored
        // the imported employee name before account reconciliation.
        if (person.name !== account.username) { person.name = account.username; setLook(person, person.spec); }
        if (account.spec) setLook(person, account.spec);
      }
    }
    for (const p of people) {
      if (p.owner === undefined || !p.slot) continue;
      const byEmployee = p.userId ? linked.get(p.userId) : undefined;
      const a = byEmployee ?? wanted.get(p.slot.id);
      if (!a || a.id !== p.owner) { this.unclaim(p); released++; }
    }
    return { claimed, released };
  }

  /** An account changed its look: whoever is theirs right now (playing, or on autopilot at their desk) wears it, and viewers are told. */
  applyLook(accountId: number, spec: unknown): void {
    for (const p of people) if (p.owner === accountId) setLook(p, spec);
  }

  /** The person stops being an account's: an ordinary NPC again, with an NPC's name. */
  private unclaim(person: Person): void {
    releaseCharacterPerson(person.id);
    delete person.owner;
    const employee = person.userId ? employeeById(person.userId) : null;
    person.name = employee ? fullName(employee) : npcName();
    if (employee?.character) person.spec = normalizeSpec(employee.character);
    setLook(person, person.spec); // announces the change to viewers
  }

  /** Make `person` the account's: it belongs to them, carries their name, and wears their look if they have one. */
  private claim(person: Person, account: Account): void {
    person.owner = account.id;
    // A desk account owns the desk character even when that character was
    // imported with an employee record. Only an explicitly employee-linked
    // account keeps the imported employee identity; a saved account look wins
    // for either kind of account.
    if (!account.employeeId) person.name = account.username;
    if (account.spec) person.spec = normalizeSpec(account.spec);
    setLook(person, person.spec); // announces the change to viewers
  }
}
