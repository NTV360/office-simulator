import { applyEmployee, hasSlot, makeStaff, normalizeSpec, people, removePerson, roster, validateRoster, type Employee } from '@office/shared';
import type { EmployeeRecord } from './employee-store';

// Making the office the staff list. The people in the office are the employees (named, with their department, shift, look and desk); this
// brings the running world in line with the list: new employees come in, changed ones are updated, ones who left go, and the made-up staff of
// an office that had no list yet are replaced by the real ones. Nobody who belongs to an account, or whom a human is driving, is removed.

/** A stored employee as the simulation knows them (a stored look is made valid again on the way). */
export function toEmployee(r: EmployeeRecord): Employee {
  return {
    userId: r.userId, firstName: r.firstName, lastName: r.lastName, department: r.department, intern: r.intern, shift: r.shift,
    character: r.character ? normalizeSpec(r.character) : null, desk: r.desk, photo: r.photo,
  };
}

/** Set the authoritative employee list; an empty list is a valid empty office. */
export function setRoster(records: readonly EmployeeRecord[]): void {
  const list = records.map(toEmployee);
  validateRoster(list);
  roster.list = list;
  roster.status = 'ready';
}

/** Mark the roster unavailable so no autonomous staff are created from an untrusted source. */
export function setRosterUnavailable(): void {
  roster.list = null;
  roster.status = 'unavailable';
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
  /** Roster employees currently represented by a desk-backed autonomous person. */
  assigned: number;
  /** Roster employees with no compatible free desk (or whose account-owned person has no desk). */
  unassigned: number;
  /** Stable ids of roster employees not currently represented by a desk-backed person. */
  unassignedUserIds: string[];
}

/** Bring the world in line with the staff list `records` (and make it the list new staff are taken from). */
export function syncRoster(records: readonly EmployeeRecord[]): SyncResult {
  const out: SyncResult = { added: 0, updated: 0, removed: 0, replaced: 0, assigned: 0, unassigned: 0, unassignedUserIds: [] };
  setRoster(records);
  const list = roster.list;
  if (!list) return out;
  const byId = new Map(list.map(e => [e.userId, e]));
  // Any legacy synthetic staff make way for roster-backed employees.
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
  const seated = new Set(people.filter(hasSlot).map(p => p.userId).filter((id): id is string => !!id));
  out.assigned = list.filter(e => seated.has(e.userId)).length;
  out.unassignedUserIds = list.filter(e => !seated.has(e.userId)).map(e => e.userId).sort();
  out.unassigned = out.unassignedUserIds.length;
  return out;
}
