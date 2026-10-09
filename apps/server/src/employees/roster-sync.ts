import { applyEmployee, hasSlot, makeStaff, normalizeSpec, people, removePerson, roster, type Employee } from '@office/shared';
import type { EmployeeRecord } from './employee-store';

// Making the office the staff list. The people in the office are the employees (named, with their department, shift, look and desk); this
// brings the running world in line with the list: new employees come in, changed ones are updated, ones who left go, and the made-up staff of
// an office that had no list yet are replaced by the real ones. Nobody who belongs to an account, or whom a human is driving, is removed.

/** A stored employee as the simulation knows them (a stored look is made valid again on the way). */
export function toEmployee(r: EmployeeRecord): Employee {
  return {
    userId: r.userId, firstName: r.firstName, lastName: r.lastName, department: r.department, intern: r.intern, shift: r.shift,
    character: r.character ? normalizeSpec(r.character) : null, desk: r.desk,
  };
}

/** Set the list the simulation uses for new staff (no list: made-up staff, as before). */
export function setRoster(records: readonly EmployeeRecord[]): void {
  roster.list = records.length ? records.map(toEmployee) : null;
}

export interface SyncResult {
  /** Employees who came into the office. */
  added: number;
  /** People whose details, look, shift or desk changed. */
  updated: number;
  /** Employees who left the company records. */
  removed: number;
  /** Made-up staff who made way for real ones. */
  replaced: number;
}

/** Bring the world in line with the staff list `records` (and make it the list new staff are taken from). */
export function syncRoster(records: readonly EmployeeRecord[]): SyncResult {
  const out: SyncResult = { added: 0, updated: 0, removed: 0, replaced: 0 };
  setRoster(records);
  const list = roster.list;
  if (!list) return out; // no list: the office is left as it is
  const byId = new Map(list.map(e => [e.userId, e]));
  // made-up staff make way for the real ones
  for (const p of [...people]) if (hasSlot(p) && !p.userId && removePerson(p)) out.replaced++;
  // employees who are no longer in the records
  for (const p of [...people]) if (p.userId && !byId.has(p.userId) && removePerson(p)) out.removed++;
  // everyone else is as the record says
  for (const p of people) {
    const e = p.userId ? byId.get(p.userId) : undefined;
    if (e && applyEmployee(p, e)) out.updated++;
  }
  // employees who are not in the office yet come in (one who has no desk to go to is skipped)
  for (let guard = 0; guard <= list.length; guard++) { if (!makeStaff()) break; out.added++; }
  return out;
}
