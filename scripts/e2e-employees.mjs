// End to end: phase 6 step 4. Starts its own copy of the whole stack (its own project, port and database) next to a FAKE copy of the company's
// employee records (a small web server on this PC that answers like the real one), and plays the story: the office is made of the staff list, an
// admin links an account to an employee, the account plays that employee under their own name, a hard kill brings everything back, the records
// change and the office follows, the clock goes Live and follows who is clocked in, and the secret key is nowhere it should not be.
//   npm run e2e:employees
import http from 'node:http';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminCreate, adminJson, openPage, sleep } from '../tests/browser/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT) || 18083;
const FAKE = Number(process.env.E2E_FAKE_PORT) || 18090;
const TOKEN = 'e2e-employees-admin-password';
const KEY = 'fake-secret-key-that-must-not-leak';
process.env.VERIFY_ADMIN_TOKEN = TOKEN;
const env = {
  ...process.env, COMPOSE_PROJECT_NAME: 'office-e2e-employees', WEB_PORT: String(PORT), ADMIN_TOKEN: TOKEN, SAVE_INTERVAL_MS: '1000', GRACE_MS: '4000', WORLD_SEED: '',
  ADMIN_USERNAME: '', ADMIN_PASSWORD: '', SUPABASE_URL: `http://host.docker.internal:${FAKE}`, SUPABASE_SECRET_KEY: KEY, EMPLOYEE_IMPORT_MS: '86400000', ATTENDANCE_MS: '1500',
};
const base = `http://localhost:${PORT}`;
const compose = (...args) => spawnSync('docker', ['compose', ...args], { cwd: root, env, encoding: 'utf8' });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
const admin = (method, p, body) => adminJson(base, method, p, body);

// ---- the fake employee records
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const employee = (n, first, last, dept, extra = {}) => ({ user_id: id(n), first_name: first, last_name: last, employment_type_id: 1, shift_id: 10, department: dept ? { name: dept } : null, ...extra });
const records = {
  employees: [
    employee(1, 'Hazel', 'Sellote', 'UI/UX'), employee(2, 'Ana', 'Lopez', 'UI/UX'), employee(3, 'Ben', 'Reyes', 'Quality Assurance'),
    employee(4, 'Cat', 'Dizon', 'Human Resources'), employee(5, 'Dan', 'Cruz', 'DevOps', { shift_id: 11 }), employee(6, 'Eve', 'Santos', 'UI/UX', { employment_type_id: 2 }),
  ],
  employment_types: [{ employment_type_id: 1, code: 'REG', description: 'Regular' }, { employment_type_id: 2, code: 'OJT', description: 'On the job training' }],
  shifts: [{ shift_id: 10, code: 'DAY', start_time: '09:00:00', end_time: '18:00:00' }, { shift_id: 11, code: 'NIGHT', start_time: '21:00:00', end_time: '06:00:00' }],
  character_information: [{ user_id: id(4), character_data: { type: 'blocky', body: 'female', hair: { style: 'bun', color: '#222222' }, desk: 'HR1' } }],
  attendances: [],
};
const asked = []; // what the server asked the fake records for
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.split('/').pop();
  asked.push({ table, select: url.searchParams.get('select'), key: req.headers.apikey, auth: req.headers.authorization });
  if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401).end('{}'); return; }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(records[table] ?? []));
});
await new Promise(r => fake.listen(FAKE, '0.0.0.0', r));

async function waitUp(label) {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(base + '/api/health'); const j = await r.json(); if (j.status === 'ok' && j.db === 'ok') return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`the stack did not come up (${label})`);
}
async function until(fn, ms = 30000) { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(500); } }
const staffNames = async page => page.evaluate(() => window.__sim.people.filter(p => p.controller === 'ai' || p.controller === 'account').map(p => p.name).sort());
const joined = page => page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person, null, { timeout: 45000 });

let browser;
try {
  console.log(`starting a fresh stack on ${base} (project office-e2e-employees), records on port ${FAKE} ...`);
  compose('down', '-v');
  const up = compose('up', '--build', '-d');
  if (up.status !== 0) throw new Error('docker compose up failed:\n' + up.stderr);
  await waitUp('first start');

  // ---- 1. the office is the staff list
  const imported = await until(async () => { const s = (await admin('GET', '/api/admin/import')).body; return s.lastImportOk ? s : null; });
  check('the server imported the employee records at start-up', !!imported && imported.configured, imported ? JSON.stringify(imported.lastResult) : 'no import');
  const list = (await admin('GET', '/api/admin/employees')).body;
  check('the staff list has the six employees, with their departments', list.length === 6 && list.find(e => e.name === 'Cat Dizon')?.department === 'Human Resources', list.map(e => e.name).join(', '));
  const world = await (await fetch(base + '/api/world')).json();
  check('the office has exactly those six people (the made-up staff made way)', world.staff === 6, `staff ${world.staff}`);
  const cat = list.find(e => e.name === 'Cat Dizon');
  check('Cat chose a desk in the records: she sits in the HR office at HR1', cat.seat === 'HR1' && cat.hasLook === true, `seat ${cat.seat}`);
  check('the HR employee is the only one in the HR office', list.filter(e => /^HR/.test(e.seat ?? '')).map(e => e.name).join() === 'Cat Dizon');
  check('Dan, on the night shift, is not in the building at this time of day', list.find(e => e.name === 'Dan Cruz').present === false);

  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const watcher = await openPage(browser, base, '?trace', { login: 'e2e_watcher' });
  await joined(watcher.page);
  const names = await staffNames(watcher.page);
  check('a watcher sees the same six names, and the title of each (their department)', names.filter(n => n !== 'e2e_watcher').join() === 'Ana Lopez,Ben Reyes,Cat Dizon,Dan Cruz,Eve Santos,Hazel Sellote', names.join());
  const titles = await watcher.page.evaluate(() => Object.fromEntries(window.__sim.people.map(p => [p.name, p.title])));
  check('Eve is an intern, Ben is QA', titles['Eve Santos'] === 'Intern UI/UX' && titles['Ben Reyes'] === 'Quality Assurance Department', JSON.stringify(titles));
  const hazel = await watcher.page.evaluate(() => { const h = window.__sim.people.find(p => p.name === 'Hazel Sellote'); return h && h.spec.angry; });
  check('Hazel is whoever has that name, with her furious face', hazel === true);

  // ---- 2. an account that plays an employee
  await adminCreate(base, 'ana_e2e', 'first-pass-from-admin-1');
  await adminCreate(base, 'ben_e2e', 'first-pass-from-admin-1');
  const accounts = (await admin('GET', '/api/admin/users')).body;
  const anaId = accounts.find(a => a.username === 'ana_e2e').id, benId = accounts.find(a => a.username === 'ben_e2e').id;
  const linked = await admin('POST', `/api/admin/users/${anaId}/employee`, { employeeId: id(2) });
  check('an admin links the account to the employee Ana Lopez', linked.status === 201 && linked.body.person === 'Ana Lopez', JSON.stringify(linked.body));
  const second = await admin('POST', `/api/admin/users/${benId}/employee`, { employeeId: id(2) });
  check('the same employee cannot be linked to a second account', second.status === 409);

  const me = await openPage(browser, base, '?trace', { login: 'ana_e2e' });
  const labShown = await me.page.waitForSelector('#creator:not([hidden])', { timeout: 20000 }).then(() => true, () => false);
  check('her first login opens the character lab (the employee has no look yet)', labShown);
  await me.page.click('#creatorSave');
  await me.page.waitForFunction(() => document.getElementById('creator').hidden && window.__sim.net.joined && window.__sim.player.person, null, { timeout: 30000 });
  const mine = await me.page.evaluate(() => { const p = window.__sim.player.person; return { name: p.name, controller: p.controller, title: p.title, desk: p.slot?.deskId }; });
  check('she plays Ana Lopez, under that name, at that employee\'s desk', mine.name === 'Ana Lopez' && mine.controller === 'account' && !!mine.desk, JSON.stringify(mine));
  const seenBy = await until(async () => watcher.page.evaluate(() => { const p = window.__sim.people.find(x => x.name === 'Ana Lopez'); return p && p.controller === 'account'; }));
  check('the watcher sees Ana Lopez driven by a player (and no one named ana_e2e)', !!seenBy && !(await staffNames(watcher.page)).includes('ana_e2e'));
  const savedLook = (await admin('GET', '/api/admin/employees')).body.find(e => e.name === 'Ana Lopez');
  check('the look she made is on the employee\'s record (hasLook)', savedLook.hasLook === true && savedLook.account?.username === 'ana_e2e');

  // ---- 3. a hard kill: the office, the link and her person come back
  console.log('killing the server (SIGKILL) ...');
  compose('kill', '-s', 'SIGKILL', 'server');
  compose('up', '-d', 'server');
  await waitUp('after the kill');
  const after = (await admin('GET', '/api/admin/employees')).body;
  check('after the kill: still six, and the account is still linked to Ana Lopez', after.length === 6 && after.find(e => e.name === 'Ana Lopez')?.account?.username === 'ana_e2e');
  const worldAfter = await (await fetch(base + '/api/world')).json();
  check('and the office is still exactly those people', worldAfter.staff === 6, `staff ${worldAfter.staff}`);
  await me.page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person && window.__sim.player.person.name === 'Ana Lopez', null, { timeout: 60000 }).then(() => check('she reconnects by herself and is Ana Lopez again', true), () => check('she reconnects by herself and is Ana Lopez again', false));

  // ---- 4. the records change; the office follows (and the account's person stays)
  records.employees[1].first_name = 'Anna'; // Ana is renamed
  records.employees.splice(2, 1); // Ben leaves
  records.employees.push(employee(7, 'Gus', 'Tan', 'DevOps')); // Gus joins
  const imp = await admin('POST', '/api/admin/import', {});
  check('an admin imports the changed records', imp.status === 201 && imp.body.result.added === 1 && imp.body.result.removed === 1, JSON.stringify(imp.body.result));
  const names2 = await until(async () => { const n = await staffNames(watcher.page); return n.includes('Gus Tan') && !n.includes('Ben Reyes') ? n : null; });
  check('the watcher sees Gus come in and Ben go, and Ana renamed, while she is playing', !!names2 && names2.includes('Anna Lopez'), names2 ? names2.join() : 'no change');
  const stillMine = await me.page.evaluate(() => window.__sim.player.person.name);
  check('she is still the same person (now Anna Lopez)', stillMine === 'Anna Lopez', stillMine);
  const empty = await (async () => { const keep = records.employees.splice(0); const r = await admin('POST', '/api/admin/import', {}); records.employees.push(...keep); return r; })();
  check('an empty answer from the records is refused and nobody is removed', empty.status === 409 && (await (await fetch(base + '/api/world')).json()).staff === 6);

  // ---- 5. Live: the clock follows the real time and who is clocked in
  const now = new Date(Date.now() - 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  records.attendances.push({ employee_id: id(2), clock_in: now, clock_out: null }, { employee_id: id(6), clock_in: now, clock_out: null });
  const live = await admin('PUT', '/api/admin/settings', { clockMode: 'live' });
  check('the clock goes Live, for the whole office', live.status === 200 && live.body.clockMode === 'live' && live.body.attendance === true, JSON.stringify(live.body));
  const absent = await until(async () => watcher.page.evaluate(() => { const p = window.__sim.people.find(x => x.name === 'Hazel Sellote'); return p && p.absent === true && p.state === 'away'; }));
  check('Hazel, not clocked in, is not in the office ("Not in today")', !!absent);
  const evePresent = await until(async () => watcher.page.evaluate(() => { const p = window.__sim.people.find(x => x.name === 'Eve Santos'); return p && p.absent === false && p.state !== 'away'; }));
  check('Eve, clocked in an hour ago, is in', !!evePresent);
  records.attendances.push({ employee_id: id(1), clock_in: new Date().toISOString().slice(0, 19).replace('T', ' '), clock_out: null });
  const hazelIn = await until(async () => watcher.page.evaluate(() => { const p = window.__sim.people.find(x => x.name === 'Hazel Sellote'); return p && p.absent === false && p.state !== 'away'; }), 30000);
  check('when Hazel clocks in she walks in (the records are read again every few seconds)', !!hazelIn);
  const back = await admin('PUT', '/api/admin/settings', { clockMode: 'sim' });
  check('and Simulate comes back, starting the day', back.body.clockMode === 'sim');

  // ---- 6. the secret
  const leaks = [];
  for (const p of ['/api/admin/import', '/api/admin/audit', '/api/admin/employees', '/api/admin/settings', '/api/admin/users', '/api/health', '/api/world']) {
    const r = await admin('GET', p);
    if (JSON.stringify(r.body).includes(KEY)) leaks.push(p);
  }
  check('the secret key is in no answer of the API', leaks.length === 0, leaks.join());
  const logs = compose('logs', 'server', '--no-color').stdout ?? '';
  check('and not in the server\'s log', !logs.includes(KEY));
  const page = await (await fetch(base + '/')).text();
  check('and not in the web page', !page.includes(KEY));
  check('the server asked the records for names, shifts and looks only, with the key as a header', asked.length > 5 && asked.every(a => a.key === KEY) && asked.filter(a => a.table === 'employees').every(a => a.select === 'user_id,first_name,last_name,employment_type_id,shift_id,department:departments(name)'), asked.filter(a => a.table === 'employees')[0]?.select);

  const errors = [...watcher.errors, ...me.errors].filter(e => !/401|403|Failed to load resource|WebSocket connection|502/.test(e)); // (the hard kill makes the connections fail for a moment)
  check('no unexpected console errors in the browsers', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (err) {
  console.error('\nTHE SCRIPT FAILED:', err);
  failures++;
} finally {
  if (browser) await browser.close();
  fake.close();
  compose('down', '-v');
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
