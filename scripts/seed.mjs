// Test data for your own copy of the game:   npm run seed
// Against a RUNNING server (npm run dev:online does this for you the first time; the Docker stack on 16769 needs SEED_URL, see below). It is safe
// to run again: whatever is already there is left alone.
//   1. imports the employee records (the made-up company from `npm run dev:records`, or the real Supabase if the server is set up with it),
//   2. makes the accounts below, with a password you can type straight away (no "choose a new password" step),
//   3. links each account to an employee, so logging in plays that person (their name, desk and shift) and a look is saved for them,
//   4. makes one account with no employee ("guest1"), to try the guest flow.
// Only for your own PC: the passwords are public.
//   SEED_URL (default http://localhost:3000, the dev server; for the Docker stack: http://localhost:16769)
//   SEED_ADMIN_TOKEN (default dev-admin-token; the Docker stack in the docs uses local-admin-token)
const base = (process.env.SEED_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = process.env.SEED_ADMIN_TOKEN || 'dev-admin-token';
const PASSWORD = 'dev-pass-1234', FIRST = 'seed-first-pass-1';
const PLAYERS = [['ana', 'Ana Lopez'], ['ben', 'Ben Reyes'], ['cat', 'Cat Dizon'], ['dan', 'Dan Cruz']];
const LOOKS = { ana: { type: 'chibi', body: 'female', hair: { style: 'long', color: '#5a3a22' }, top: { style: 'tshirt', color: '#c45f4b' } }, ben: { type: 'blocky', body: 'male', hair: { style: 'short', color: '#1c1715' }, top: { style: 'tshirt', color: '#3e6e9c' } }, cat: { type: 'blocky', body: 'female', hair: { style: 'bun', color: '#222222' }, top: { style: 'tshirt', color: '#55a274' } }, dan: { type: 'chibi', body: 'male', hair: { style: 'buzz', color: '#3a2a1e' }, top: { style: 'tshirt', color: '#8a4f7d' } } };

const say = msg => console.log(msg);
const die = msg => { console.error('\n' + msg + '\n'); process.exit(1); };

async function call(method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null), cookie: (r.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ') };
}
const admin = (method, path, body) => call(method, '/api/admin' + path, body, { authorization: 'Bearer ' + TOKEN });

// ---- the server must be up
say(`seeding ${base} ...`);
for (let i = 0; ; i++) {
  const ok = await fetch(base + '/api/health').then(r => r.ok, () => false);
  if (ok) break;
  if (i > 60) die(`no server answers at ${base}. Start one first (npm run dev:online), or set SEED_URL.`);
  await new Promise(r => setTimeout(r, 1000));
}
if ((await admin('GET', '/settings')).status !== 200) die(`the admin API said no. Is the admin password right? (SEED_ADMIN_TOKEN, now "${TOKEN}"; the dev server uses dev-admin-token, the Docker stack in the docs local-admin-token)`);

// ---- 1. the employees
const status = (await admin('GET', '/import')).body;
const listed = (await admin('GET', '/employees')).body;
if (status?.configured && Array.isArray(listed) && listed.length > 0) {
  say(`  ${listed.length} employees are already in (the server imports them when it starts, and every few minutes)`);
} else if (status?.configured) {
  const r = await admin('POST', '/import', { force: true });
  say(r.status < 300 ? `  employees imported (${r.body.result.added} new, ${r.body.result.updated} changed)` : `  the import said: ${r.body?.message}`);
} else {
  say('  the server has no employee records connected (SUPABASE_URL / SUPABASE_SECRET_KEY): the office has made-up staff only.');
  say('  For a made-up company: run `npm run dev:records` and start the server with SUPABASE_URL=http://localhost:18090 SUPABASE_SECRET_KEY=dev-records-key');
  say('  (npm run dev:online does that by itself). Linking accounts to employees is skipped.');
}
const employees = (await admin('GET', '/employees')).body;
const byName = new Map(Array.isArray(employees) ? employees.map(e => [e.name, e]) : []);

// ---- 2 and 3. the accounts
const accountId = async username => ((await admin('GET', '/users')).body ?? []).find(a => a.username === username)?.id;
async function player(username, employeeName) {
  let made = (await admin('POST', '/users', { username, password: FIRST })).status;
  if (made >= 300 && made !== 409) die(`could not make ${username}: ${made}`);
  const id = await accountId(username);
  // a password of their own, so the first login goes straight in
  let login = await call('POST', '/api/auth/login', { username, password: PASSWORD });
  if (login.status !== 200) {
    const first = await call('POST', '/api/auth/login', { username, password: FIRST });
    if (first.status !== 200) die(`${username} exists but neither the seed password nor the first one works (an admin changed it?). Reset it on the admin page and run again.`);
    const changed = await call('POST', '/api/auth/password', { current: FIRST, next: PASSWORD }, { cookie: first.cookie });
    if (changed.status !== 200) die(`could not set a password for ${username}: ${changed.status} ${changed.body?.message ?? ''}`);
    login = await call('POST', '/api/auth/login', { username, password: PASSWORD });
  }
  let linked = '';
  const emp = employeeName ? byName.get(employeeName) : null;
  if (emp) {
    const r = await admin('POST', `/users/${id}/employee`, { employeeId: emp.userId });
    linked = r.status < 300 ? ` plays ${employeeName}` : r.status === 409 ? ` plays ${employeeName}` : ` (could not link to ${employeeName}: ${r.body?.message ?? r.status})`;
    // a look, so the first login is straight into the office
    const me = await call('GET', '/api/auth/me', undefined, { cookie: login.cookie });
    if (me.body?.account && !me.body.account.hasLook) await call('PUT', '/api/character', { spec: LOOKS[username] }, { cookie: login.cookie });
  }
  say(`  ${username}${linked}`);
}
for (const [username, name] of PLAYERS) await player(username, name);
await player('guest1', null);

say(`\ndone. Log in at ${base === 'http://localhost:3000' ? 'http://localhost:5173/?online' : base} with:`);
for (const [username, name] of PLAYERS) say(`  ${username.padEnd(7)} password ${PASSWORD}   ${byName.has(name) ? '(plays ' + name + ')' : '(no employee records: a guest until an admin gives a desk)'}`);
say(`  guest1  password ${PASSWORD}   (no employee: a guest until an admin gives a desk)`);
say('Open a private window for each extra player (the login belongs to the browser).\n');
