// End to end: phase 4 "done when". Starts its own copy of the whole stack (its own project, port and database) and puts three players in
// it, in three real browsers: they walk (with prediction), sit, see each other's names, talk (only those nearby hear), wave, and see
// the same office (the same people doing the same things), with a server restart (polite, then a hard kill) in the middle. An admin mutes one of them.   npm run e2e:together
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminJson, openPage, personOf, sitDownSomewhere, sleep, walkTo } from '../tests/browser/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT) || 18082;
const TOKEN = 'e2e-together-admin-password';
process.env.VERIFY_ADMIN_TOKEN = TOKEN;
const env = { ...process.env, COMPOSE_PROJECT_NAME: 'office-e2e-together', WEB_PORT: String(PORT), ADMIN_TOKEN: TOKEN, SAVE_INTERVAL_MS: '1000', GRACE_MS: '4000', WORLD_SEED: '', ADMIN_USERNAME: '', ADMIN_PASSWORD: '' };
const base = `http://localhost:${PORT}`;
const compose = (...args) => spawnSync('docker', ['compose', ...args], { cwd: root, env, encoding: 'utf8' });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
const admin = (method, p, body) => adminJson(base, method, p, body);

async function waitUp(label) {
  for (let i = 0; i < 90; i++) {
    try { const j = await (await fetch(base + '/api/health')).json(); if (j.status === 'ok' && j.db === 'ok') return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`the stack did not come up (${label})`);
}
const joined = page => page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person, null, { timeout: 60000 });
const lines = page => page.$$eval('#chatLog .chat-line', els => els.map(e => e.textContent));
const typeChat = async (page, text) => { await page.keyboard.press('Enter'); await page.waitForSelector('#chatInput', { state: 'visible', timeout: 5000 }); await page.keyboard.type(text); await page.keyboard.press('Enter'); };
const hears = (page, text) => page.waitForFunction(t => [...document.querySelectorAll('#chatLog .chat-line')].some(e => e.textContent.includes(t)), text, { timeout: 8000 }).then(() => true, () => false);

let browser;
try {
  console.log(`starting a fresh stack on ${base} (project office-e2e-together) ...`);
  compose('down', '-v');
  const up = compose('up', '--build', '-d');
  if (up.status !== 0) throw new Error('docker compose up failed:\n' + up.stderr);
  await waitUp('first start');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // ---- 1. three players join (accounts made the way an admin makes them)
  const [A, B, C] = [await openPage(browser, base, '?trace', { login: 'tog_ana' }), await openPage(browser, base, '?trace', { login: 'tog_ben' }), await openPage(browser, base, '?trace', { login: 'tog_cat' })];
  await Promise.all([A, B, C].map(x => joined(x.page)));
  check('three players are in the office, each steering their own person', (await Promise.all([A, B, C].map(x => x.page.evaluate(() => window.__sim.viewId() === 'third' && window.__sim.player.controlling)))).every(Boolean));

  // ---- 2. names over the other players, none over the autopilot people or yourself
  await sleep(1200);
  const tagInfo = await C.page.evaluate(() => ({
    ana: !!window.__sim.people.find(p => p.name === 'tog_ana')?.nameTag, ben: !!window.__sim.people.find(p => p.name === 'tog_ben')?.nameTag,
    me: !!window.__sim.player.person.nameTag, npc: window.__sim.people.filter(p => p.controller === 'ai' && p.nameTag).length,
  }));
  check('name labels show over the other two, not over yourself or the autopilot people', tagInfo.ana && tagInfo.ben && !tagInfo.me && tagInfo.npc === 0, JSON.stringify(tagInfo));

  // ---- 3. Cat walks to the dining area (far away); prediction agrees with the server
  const catStart = await personOf(C.page, 'tog_cat');
  await walkTo(C.page, "interactables.of('dining')[0].approach");
  await sleep(800);
  const pred = await C.page.evaluate(() => { const p = window.__sim.player.person, s = p._buf[p._buf.length - 1]; return { ...window.__sim.net.pred, gap: Math.hypot(p.pos.x - s.x, p.pos.z - s.z) }; });
  const catEnd = await personOf(C.page, 'tog_cat');
  check('Cat walked a long way with the keys and the server never had to snap her back', Math.hypot(catEnd.x - catStart.x, catEnd.z - catStart.z) > 15 && pred.acks > 20 && pred.snaps === 0 && pred.gap < 0.5, `${Math.hypot(catEnd.x - catStart.x, catEnd.z - catStart.z).toFixed(0)} m, ${pred.pulls} pulls, ${pred.acks} acks`);

  // ---- 4. Ana and Ben sit down in the lounge; everyone sees them seated
  const anaSat = await sitDownSomewhere(A.page);
  const benSat = await sitDownSomewhere(B.page);
  check('Ana and Ben each walk to the lounge and sit', anaSat && benSat);
  const seenSeated = await C.page.waitForFunction(() => ['tog_ana', 'tog_ben'].every(n => { const p = window.__sim.people.find(x => x.name === n); return p && p.task && p.task.kind === 'playerSit'; }), null, { timeout: 10000 }).then(() => true, () => false);
  check('Cat, far away, sees them both seated', seenSeated);

  // ---- 5. talking: Ben speaks; Ana (near) hears it and a bubble shows; Cat (far) does not
  await typeChat(B.page, 'hello Ana, shall we start?');
  check('Ana, sitting nearby, hears Ben', await hears(A.page, 'tog_ben hello Ana'));
  const bubble = await A.page.evaluate(() => !!window.__sim.people.find(p => p.name === 'tog_ben')?.bubble);
  check('a speech bubble shows over Ben', bubble);
  await sleep(500);
  check('Cat, far away, hears nothing', (await lines(C.page)).filter(l => l.includes('hello Ana')).length === 0);

  // ---- 6. a wave, seen by everyone
  await A.page.keyboard.press('1');
  const wavedB = await B.page.waitForFunction(() => window.__sim.people.find(p => p.name === 'tog_ana')?.emote?.kind === 'wave', null, { timeout: 8000 }).then(() => true, () => false);
  const wavedC = await C.page.waitForFunction(() => window.__sim.people.find(p => p.name === 'tog_ana')?.emote?.kind === 'wave', null, { timeout: 8000 }).then(() => true, () => false);
  check('Ana waves and both the others see it, near or far', wavedB && wavedC);

  // ---- 7. the same office on every page: the same people, with the same jobs, almost all doing the same thing at the same moment
  const look = page => page.evaluate(() => window.__sim.people.map(p => [p.name, p.title || '', p.shown, p.task ? p.task.kind : '']).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  const [pa, pb, pc] = [await look(A.page), await look(B.page), await look(C.page)];
  check('all three pages list the same people', pa.length >= 40 && pa.map(p => p[0]).join('|') === pb.map(p => p[0]).join('|') && pa.map(p => p[0]).join('|') === pc.map(p => p[0]).join('|'), `${pa.length}, ${pb.length} and ${pc.length} people`);
  const differ = (x, y) => x.filter((p, i) => JSON.stringify(p) !== JSON.stringify(y[i])).length;
  check('and almost everyone is doing the same thing on each', differ(pa, pb) <= 4 && differ(pa, pc) <= 4, `${differ(pa, pb)} and ${differ(pa, pc)} differ`);

  // ---- 8. the server restarts politely: all three come back by themselves and can still talk
  console.log('restarting the server (graceful) ...');
  compose('restart', 'server');
  await waitUp('after restart');
  await Promise.all([A, B, C].map(x => joined(x.page)));
  check('all three browsers reconnected by themselves, with no login screen', (await Promise.all([A, B, C].map(x => x.page.$('#loginScreen')))).every(e => !e));
  await sleep(1500);
  await typeChat(B.page, 'back after the restart');
  check('chat works again after the restart', await hears(A.page, 'back after the restart'));

  // ---- 9. a hard kill
  console.log('killing the server (no goodbye) ...');
  compose('kill', 'server');
  compose('up', '-d', 'server');
  await waitUp('after kill');
  await Promise.all([A, B, C].map(x => joined(x.page)));
  await sleep(1500);
  await A.page.keyboard.press('2');
  check('after a hard kill all three are back, and an emote still reaches the others', await B.page.waitForFunction(() => window.__sim.people.find(p => p.name === 'tog_ana')?.emote?.kind === 'cheer', null, { timeout: 10000 }).then(() => true, () => false));

  // ---- 10. an admin mutes Ben: he can still play, nobody sees what he types; unmuting brings him back at once
  const benId = (await admin('GET', '/api/admin/users')).body.find(u => u.username === 'tog_ben').id;
  await admin('POST', `/api/admin/users/${benId}/muted`, { muted: true });
  await sleep(400);
  await typeChat(B.page, 'can anyone hear me');
  const told = await hears(B.page, 'muted');
  await sleep(500);
  check('a muted Ben is told so and Ana sees nothing', told && (await lines(A.page)).every(l => !l.includes('can anyone hear me')));
  await admin('POST', `/api/admin/users/${benId}/muted`, { muted: false });
  await sleep(600);
  await typeChat(B.page, 'unmuted again');
  check('unmuting brings him back at once', await hears(A.page, 'unmuted again'));

  // ---- 11. Ana logs out: everyone sees it in the activity log, and her person is gone after the grace period
  await A.page.click('#accountBox button:last-child');
  await A.page.waitForSelector('#loginScreen', { timeout: 8000 });
  const sawLeave = await C.page.waitForFunction(() => window.__sim.log.some(l => l.msg.includes('tog_ana left')), null, { timeout: 10000 }).then(() => true, () => false);
  check('the others see "tog_ana left" in the activity log', sawLeave);
  const gone = await C.page.waitForFunction(() => !window.__sim.people.find(p => p.name === 'tog_ana'), null, { timeout: 30000 }).then(() => true, () => false);
  check('and her person is gone from their office after the grace period', gone);

  const bad = [A, B, C].flatMap(x => x.errors).filter(e => !/WebSocket|502|503|net::|Failed to load resource|401|403/i.test(e));
  check('no unexpected console errors in the browsers', bad.length === 0, bad[0] ?? '');
} catch (err) {
  check('the run completed', false, err.stack ?? err.message);
} finally {
  await browser?.close();
  compose('down', '-v');
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
