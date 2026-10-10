import {
  HAZEL_NAME, handBack, sanitizeInput, sit, stand, stepAllDriven, type ActKind, type DrivenInput, interactables, isAi, makeGuest, normalizeSpec, npcName, people, removeGuest, setLook, takeControl, type Person,
} from '@office/shared';
import type { Account, AccountStore } from '../auth/account-store';
import { grab, place, putBack, putBackStation, type ObjectResult } from './object-actions';

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

export interface PlayerManagerOptions {
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
}

/** Moving things tells everybody, so it is limited: a burst of this many, then about three a second. */
export const OBJECT_BUCKET = { burst: 8, perSecond: 3 };

/** Sitting and standing move a person to the seat, so they are limited to one a second: no hopping between seats to get around quickly. */
export const ACT_COOLDOWN_SECONDS = 1;

export class PlayerManager {
  private readonly sessions = new Map<number, Session>();
  /** The latest input of each person a human is driving, by person id. */
  private readonly inputs = new Map<number, DrivenInput>();
  // Logins and desk changes run one at a time, so a login cannot slip in between the two halves of an assignment or a release
  private queue: Promise<unknown> = Promise.resolve();
  private readonly graceMs: number;
  private readonly timers: Timers;
  private kick: (accountId: number, reason: string) => void;
  private readonly log: NonNullable<PlayerManagerOptions['log']>;

  constructor(private readonly store: AccountStore, opts: PlayerManagerOptions = {}) {
    this.graceMs = opts.graceMs ?? 30_000;
    this.timers = opts.timers ?? realTimers;
    this.kick = opts.kick ?? (() => {});
    this.log = opts.log ?? { log: () => {}, warn: () => {} };
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Where kicks go (the gateway). */
  onKick(fn: (accountId: number, reason: string) => void): void { this.kick = fn; }

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
        if (account.spec) setLook(person, account.spec);
        takeControl(person);
      } else this.log.warn(`${account.username} has desk ${account.slotSpot}, but it is not available; playing as a guest`);
    }
    person ??= makeGuest(account.id, account.username, account.spec ?? undefined);
    this.inputs.delete(person.id); // a new session starts with no movement and its own message numbers
    this.sessions.set(account.id, { person, graceTimer: null, lastActTick: -Infinity, objectTokens: OBJECT_BUCKET.burst, objectTick: 0 });
    return person;
  }

  /** The connection is gone. The person stays where they are for the grace period, then goes back to autopilot (a guest leaves). */
  detach(accountId: number): void {
    const s = this.sessions.get(accountId);
    if (!s || s.graceTimer !== null) return;
    s.graceTimer = this.timers.set(() => {
      this.sessions.delete(accountId);
      this.inputs.delete(s.person.id);
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

  /** Everyone who is playing right now, and where their person is: for working out who hears a chat line. */
  hearers(): Array<{ accountId: number; x: number; z: number }> {
    return [...this.sessions].map(([accountId, s]) => ({ accountId, x: s.person.pos.x, z: s.person.pos.z }));
  }

  /** The player asks to sit or stand. The simulation says whether that is possible right now. */
  act(accountId: number, kind: ActKind, tick: number, tickRate = 20): boolean {
    const s = this.sessions.get(accountId);
    if (!s) return false;
    if (tick - s.lastActTick < ACT_COOLDOWN_SECONDS * tickRate) return false;
    const done = kind === 'sit' ? sit(s.person) : stand(s.person);
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

  /** The player picks up an object (by its index in the layout). Null when they are not playing. */
  grabObject(accountId: number, index: number, tick: number, tickRate = 20, at?: readonly number[]): ObjectResult | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (!this.takeObjectToken(s, tick, tickRate)) return { ok: false, reason: 'too-fast' };
    return grab(s.person, index, at);
  }

  /** The player puts down what they carry. */
  placeObject(accountId: number, x: number, z: number, rot: number, tick: number, tickRate = 20): ObjectResult | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (!this.takeObjectToken(s, tick, tickRate)) return { ok: false, reason: 'too-fast' };
    return place(s.person, x, z, rot);
  }

  /** The player puts one object, or everything at their own desk, back where it started. */
  resetObjects(accountId: number, scope: 'object' | 'station', index: number, tick: number, tickRate = 20): ObjectResult | null {
    const s = this.sessions.get(accountId);
    if (!s) return null;
    if (!this.takeObjectToken(s, tick, tickRate)) return { ok: false, reason: 'too-fast' };
    return scope === 'station' ? putBackStation(s.person) : putBack(s.person, index);
  }

  /** One tick of movement for everyone a human is driving (called by the world before the simulation steps). */
  stepAll(dt: number, tick: number): void {
    stepAllDriven(this.inputs, dt, tick);
  }

  /** Hand everybody back at once (the server is stopping). */
  releaseAll(): void {
    for (const [id, s] of this.sessions) {
      if (s.graceTimer !== null) this.timers.clear(s.graceTimer);
      this.inputs.delete(s.person.id);
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
      removeGuest(guest.person);
      this.kick(accountId, 'your desk was assigned, log in again');
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
      removeGuest(guest.person);
      this.kick(accountId, 'you were linked to an employee, log in again');
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
      if (session.person.slot) handBack(session.person); else removeGuest(session.person);
      this.kick(accountId, 'you were unlinked from your employee by an admin');
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
      if (session.person.slot) handBack(session.person); else removeGuest(session.person);
      this.kick(accountId, 'your desk was taken away by an admin');
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
    }
    for (const [spot, account] of wanted) {
      const person = interactables.of('desk').find(d => d.id === spot)?.owner as Person | undefined;
      if (!person) { this.log.warn(`${account.username} has desk ${spot}, which has nobody at it`); continue; }
      if (person.name === HAZEL_NAME) { this.log.warn(`${account.username} has desk ${spot}, which is Hazel's and cannot be given away; ignored`); continue; }
      if (person.owner !== account.id) { this.claim(person, account); claimed++; }
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
    delete person.owner;
    if (!person.userId) person.name = npcName(); // (an employee keeps their own name)
    setLook(person, person.spec); // announces the change to viewers
  }

  /** Make `person` the account's: it belongs to them, carries their name, and wears their look if they have one. */
  private claim(person: Person, account: Account): void {
    person.owner = account.id;
    if (!person.userId) person.name = account.username; // (an employee keeps their own name, not the account's)
    if (account.spec && !person.userId) person.spec = normalizeSpec(account.spec); // (an employee's look is the one on their record: see the character route)
    setLook(person, person.spec); // announces the change to viewers
  }
}
