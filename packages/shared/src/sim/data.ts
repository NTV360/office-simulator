/* ================= People ================= */
export const FIRST = ['Ana', 'Marco', 'Liza', 'Paolo', 'Jessa', 'Carlo', 'Bea', 'Miguel', 'Trina', 'Rafa', 'Joy', 'Enzo', 'Kat', 'Nico', 'Mae', 'Gab', 'Ria', 'Jun', 'Dana', 'Leo', 'Cris', 'Pia', 'Ivan', 'Tess', 'Mark', 'Aya', 'Ben', 'Lara', 'Sam', 'Kim', 'Rico', 'Faye', 'Josh', 'Nina', 'Paul', 'Ella', 'Vince', 'Ivy', 'Ken', 'Rose', 'Arvin', 'Celine', 'Dino', 'Grace', 'Hans', 'Iris', 'Jomar', 'Kaye'];
export const LAST = 'ABCDEFGLMNPRSTVY';
const ROLES: [string, number][] = [['Developer', 10], ['QA Engineer', 2], ['Designer', 2], ['Product Manager', 2], ['DevOps', 2], ['Support', 1]];
export const roleBag: string[] = ROLES.flatMap(([r, n]) => Array<string>(n).fill(r));
export const VERB: Record<string, string> = { 'Developer': 'Coding', 'QA Engineer': 'Testing a build', 'Designer': 'Designing', 'UX/UI Designer': 'Designing screens', 'Product Manager': 'Writing specs', 'DevOps': 'Watching dashboards', 'Support': 'Answering tickets' };

export const CATS: Record<string, { name: string; color: string }> = {
  work: { name: 'At their desk', color: '#5a8fc7' },
  meeting: { name: 'In a meeting', color: '#55a274' },
  phone: { name: 'Phone booth', color: '#c9a246' },
  pantry: { name: 'Coffee & pantry', color: '#b97f4f' },
  lunch: { name: 'Lunch', color: '#d66f5a' },
  break: { name: 'Breaks & games', color: '#9a7cc4' },
  chat: { name: 'Chatting', color: '#33aeb0' },
  walk: { name: 'Walking', color: '#8796a2' },
};
