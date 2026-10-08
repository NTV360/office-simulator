/* ================= People ================= */
const SKIN = ['#f3cfb0', '#e5b48f', '#c98f66', '#a46c48', '#7e5135', '#f6dcc6', '#d9a27a'];
const HAIR = ['#1b1817', '#2b201b', '#46302a', '#5f4330', '#26252f', '#8a5a3b', '#a8a198', '#3b2a22'];
const SHIRT = ['#3e6e9c', '#dfe4e8', '#2f4858', '#c45f4b', '#5f8f6e', '#e2b65c', '#7a6aa3', '#f4f3ef', '#3a7f86', '#9b4d62', '#e8875b', '#4c5c6b', '#88a9c3', '#b7c9a8'];
const PANTS = ['#263240', '#3b4250', '#5a5148', '#1f2328', '#4a5e78', '#7b6d5c', '#30363c'];
const SHOES = ['#1b1b1b', '#efefef', '#5b3a29', '#2d3742', '#9a8c7a'];
const STYLES = ['short', 'long', 'bun', 'buzz', 'curly', 'side', 'short', 'long'];
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

export { CATS, FIRST, HAIR, LAST, PANTS, SHIRT, SHOES, SKIN, STYLES, VERB, roleBag };
