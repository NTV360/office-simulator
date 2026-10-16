// The coding classes in Conference 1 (sim/meetings.ts): a lesson's title, and the code the room's TV shows while it runs (apps/client/src/render/screens.js).
// This is `main`'s LESSONS list.
export interface Lesson { title: string; code: readonly string[] }
export const LESSONS: readonly Lesson[] = [
  { title: 'JavaScript basics', code: ['// Lesson 1: loops', "const names = ['Ana', 'Ben', 'Cy'];", '', 'for (const name of names) {', '  console.log(`Hi ${name}!`);', '}'] },
  { title: 'Git workflow', code: ['# Lesson 2: branches', '$ git checkout -b feature/login', '$ git add .', '$ git commit -m "Add login form"', '$ git push -u origin feature/login'] },
  { title: 'SQL joins', code: ['-- Lesson 3: joins', 'SELECT e.first_name, d.name', 'FROM employees e', 'JOIN departments d', '  ON d.id = e.department_id;'] },
  { title: 'TypeScript types', code: ['// Lesson 4: interfaces', 'interface Employee {', '  id: number;', '  name: string;', '  desk?: string;', '}'] },
];

/** The topic of a coding class on lesson `i` (the meeting's `topic`, which is what travels to every page). */
export const classTopic = (i: number): string => `${LESSONS[i].title} class`;
/** Which lesson a meeting topic is the class of, or null (it is any other meeting). */
export function lessonOf(topic: string): number | null { const i = LESSONS.findIndex((_, n) => classTopic(n) === topic); return i < 0 ? null : i; }
