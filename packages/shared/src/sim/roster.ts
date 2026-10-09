import type { CharacterSpec } from '../character/spec';
import type { Shift } from './schedule';

// The real staff list: who is in the office, from the employee records the server imports (see docs/PHASE-6-BREAKDOWN.md, step 4).
// `list` is null when there is none; then the factory makes up names, roles and desks, as it always did. (`main`'s `people/roster.js`.)

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
}

export const roster: { list: Employee[] | null } = { list: null };

// The activities, screens and looks key off a few role names (sim/data.ts ROLES). The staff list has no job titles (its roles are
// access levels), so map the department onto them: Graphics Design -> Designer, and so on.
const ROLE_WORDS: Array<[string, RegExp]> = [['DevOps', /devops|infra|sre|cloud|system/i], ['QA Engineer', /\bqa\b|quality|test/i], ['Designer', /design|ux|ui\b|creative|graphic/i],
  ['Product Manager', /product|project|manager|lead|head|director/i], ['Support', /support|customer|service|human|resource|\bhr\b|account|finance|sales/i], ['Developer', /dev|engineer|program|software|web|it\b/i]];
export const simRole = (department: string | null | undefined): string => ROLE_WORDS.find(([, re]) => re.test(department || ''))?.[0] ?? 'Developer';

export const fullName = (e: Pick<Employee, 'firstName' | 'lastName'>): string => `${e.firstName} ${e.lastName}`.trim();

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
