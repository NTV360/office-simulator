// End to end: phase 3 "done when". Starts its own copy of the whole stack (its own project, port and database), and plays the story
// in real browsers: an admin makes an account, the person chooses a password and a character, logs in and drives their person,
// others see it, the server restarts in the middle (politely, then with a hard kill), they log out and the autopilot carries
// on, they log back in, an admin resets the password and disables the account.   npm run e2e:accounts
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminCreate, adminJson, openPage, personOf, sitDownSomewhere, sleep } from '../tests/browser/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT) || 18081;
const TOKEN = 'e2e-accounts-admin-password';
process.env.VERIFY_ADMIN_TOKEN = TOKEN;
const env = { ...process.env, COMPOSE_PROJECT_NAME: 'office-e2e-accounts', WEB_PORT: String(PORT), ADMIN_TOKEN: TOKEN, SAVE_INTERVAL_MS: '1000', GRACE_MS: '4000', WORLD_SEED: '', ADMIN_USERNAME: '', ADMIN_PASSWORD: '' };
const base = `http://localhost:${PORT}`;
const compose = (...args) => spawnSync('docker', ['compose', ...args], { cwd: root, env, encoding: 'utf8' });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
const admin = (method, p, body) => adminJson(base, method, p, body);
const post = (p, body, cookie) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

async function waitUp(label) {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(base + '/api/health'); const j = await r.json(); if (j.status === 'ok' && j.db === 'ok') return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`the stack did not come up (${label})`);
}
const joined = page => page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person, null, { timeout: 45000 });
const SHIRT = '#c45f4b';

let browser;
try {
  console.log(`starting a fresh stack on ${base} (project office-e2e-accounts) ...`);
  compose('down', '-v');
  const up = compose('up', '--build', '-d');
  if (up.status !== 0) throw new Error('docker compose up failed:\n' + up.stderr);
  await waitUp('first start');

  // ---- 1. an admin makes the accounts and gives one a desk
  const made = await admin('POST', '/api/admin/users', { username: 'ana' });
  const firstPassword = made.body?.password;
  check('an admin makes an account and is given its first password once', made.status === 201 && /^[A-Za-z0-9]{12}$/.test(firstPassword ?? ''));
  const anaId = made.body.account.id;
  const desk = (await admin('GET', '/api/admin/slots')).body.find(s => s.status === 'unclaimed');
  check('an admin gives it a desk', (await admin('POST', `/api/admin/users/${anaId}/assign-slot`, { spot: desk.spot })).status === 201, desk.place);
  check('nobody can make an account for themselves', (await post('/api/auth/register', { username: 'sneak', password: 'a-long-password-1' })).status === 404);

  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const watcher = await openPage(browser, base, '?trace', { login: 'e2e_watcher' });
  await joined(watcher.page);
  check('a guest watcher sees the office', (await watcher.page.evaluate(() => window.__sim.people.length)) >= 40);

  // ---- 2. Ana logs in with the first password, chooses her own, makes her character
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(`${base}/?trace`, { waitUntil: 'load' });
  await page.waitForSelector('#loginScreen', { timeout: 30000 });
  await page.fill('#loginName', 'ana'); await page.fill('#loginPass', firstPassword);
  await page.click('.login-form button[type=submit]');
  await page.waitForSelector('#loginNew', { timeout: 10000 });
  check('the first login asks her to choose her own password', true);
  await page.fill('#loginNew', 'Ana-chose-this-1'); await page.fill('#loginNew2', 'Ana-chose-this-1');
  await page.click('.login-form button[type=submit]');
  await page.waitForSelector('#creatorScreen', { timeout: 15000 });
  check('then character creation opens, because she has a desk and no look yet', true);
  await page.click(`[data-key="shirt"][data-color="${SHIRT}"]`); await page.click('[data-style="bun"]');
  await page.click('#creatorSave');
  await joined(page);
  const arrived = await page.evaluate(() => ({ view: window.__sim.viewId(), me: window.__sim.player.person.name, ctl: window.__sim.player.controlling, controller: window.__sim.player.person.controller }));
  check('she arrives as her own person in third person', arrived.view === 'third' && arrived.me === 'ana' && arrived.ctl && arrived.controller === 'account', JSON.stringify(arrived));
  await sleep(500);
  const seen0 = await personOf(watcher.page, 'ana');
  check('the watcher sees her wearing the look she chose', seen0 && seen0.shirt === SHIRT && seen0.style === 'bun' && seen0.controller === 'account');

  // ---- 3. she walks to the lounge and sits; the watcher sees both
  const start = await personOf(page, 'ana');
  const sat = await sitDownSomewhere(page);
  const seated = await personOf(page, 'ana');
  check('she walks across the office with the keyboard and sits down', sat && Math.hypot(seated.x - start.x, seated.z - start.z) > 2 && seated.task === 'playerSit', `${Math.hypot(seated.x - start.x, seated.z - start.z).toFixed(1)} m`);
  await watcher.page.waitForFunction(() => { const p = window.__sim.people.find(x => x.name === 'ana'); return p && p.task && p.task.kind === 'playerSit'; }, null, { timeout: 8000 }).then(() => check('the watcher sees her seated', true), () => check('the watcher sees her seated', false));
  await sleep(2500); // a save

  // ---- 4. the server restarts politely while she is playing
  console.log('restarting the server (graceful) ...');
  compose('restart', 'server');
  await waitUp('after restart');
  await page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person && !document.getElementById('loginScreen'), null, { timeout: 60000 }).then(
    () => check('her browser reconnects by itself, with no login screen', true), () => check('her browser reconnects by itself, with no login screen', false));
  const afterRestart = await personOf(page, 'ana');
  check('she is still her own person, driven by her, wearing her look', afterRestart && afterRestart.id === seated.id && afterRestart.controller === 'account' && afterRestart.shirt === SHIRT, JSON.stringify(afterRestart));
  const users = (await admin('GET', '/api/admin/users')).body;
  const ana = users.find(u => u.username === 'ana');
  check('her account, desk and look survived the restart', ana && ana.slotSpot === desk.spot && ana.hasLook && !ana.mustChangePassword);

  // ---- 5. she logs out; after the grace period the autopilot has her person, and everyone sees it
  await page.click('#accountBox button:last-child');
  await page.waitForSelector('#loginScreen', { timeout: 8000 });
  await watcher.page.waitForFunction(() => { const p = window.__sim.people.find(x => x.name === 'ana'); return p && p.controller === 'ai'; }, null, { timeout: 60000 }).then(
    () => check('after logging out, her person carries on by itself and the watcher sees that', true), () => check('after logging out, her person carries on by itself and the watcher sees that', false));
  const carrying = await personOf(watcher.page, 'ana');
  check('it still wears her look', carrying && carrying.shirt === SHIRT && carrying.style === 'bun');

  // ---- 6. she logs back in with her own password: same person, no character page again
  await page.fill('#loginName', 'ana'); await page.fill('#loginPass', 'Ana-chose-this-1');
  await page.click('.login-form button[type=submit]');
  await joined(page);
  const again = await personOf(page, 'ana');
  check('logging back in gives her the same person back, and no second character page', again && again.id === seated.id && again.controller === 'account' && !(await page.$('#creatorScreen')));

  // ---- 7. a hard kill: she is back by herself, still logged in
  console.log('killing the server (no goodbye) ...');
  await sleep(1500);
  compose('kill', 'server');
  compose('up', '-d', 'server');
  await waitUp('after kill');
  await page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person && !document.getElementById('loginScreen'), null, { timeout: 60000 }).then(
    () => check('after a hard kill her session is still good and she is back without logging in', true), () => check('after a hard kill her session is still good and she is back without logging in', false));
  const afterKill = (await admin('GET', '/api/admin/users')).body.find(u => u.username === 'ana');
  check('her account, desk and look are still there', afterKill && afterKill.slotSpot === desk.spot && afterKill.hasLook);

  // ---- 8. an admin resets her password: she is thrown out and must choose a new one
  const reset = await admin('POST', `/api/admin/users/${anaId}/password`, {});
  check('an admin resets her password and gets the new one once', reset.status === 201 && /^[A-Za-z0-9]{12}$/.test(reset.body?.password ?? ''));
  await page.waitForSelector('#loginScreen', { timeout: 15000 }).then(() => check('her browser is sent back to the login screen at once', true), () => check('her browser is sent back to the login screen at once', false));
  check('her old password no longer works', (await post('/api/auth/login', { username: 'ana', password: 'Ana-chose-this-1' })).status === 401);
  await page.fill('#loginName', 'ana'); await page.fill('#loginPass', reset.body.password);
  await page.click('.login-form button[type=submit]');
  await page.waitForSelector('#loginNew', { timeout: 10000 }).then(() => check('the new password makes her choose her own again', true), () => check('the new password makes her choose her own again', false));
  await page.fill('#loginNew', 'Ana-chose-again-2'); await page.fill('#loginNew2', 'Ana-chose-again-2');
  await page.click('.login-form button[type=submit]');
  await joined(page);
  check('and she is back in her person', (await personOf(page, 'ana'))?.id === seated.id);

  // ---- 9. an admin disables the account: thrown out, cannot log in; enabling lets her back
  await admin('POST', `/api/admin/users/${anaId}/disabled`, { disabled: true });
  await page.waitForSelector('#loginScreen', { timeout: 15000 }).then(() => check('disabling the account sends her to the login screen', true), () => check('disabling the account sends her to the login screen', false));
  check('a disabled account cannot log in', (await post('/api/auth/login', { username: 'ana', password: 'Ana-chose-again-2' })).status === 403);
  await admin('POST', `/api/admin/users/${anaId}/disabled`, { disabled: false });
  check('enabling it lets her log in again', (await post('/api/auth/login', { username: 'ana', password: 'Ana-chose-again-2' })).status === 200);

  // ---- 10. the audit log has all of it, and no passwords
  const log = (await admin('GET', '/api/admin/audit?limit=100')).body;
  const actions = new Set(log.map(l => l.action));
  check('the audit log recorded the admin actions', ['account.create', 'desk.assign', 'password.set', 'account.disable', 'account.enable'].every(a => actions.has(a)), [...actions].join(', '));
  const text = JSON.stringify(log);
  check('and no password is in it', ![firstPassword, reset.body.password, 'Ana-chose-this-1', 'Ana-chose-again-2'].some(p => text.includes(p)));

  const bad = [...errors, ...watcher.errors].filter(e => !/WebSocket|502|503|net::|Failed to load resource|401|403/i.test(e));
  check('no unexpected console errors in the browsers', bad.length === 0, bad[0] ?? '');
} catch (err) {
  check('the run completed', false, err.stack ?? err.message);
} finally {
  await browser?.close();
  compose('down', '-v');
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
