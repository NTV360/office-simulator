import type { CharacterSpec } from '../character/spec';
import type { Shift } from './schedule';

// The authoritative staff list: every autonomous staff person comes from these employee records. A null list means the roster is unavailable;
// an empty list is a valid empty office and creates no staff.

/** One employee, as the importer hands them over. */
export interface Employee {
  /** The id in the employee records (a UUID). */
  userId: string;
  firstName: string;
  lastName: string;
  department: string | null;
  intern: boolean;
  shift: Shift | null;
  /** Their saved look, or null (then one is made from their id). */
  character: CharacterSpec | null;
  /** The desk they chose ('A3'), or null for any free desk. */
  desk: string | null;
  /** Their profile picture: an https address, or null/absent (then their initials are shown). */
  photo?: string | null;
}

export type RosterStatus = 'unavailable' | 'ready';
export const roster: { list: Employee[] | null; status: RosterStatus } = { list: null, status: 'unavailable' };
export const rosterReady = (): boolean => roster.status === 'ready';

/** Validate the identity keys before they can drive autonomous character creation. */
export function validateRoster(list: readonly Employee[]): void {
  const ids = new Set<string>();
  for (const employee of list) {
    if (!employee.userId.trim()) throw new Error('an employee is missing userId');
    if (ids.has(employee.userId)) throw new Error(`duplicate employee userId: ${employee.userId}`);
    ids.add(employee.userId);
  }
}

// The activities, screens and looks key off a few role names (sim/data.ts ROLES). The staff list has no job titles (its roles are
// access levels), so map the department onto them: Graphics Design -> Designer, and so on.
const ROLE_WORDS: Array<[string, RegExp]> = [['DevOps', /devops|infra|sre|cloud|system/i], ['QA Engineer', /\bqa\b|quality|test/i], ['Designer', /design|ux|ui\b|creative|graphic/i],
  ['Product Manager', /product|project|manager|lead|head|director/i], ['Support', /support|customer|service|human|resource|\bhr\b|account|finance|sales/i], ['Developer', /dev|engineer|program|software|web|it\b/i]];
export const simRole = (department: string | null | undefined): string => ROLE_WORDS.find(([, re]) => re.test(department || ''))?.[0] ?? 'Developer';

export const fullName = (e: Pick<Employee, 'firstName' | 'lastName'>): string => `${e.firstName} ${e.lastName}`.trim();

/** The input shape used by the canonical desk allocator. */
export interface DeskAllocationEmployee {
  userId: string;
  department?: string | null;
  desk?: string | null;
}

/** A desk identifier and the department allowed to use it, if it is restricted. */
export interface DeskAllocationDesk {
  deskId: string;
  department?: string | null;
}

const deskIdOrder = (a: string, b: string): number => {
  const parse = (id: string): [string, number, string] => {
    const match = /^(.*?)(\d+)$/.exec(id);
    return match ? [match[1], Number(match[2]), id] : [id, Number.POSITIVE_INFINITY, id];
  };
  const [ap, an, af] = parse(a), [bp, bn, bf] = parse(b);
  return ap.localeCompare(bp) || an - bn || af.localeCompare(bf);
};

/**
 * Allocate desks without depending on either input order or the order desks were registered.
 * Explicit eligible claims win first; remaining eligible restricted desks then ordinary desks
 * are assigned by canonical employee id order. `blockedDeskIds` represents desks occupied by
 * account/human-controlled people and is never reassigned.
 */
export function allocateDesks(
  employees: readonly DeskAllocationEmployee[],
  desks: readonly DeskAllocationDesk[],
  blockedDeskIds: readonly string[] = [],
): Map<string, string> {
  const seenEmployees = new Set<string>();
  for (const employee of employees) {
    if (!employee.userId.trim()) throw new Error('an employee is missing userId');
    if (seenEmployees.has(employee.userId)) throw new Error(`duplicate employee userId: ${employee.userId}`);
    seenEmployees.add(employee.userId);
  }
  const seenDesks = new Set<string>();
  for (const desk of desks) {
    if (!desk.deskId.trim()) throw new Error('a desk is missing deskId');
    if (seenDesks.has(desk.deskId)) throw new Error(`duplicate deskId: ${desk.deskId}`);
    seenDesks.add(desk.deskId);
  }
  const orderedEmployees = [...employees].sort((a, b) => a.userId.localeCompare(b.userId));
  const orderedDesks = [...desks].sort((a, b) => deskIdOrder(a.deskId, b.deskId));
  const used = new Set(blockedDeskIds);
  const assignments = new Map<string, string>();
  const byId = new Set<string>();
  const eligible = (employee: DeskAllocationEmployee, desk: DeskAllocationDesk): boolean =>
    !desk.department || desk.department === employee.department;

  // Claims are resolved first, making a claim stable even when another employee sorts first.
  for (const employee of orderedEmployees) {
    if (byId.has(employee.userId) || !employee.desk) continue;
    const desk = orderedDesks.find(d => d.deskId === employee.desk && !used.has(d.deskId) && eligible(employee, d));
    if (desk) {
      assignments.set(employee.userId, desk.deskId);
      used.add(desk.deskId);
      byId.add(employee.userId);
    }
  }

  for (const employee of orderedEmployees) {
    if (byId.has(employee.userId)) continue;
    const desk = orderedDesks.find(d => !used.has(d.deskId) && eligible(employee, d) && !!d.department)
      ?? orderedDesks.find(d => !used.has(d.deskId) && !d.department);
    if (desk) {
      assignments.set(employee.userId, desk.deskId);
      used.add(desk.deskId);
      byId.add(employee.userId);
    }
  }
  return assignments;
}

// What the person card says they are: "UI/UX Department", "HR Department", or "Intern UI/UX".
const SHORT: Record<string, string> = { 'Human Resources': 'HR', 'Internet of Things (IoT)': 'IoT', 'Frontend (FE)': 'Frontend' };
export function jobTitle(e: Pick<Employee, 'department' | 'intern'>): string {
  const dept = e.department ? SHORT[e.department] ?? e.department : null;
  if (e.intern) return dept ? `Intern ${dept}` : 'Intern';
  return dept ? `${dept} Department` : 'Staff';
}

/** Employees not yet in the office, in list order. */
export const unplacedEmployees = (people: ReadonlyArray<{ userId?: string | null }>): Employee[] => (roster.list ?? []).filter(e => !people.some(p => p.userId === e.userId));
export const employeeById = (userId: string): Employee | null => roster.list?.find(e => e.userId === userId) ?? null;
