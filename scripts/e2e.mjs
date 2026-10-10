// End to end: phase 2 "done when". Starts its own copy of the whole stack (its own project, port and database, so it
// does not touch the one you run by hand), opens two browsers on it, changes the office through the admin API,
// restarts the server (politely, then with a hard kill) and checks the office comes back.   npm run e2e
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from '../tests/browser/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT) || 18080;
const TOKEN = 'e2e-admin-token';
process.env.VERIFY_ADMIN_TOKEN = TOKEN; // (the browser helpers make accounts the way an admin does)
const env = { ...process.env, COMPOSE_PROJECT_NAME: 'office-e2e', WEB_PORT: String(PORT), ADMIN_TOKEN: TOKEN, SAVE_INTERVAL_MS: '1000', WORLD_SEED: '' };
const base = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const compose = (...args) => spawnSync('docker', ['compose', ...args], { cwd: root, env, encoding: 'utf8' });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
const api = async (p, init) => (await fetch(base + p, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init?.headers ?? {}) } })).json();
const world = () => api('/api/world');

async function waitUp(label) {
  for (let i = 0; i < 90; i++) {
    try { const w = await world(); if (typeof w.tick === 'number' && w.persistence) return w; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`the stack did not come up (${label})`);
}

/** What a page currently holds: the server's keyframe picture, as names and positions. */
const keyframe = page => page.evaluate(async () => {
  const net = window.__sim.net;
  const want = Math.max(...[...net.trace.keys(), 0]);
  return { tick: want, people: net.trace.get(want) ?? [], names: window.__sim.people.filter(p => p.controller === 'ai').map(p => p.name).sort(), status: document.getElementById('netStatus')?.className, clock: window.__sim.sim.t, snapshots: net.snapshots };
});
const names = page => page.evaluate(() => window.__sim.people.filter(p => p.controller === 'ai').map(p => p.name).sort());

let browser;
try {
  console.log(`starting a fresh stack on ${base} (project office-e2e) ...`);
  compose('down', '-v');
  const up = compose('up', '--build', '-d');
  if (up.status !== 0) throw new Error('docker compose up failed:\n' + up.stderr);
  const first = await waitUp('first start');
  check('a fresh server starts a new office', first.persistence.enabled && !first.persistence.restored && first.staff === 40, `${first.staff} staff`);

  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const a = await openPage(browser, base, '?trace', { login: 'e2e_a' }), b = await openPage(browser, base, '?trace', { login: 'e2e_b' });
  await Promise.all([a, b].map(p => p.page.waitForFunction(() => window.__sim.net && window.__sim.net.snapshots > 30, null, { timeout: 20000 })));
  await sleep(2500);

  // 1. two browsers see the same office
  const [ka, kb] = [await keyframe(a.page), await keyframe(b.page)];
  check('two browsers show the same 40 people and the helper', ka.names.length === 41 && JSON.stringify(ka.names) === JSON.stringify(kb.names));
  const sameNow = (x, y) => x.people.length === y.people.length && x.people.every((p, i) => p[0] === y.people[i][0] && p[3] === y.people[i][3] && Math.abs(p[1] - y.people[i][1]) < 1e-4 && Math.abs(p[2] - y.people[i][2]) < 1e-4);
  const traces = [a, b].map(p => p.page.evaluate(() => [...window.__sim.net.trace.entries()]));
  const [ta, tb] = (await Promise.all(traces)).map(t => new Map(t));
  let common = 0, bad = 0;
  for (const [tick, people] of ta) { const o = tb.get(tick); if (o) { common++; if (!sameNow({ people }, { people: o })) bad++; } }
  check('at every shared keyframe their positions, states and tasks are identical', common >= 2 && bad === 0, `${common} keyframes`);

  // 2. change the office as an admin
  await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ slots: 30, speed: 3 }) });
  await sleep(3000);
  const changed = await Promise.all([names(a.page), names(b.page)]);
  check('both browsers follow the admin change (30 people and the helper)', changed[0].length === 31 && JSON.stringify(changed[0]) === JSON.stringify(changed[1]));
  const before = await keyframe(a.page);
  const beforeWorld = await world();
  await sleep(2500); // let a save happen

  // 3. a polite restart: the browsers reconnect by themselves and the same office is there
  console.log('restarting the server (graceful) ...');
  compose('restart', 'server');
  const after = await waitUp('after restart');
  check('the restarted server restored the saved office', after.persistence.restored && after.staff === 30 && after.speed === 3, `${after.staff} staff at ${after.speed}x`);
  check('the clock continued from where it stopped (never back, not far ahead)', after.simTime >= beforeWorld.simTime && after.simTime - beforeWorld.simTime < 30, `${beforeWorld.simTime.toFixed(1)} to ${after.simTime.toFixed(1)}`);
  await sleep(6000);
  const ra = await keyframe(a.page);
  check('the open browsers reconnected on their own and show the same 30 people', ra.status === 'ok' && JSON.stringify(ra.names) === JSON.stringify(before.names), `status ${ra.status}`);
  check('their clock carries on after the restart', ra.clock >= before.clock);
  const c = await openPage(browser, base, '?trace', { login: 'e2e_c' });
  await c.page.waitForFunction(() => window.__sim.net && window.__sim.net.snapshots > 5, null, { timeout: 20000 });
  check('a new browser sees the same people too', JSON.stringify(await names(c.page)) === JSON.stringify(before.names));
  // people are not all on one default spot
  const pos = await c.page.evaluate(() => window.__sim.people.filter(p => p.controller === 'ai').map(p => [p.name, p.pos.x, p.pos.z]));
  check('people did not all jump to a default place', new Set(pos.map(p => `${p[1].toFixed(1)},${p[2].toFixed(1)}`)).size > 15);

  // 4. a hard kill: no chance to save on the way out, so at most one save interval is lost
  console.log('killing the server (no goodbye) ...');
  const preKill = await world();
  await sleep(1500);
  compose('kill', 'server');
  compose('up', '-d', 'server');
  const afterKill = await waitUp('after kill');
  check('after a hard kill the office is still there', afterKill.persistence.restored && afterKill.staff === 30, `${afterKill.staff} staff`);
  check('the clock lost only about one save interval', Math.abs(afterKill.simTime - preKill.simTime) < 15, `${preKill.simTime.toFixed(1)} to ${afterKill.simTime.toFixed(1)}`);

  const errors = [...a.errors, ...b.errors, ...c.errors].filter(e => !/WebSocket|502|503|net::|Failed to load resource/i.test(e));
  check('no unexpected console errors in the browsers', errors.length === 0, errors[0] ?? '');
} catch (err) {
  check('the run completed', false, err.message);
} finally {
  await browser?.close();
  compose('down', '-v');
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
