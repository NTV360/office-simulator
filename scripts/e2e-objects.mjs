// End to end: phase 5 "done when", as items and physics have it now. Starts its own copy of the whole stack (its own project, port and database)
// and puts three players in it, in three real browsers: two have a desk each, one is a guest. They take hold of chairs and carry them (their own
// at a desk, a dining chair in a shared area) and put them down where they look, everybody sees every step, anyone may move anyone's things,
// "tidy my desk" puts a station back, and what was moved survives a polite restart and a hard kill. An admin sees what was moved and puts things
// back; a player who leaves while carrying loses what they carried.
//   npm run e2e:objects
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminCreate, adminJson, openPage, sleep, walkTo } from '../tests/browser/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT) || 18084;
const TOKEN = 'e2e-objects-admin-password';
process.env.VERIFY_ADMIN_TOKEN = TOKEN;
const env = { ...process.env, COMPOSE_PROJECT_NAME: 'office-e2e-objects', WEB_PORT: String(PORT), ADMIN_TOKEN: TOKEN, SAVE_INTERVAL_MS: '1000', GRACE_MS: '4000', WORLD_SEED: '', ADMIN_USERNAME: '', ADMIN_PASSWORD: '' };
const base = `http://localhost:${PORT}`;
const compose = (...args) => spawnSync('docker', ['compose', ...args], { cwd: root, env, encoding: 'utf8' });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) failures++; };
const admin = (method, p, body) => adminJson(base, method, p, body);
const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(300); } };

async function waitUp(label) {
  for (let i = 0; i < 90; i++) {
    try { const j = await (await fetch(base + '/api/health')).json(); if (j.status === 'ok' && j.db === 'ok') return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`the stack did not come up (${label})`);
}
const joined = page => page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person, null, { timeout: 60000 });
/** Where an object is on this page: { x, z, by } (by: who carries it, or null). */
const where = (page, index) => page.evaluate(i => { const o = window.__sim.objects.at(i); return { x: o.x, z: o.z, by: o.carriedBy, hx: o.home.x, hz: o.home.z }; }, index);
const moved = w => Math.hypot(w.x - w.hx, w.z - w.hz) > .2;
/**
 * Look down at the floor toward somewhere the chair may go, as a player would: turn the view until the ghost is green, trying the ways furthest
 * from where the chair started first (so moving it is something you can see). The page puts down where you look. Returns where it then aims.
 */
const aimSomewhere = async page => {
  const ways = await page.evaluate(() => {
    const s = window.__sim, p = s.player.person, o = s.objects.all().find(x => x.carriedBy === p.id); if (!o) return [];
    const out = [];
    for (let a = 0; a < Math.PI * 2; a += .3) { const x = p.pos.x + Math.sin(a), z = p.pos.z + Math.cos(a); if (!s.placementProblem(o, x, z, o.rot)) out.push({ a, d: Math.hypot(x - o.home.x, z - o.home.z) }); }
    return out.sort((u, v) => v.d - u.d).map(w => w.a);
  });
  for (const a of ways.slice(0, 10)) for (const pitch of [-.75, -.6, -.9]) {
    await page.evaluate(([a, pitch]) => { window.__sim.ctl.yaw = a; window.__sim.ctl.pitch = pitch; }, [a, pitch]);
    await sleep(350); // (the page aims a few times a second)
    const aim = await page.evaluate(() => window.__sim.objectAim);
    if (aim && aim.ok) return aim;
  }
  return null;
};

let browser;
try {
  console.log(`starting a fresh stack on ${base} (project office-e2e-objects) ...`);
  compose('down', '-v');
  const up = compose('up', '--build', '-d');
  if (up.status !== 0) throw new Error('docker compose up failed:\n' + up.stderr);
  await waitUp('first start');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // ---- 1. Ana and Ben have a desk each (an admin gives them out), Cat is a guest
  for (const n of ['obj_ana', 'obj_ben']) await adminCreate(base, n, 'first-pass-from-admin-1');
  const accounts = (await admin('GET', '/api/admin/users')).body;
  const desks = (await admin('GET', '/api/admin/slots')).body.filter(s => s.status === 'unclaimed');
  const deskOf = {};
  for (const [i, n] of ['obj_ana', 'obj_ben'].entries()) {
    const r = await admin('POST', `/api/admin/users/${accounts.find(a => a.username === n).id}/assign-slot`, { spot: desks[i * 9].spot });
    deskOf[n] = desks[i * 9].spot;
    if (r.status !== 201) throw new Error('could not give ' + n + ' a desk: ' + JSON.stringify(r.body));
  }
  const [A, B, C] = [await openPage(browser, base, '?trace', { login: 'obj_ana' }), await openPage(browser, base, '?trace', { login: 'obj_ben' }), await openPage(browser, base, '?trace', { login: 'obj_cat' })];
  for (const x of [A, B]) { // (an account with a desk and no look yet starts in the character lab: take the look it offers)
    await x.page.waitForSelector('#creator:not([hidden])', { timeout: 20000 });
    await x.page.click('#creatorSave');
  }
  await Promise.all([A, B, C].map(x => joined(x.page)));
  const mine = await A.page.evaluate(() => window.__sim.player.person.slot?.id);
  check('Ana and Ben are at their own desks, Cat is a guest', mine === deskOf.obj_ana && (await C.page.evaluate(() => !window.__sim.player.person.slot)), `${mine}`);
  const chairIndex = desk => A.page.evaluate(d => window.__sim.objects.all().find(o => o.station === d && o.type === 'chair-office').index, desk);
  const anaChair = await chairIndex(deskOf.obj_ana);

  // ---- 2. Ana walks to her chair, picks it up, puts it down somewhere else; the others see each step, and the seat goes with it
  await walkTo(A.page, `interactables.of('desk').find(s => s.id === '${deskOf.obj_ana}').approach`);
  const offer = await until(() => A.page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden && /Pick up the office chair/.test(b.textContent) ? b.textContent : null; }), 8000);
  check('at her desk the page offers her her own chair', !!offer, offer ?? 'no prompt');
  await A.page.keyboard.press('g');
  const held = await until(async () => { const w = await where(B.page, anaChair); return w.by !== null ? w : null; });
  check('Ben sees Ana pick up her chair', !!held);
  const aim = await aimSomewhere(A.page);
  await sleep(300);
  await A.page.keyboard.press('g');
  const put = await until(async () => { const w = await where(B.page, anaChair); return w.by === null && moved(w) ? w : null; });
  check('and sees it set down where Ana aimed', !!put && !!aim && Math.hypot(put.x - aim.x, put.z - aim.z) < .1, JSON.stringify({ put, aim }));
  const seatMoved = await B.page.evaluate(i => { const o = window.__sim.objects.at(i); const s = o.link.spot; return Math.hypot(s.pos.x - o.x, s.pos.z - o.z) < 1.2 && Math.hypot(s.pos.x - o.home.x, s.pos.z - o.home.z) > .15; }, anaChair);
  check('the seat went with the chair, on the other page too', seatMoved);

  // ---- 3. anyone may move anyone's things: Ben, at Ana's desk, is offered something of hers to pick up
  await walkTo(B.page, `interactables.of('desk').find(s => s.id === '${deskOf.obj_ana}').approach`);
  const benOffer = await until(() => B.page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden && /Pick up/.test(b.textContent) ? b.textContent : null; }), 8000);
  check('Ben, at Ana\'s desk, is offered her things to pick up too', !!benOffer, String(benOffer));

  // ---- 4. Cat, the guest, moves a dining chair in a shared area
  await walkTo(C.page, "interactables.of('dining')[0].approach");
  const diningIdx = await C.page.evaluate(() => window.__sim.objects.all().find(o => o.spot === 'dining:0').index);
  await until(() => C.page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden && /Pick up/.test(b.textContent); }), 8000);
  await C.page.keyboard.press('g');
  await until(async () => (await where(A.page, diningIdx)).by !== null);
  const catAim = await aimSomewhere(C.page);
  await sleep(300);
  await C.page.keyboard.press('g');
  const catPut = await until(async () => { const w = await where(A.page, diningIdx); return w.by === null && moved(w) ? w : null; });
  check('Cat moves a dining chair; Ana, far away, sees it where Cat put it', !!catPut && !!catAim && Math.hypot(catPut.x - catAim.x, catPut.z - catAim.z) < .4, JSON.stringify({ catPut, catAim }));

  // ---- 5. "tidy my desk" puts Ana's chair back (and not Cat's)
  await A.page.keyboard.press('t');
  const tidy = await until(async () => { const w = await where(B.page, anaChair); return w.by === null && !moved(w) ? w : null; });
  check('Ana tidies her desk: her chair is back where it started, for Ben too', !!tidy);
  check('and Cat\'s chair stays where Cat put it', moved(await where(A.page, diningIdx)));

  // ---- 6. a polite restart, then a hard kill: Cat's chair is still moved, everybody comes back
  const before = await where(C.page, diningIdx);
  console.log('restarting the server politely ...');
  compose('restart', 'server');
  await waitUp('after the restart');
  await Promise.all([A, B, C].map(x => joined(x.page)));
  const afterRestart = await until(async () => { const w = await where(B.page, diningIdx); return moved(w) && Math.hypot(w.x - before.x, w.z - before.z) < .01 ? w : null; }, 30000);
  check('after a restart Cat\'s chair is where she put it, on every page', !!afterRestart);
  await sleep(2500); // (a save)
  console.log('killing the server (SIGKILL) ...');
  compose('kill', '-s', 'SIGKILL', 'server');
  compose('up', '-d', 'server');
  await waitUp('after the kill');
  const afterKill = await until(async () => { const w = await where(A.page, diningIdx); return moved(w) && Math.hypot(w.x - before.x, w.z - before.z) < .01 ? w : null; }, 60000);
  check('and after a hard kill', !!afterKill);

  // ---- 7. the admin sees it, puts it back, and it is in the audit log
  const list = (await admin('GET', '/api/admin/objects')).body;
  const id = await C.page.evaluate(i => window.__sim.objects.at(i).id, diningIdx);
  check('the admin API lists exactly what is out of place', Array.isArray(list) && list.length === 1 && list[0].id === id, JSON.stringify(list));
  const reset = await admin('POST', '/api/admin/objects/reset', { object: id });
  check('putting it back works', reset.status === 201 && reset.body.reset === 1);
  const back = await until(async () => { const w = await where(A.page, diningIdx); return !moved(w) ? w : null; });
  check('and every page sees the chair go home', !!back);
  const audit = (await admin('GET', '/api/admin/audit')).body;
  check('it is in the audit log', audit.some(l => l.action === 'objects.reset' && l.target === id));

  // ---- 8. a player who leaves while carrying: what they carried goes home, and the others see it
  await walkTo(C.page, "interactables.of('dining')[0].approach"); // (a guest is not kept over a restart: Cat is back at the door)
  await until(() => C.page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden && /Pick up/.test(b.textContent); }), 10000);
  await C.page.keyboard.press('g');
  await until(async () => (await where(A.page, diningIdx)).by !== null);
  check('Cat picks the chair up again', (await where(A.page, diningIdx)).by !== null);
  await C.page.close();
  const dropped = await until(async () => { const w = await where(A.page, diningIdx); return w.by === null && !moved(w) ? w : null; }, 20000);
  check('Cat closes her browser while carrying: after the grace period the chair is home and nobody holds it', !!dropped);
  check('nothing is left out of place', (await admin('GET', '/api/admin/objects')).body.length === 0);

  const errors = [...A.errors, ...B.errors, ...C.errors].filter(e => !/401|403|Failed to load resource|WebSocket connection|502/.test(e));
  check('no unexpected console errors in the browsers', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (err) {
  console.error('\nTHE SCRIPT FAILED:', err);
  failures++;
} finally {
  if (browser) await browser.close();
  compose('down', '-v');
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
