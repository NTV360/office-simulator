// The real staff list from the API (persistence/store.js fetchEmployees), set by main.js before the sim starts.
// `list` is null when the API is unavailable; then the factory makes up names as before.
const roster = { list: null };

// Our activities, screens and looks key off a few role names (people/data.js ROLES). The staff list has no job
// titles (its roles are access levels), so map the department onto them: Graphics Design → Designer, and so on.
const ROLE_WORDS = [['DevOps', /devops|infra|sre|cloud|system/i], ['QA Engineer', /\bqa\b|quality|test/i], ['Designer', /design|ux|ui\b|creative|graphic/i],
  ['Product Manager', /product|project|manager|lead|head|director/i], ['Support', /support|customer|service|human|resource|\bhr\b|account|finance|sales/i], ['Developer', /dev|engineer|program|software|web|it\b/i]];
function simRole(department) { return ROLE_WORDS.find(([, re]) => re.test(department || ''))?.[0] ?? 'Developer'; }

const fullName = e => `${e.firstName} ${e.lastName}`.trim();

// What the person card says they are: "UI/UX Department", "HR Department", or "Intern UI/UX".
const SHORT = { 'Human Resources': 'HR', 'Internet of Things (IoT)': 'IoT', 'Frontend (FE)': 'Frontend' };
function jobTitle(e) {
  const dept = e.department ? SHORT[e.department] ?? e.department : null;
  if (e.intern) return dept ? `Intern ${dept}` : 'Intern';
  return dept ? `${dept} Department` : 'Staff';
}

// Employees not yet in the office, in list order.
function unplacedEmployees(people) { return (roster.list ?? []).filter(e => !people.some(p => p.userId === e.userId)); }
function employeeById(userId) { return roster.list?.find(e => e.userId === userId) ?? null; }

export { employeeById, fullName, jobTitle, roster, simRole, unplacedEmployees };
