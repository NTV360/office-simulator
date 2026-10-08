/* ================= People ================= */
const FIRST = ['Ana', 'Marco', 'Liza', 'Paolo', 'Jessa', 'Carlo', 'Bea', 'Miguel', 'Trina', 'Rafa', 'Joy', 'Enzo', 'Kat', 'Nico', 'Mae', 'Gab', 'Ria', 'Jun', 'Dana', 'Leo', 'Cris', 'Pia', 'Ivan', 'Tess', 'Mark', 'Aya', 'Ben', 'Lara', 'Sam', 'Kim', 'Rico', 'Faye', 'Josh', 'Nina', 'Paul', 'Ella', 'Vince', 'Ivy', 'Ken', 'Rose', 'Arvin', 'Celine', 'Dino', 'Grace', 'Hans', 'Iris', 'Jomar', 'Kaye'];
const LAST = 'ABCDEFGLMNPRSTVY';
const ROLES = [['Developer', 10], ['QA Engineer', 2], ['Designer', 2], ['Product Manager', 2], ['DevOps', 2], ['Support', 1]];
const roleBag = ROLES.flatMap(([r, n]) => Array(n).fill(r));
const VERB = { 'Developer': 'Coding', 'QA Engineer': 'Testing a build', 'Designer': 'Designing', 'Product Manager': 'Writing specs', 'DevOps': 'Watching dashboards', 'Support': 'Answering tickets' };

const CATS = {
  work: { name: 'At their desk', color: '#5a8fc7' },
  meeting: { name: 'In a meeting', color: '#55a274' },
  phone: { name: 'Phone booth', color: '#c9a246' },
  pantry: { name: 'Coffee & pantry', color: '#b97f4f' },
  lunch: { name: 'Lunch', color: '#d66f5a' },
  break: { name: 'Breaks & games', color: '#9a7cc4' },
  chat: { name: 'Chatting', color: '#33aeb0' },
  walk: { name: 'Walking', color: '#8796a2' },
};

export { CATS, FIRST, LAST, VERB, roleBag };
