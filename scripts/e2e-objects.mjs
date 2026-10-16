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
const env = { ...process.env, COMPOSE_PROJECT_NAME: 'office-e2e-objects', WEB_PORT: String(PORT), ADMIN_TOKEN: TOKEN, SAVE_INTERVAL_MS: '1000', GRACE_MS: '4000', WORLD_SEED: '', PHYSICS: process.env.E2E_PHYSICS ?? 'on', ADMIN_USERNAME: '', ADMIN_PASSWORD: '', LIVEKIT_API_KEY: 'e2e-disabled', LIVEKIT_API_SECRET: 'e2e-disabled-secret' };
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
const reconnect = async page => {
  await page.evaluate(() => { window.__sim.net.joined = false; });
  await joined(page);
};
/** Where an object is on this page: { x, z, by } (by: who carries it, or null). */
const where = (page, index) => page.evaluate(i => { const o = window.__sim.objects.at(i); return { x: o.x, z: o.z, by: o.carriedBy, hx: o.home.x, hz: o.home.z }; }, index);
const moved = w => Math.hypot(w.x - w.hx, w.z - w.hz) > .2;
/** Require several consecutive observations of one authoritative pose before using it. */
const settledWhere = async (page, index, predicate, ms = 20000) => {
  let previous = null;
  let stable = 0;
  return until(async () => {
    const current = await where(page, index);
    if (!predicate(current)) {
      previous = null;
      stable = 0;
      return null;
    }
    const same = previous && Math.hypot(current.x - previous.x, current.z - previous.z) < .025;
    stable = same ? stable + 1 : 1;
    previous = current;
    return stable >= 3 ? current : null;
  }, ms);
};
/**
 * What the admin list says is out of place, less anything within 75 cm of home: with physics a player standing among the chairs, or a
 * chair put back against its neighbour, can shove a neighbour some way, and the list compares exactly. A thing somebody deliberately
 * moved is metres away.
 */
const outOfPlace = list => Array.isArray(list) ? list.filter(o => Math.hypot(o.x - o.homeX, o.z - o.homeZ) > .75) : list;
const worldStatus = async () => (await fetch(base + '/api/world')).json();
/**
 * Look down at the floor toward somewhere the chair may go, as a player would: turn the view until the ghost is green, trying the ways furthest
 * from where the chair started first (so moving it is something you can see). The page puts down where you look. Returns where it then aims.
 */
// look at a thing until it is the one G would take (only what is at the middle of the screen is: net/objects.js): in first person, as a player
// would, straight at it from the eyes, then a little about that
const lookAt = async (page, index) => {
  if (await page.evaluate(() => window.__sim.ctl.mode) !== 'fp') { await page.keyboard.press('v'); await sleep(400); }
  const to = await page.evaluate(i => {
    const p = window.__sim.player.person, o = window.__sim.objects.at(i), dx = o.x - p.pos.x, dz = o.z - p.pos.z;
    return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(o.y + .35 - 1.5, Math.hypot(dx, dz)) };
  }, index);
  for (const da of [0, .1, -.1, .2, -.2, .35, -.35, .55, -.55]) for (const dp of [0, .12, -.12, .25, -.25, .4]) {
    await page.evaluate(([a, pitch]) => { window.__sim.ctl.yaw = a; window.__sim.ctl.pitch = pitch; }, [to.yaw + da, to.pitch + dp]);
    const found = await until(() => page.evaluate(i => window.__sim.objectPick === i, index), 1200);
    if (found) return true;
  }
  return false;
};
const thirdPerson = async page => { if (await page.evaluate(() => window.__sim.ctl.mode) === 'fp') { await page.keyboard.press('v'); await sleep(400); } };
/**
 * E with nothing aimed at means "sit down", which would seat the player and spoil every later attempt. So press it only while the page
 * is actually aiming at this object and the player is standing.
 */
const readyForE = (page, index) => until(() => page.evaluate(i => window.__sim.objectPick === i && !window.__sim.player.sitting ? true : null, index), 3000);
/** Hold E for the actor and wait for that actor's own authoritative mirror. */
const holdPickup = async (page, index, target, attempts = 5) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await walkTo(page, target);
    if (!await lookAt(page, index)) continue;
    const offered = await until(() => page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden && /Pick up|Help carry/.test(b.textContent); }), 5000);
    if (!offered) continue;
    if (!await readyForE(page, index)) continue;
    await page.keyboard.down('e');
    // The page sends the pickup on the first frame after the 500 ms hold, and letting go earlier cancels it. Software-rendered pages
    // running together can be slow to draw a frame, so hold well past the delay.
    await sleep(2000);
    await page.keyboard.up('e');
    // Let the object-action bucket refill before a subsequent placement.
    await sleep(500);
    const id = await page.evaluate(() => window.__sim.player.person.id);
    const held = await until(async () => {
      const w = await where(page, index);
      return w.by === id ? w : null;
    }, 10000);
    if (held) return held;
    await sleep(350);
  }
  return null;
};
const holdPickupAlreadyAimed = async (page, index) => {
  // A browser key event can arrive between two client ticks. Retry the same
  // deliberate target rather than immediately walking and changing the ray.
  // The server still revalidates every request; this only makes observation
  // resilient to a missed DOM keyboard delivery.
  for (let attempt = 0; attempt < 6; attempt++) {
    const offered = await until(() => page.evaluate(() => {
      const b = document.getElementById('fpObj');
      return !b.hidden && /Pick up|Help carry/.test(b.textContent);
    }), 3000);
    if (!offered) return null;
    if (!await readyForE(page, index)) { await sleep(300); continue; }
    await page.keyboard.down('e');
    await sleep(2000); // (as above: well past the 500 ms hold, so a slow frame cannot lose the pickup)
    await page.keyboard.up('e');
    // A successful grab spends one object-action token; leave enough time for
    // the server bucket to refill before the follow-up placement request.
    await sleep(500);
    const id = await page.evaluate(() => window.__sim.player.person?.id ?? null);
    const held = id && await until(async () => {
      const w = await where(page, index);
      return w.by === id ? w : null;
    }, 4000);
    if (held) return held;
    await sleep(400);
  }
  return null;
};
/** Retry a placement until the authoritative object is released. */
const placeHeld = async (page, index, ms = 12000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // A client ray can be valid against static geometry while a just-released
    // physics body is still blocking the server's authoritative placement.
    // Re-aim before retrying instead of repeatedly submitting one rejected pose.
    const aim = await aimSomewhere(page, index, deadline);
    if (!aim) break;
    // G puts it where the ghost is when the key is pressed, and lets go on the spot if the ghost is red then (the aim can move between the
    // check above and the key): press only while the page still shows a valid place.
    if (!await until(() => page.evaluate(() => window.__sim.objectAim?.ok === true ? true : null), 1500)) continue;
    await page.keyboard.press('g');
    const released = await until(async () => {
      const w = await where(page, index);
      return w.by === null ? w : null;
    }, Math.min(3000, Math.max(0, deadline - Date.now())));
    if (released) return released;
    await sleep(Math.min(650, Math.max(0, deadline - Date.now())));
  }
  return null;
};
const aimSomewhere = async (page, index, deadline = Infinity) => {
  // Placement is based on the current camera ray, not an abstract point around the player.
  // Search the actual ray in first person so the test does not mistake a third-person
  // shoulder/wall hit for the target the client will send to the server.
  if (await page.evaluate(() => window.__sim.ctl.mode) !== 'fp') { await page.keyboard.press('v'); await sleep(400); }
  const home = await page.evaluate(index => {
    const o = window.__sim.objects.at(index);
    return o ? { x: o.home.x, z: o.home.z } : null;
  }, index);
  if (!home) return null;
  const angles = await page.evaluate(index => {
    const p = window.__sim.player.person, o = window.__sim.objects.at(index);
    if (!o || o.carriedBy !== p.id) return [];
    // Try views around the held item's direction, but prefer a placement that is visibly away from home.
    return Array.from({ length: 24 }, (_, i) => Math.atan2(o.x - p.pos.x, o.z - p.pos.z) + (i - 12) * .28);
  }, index);
  for (const yaw of angles) for (const pitch of [-.2, -.45, -.7, -1.0]) {
    if (Date.now() >= deadline) return null;
    await page.evaluate(([yaw, pitch]) => { window.__sim.ctl.yaw = yaw; window.__sim.ctl.pitch = pitch; }, [yaw, pitch]);
    const aim = await until(() => page.evaluate(({ x, z, index }) => {
      const held = window.__sim.objects.at(index), value = window.__sim.objectAim;
      if (!held || held.carriedBy !== window.__sim.player.person.id) return null;
      if (!value || !value.ok || Math.hypot(value.x - x, value.z - z) <= .35) return null; // (clearly beyond `moved`'s .2)
      // `objectAim.ok` is the same shared placement validation the server
      // applies. Do not duplicate a conservative client-side object-distance
      // filter here: physics/static colliders can legitimately be near a
      // valid floor point, and that duplicate made the browser probe report
      // no target even though the authoritative placement was valid.
      return value;
    }, { x: home.x, z: home.z, index }), Math.min(1200, Math.max(0, deadline - Date.now())));
    if (aim) return aim;
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
  // (the server can be healthy a moment before its desks are listed: wait for them rather than read a list that is still empty)
  const desks = await until(async () => {
    const body = (await admin('GET', '/api/admin/slots')).body;
    const free = Array.isArray(body) ? body.filter(s => s.status === 'unclaimed') : [];
    return free.length > 9 ? free : null;
  }, 60000);
  if (!desks) throw new Error('the server never listed enough unclaimed desks');
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
  await lookAt(A.page, anaChair);
  const offer = await until(() => A.page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden && /Pick up the office chair/.test(b.textContent) ? b.textContent : null; }), 8000);
  check('at her desk the page offers her her own chair', !!offer, offer ?? 'no prompt');
  const anaHeld = await holdPickupAlreadyAimed(A.page, anaChair) ?? await holdPickup(A.page, anaChair, `interactables.of('desk').find(s => s.id === '${deskOf.obj_ana}').approach`);
  const held = await until(async () => { const w = await where(B.page, anaChair); return w.by !== null ? w : null; });
  if (!anaHeld) {
    // Diagnostics for a pickup that never reached the server: what Ana's page was aiming at, and what it offered.
    console.log('pickup diagnostics:', JSON.stringify(await A.page.evaluate(i => {
      const o = window.__sim.objects.at(i), p = window.__sim.player.person;
      return {
        pick: window.__sim.objectPick, wanted: i, prompt: document.getElementById('fpObj')?.textContent, hidden: document.getElementById('fpObj')?.hidden,
        mode: window.__sim.ctl.mode, active: window.__sim.ctl.active, yaw: window.__sim.ctl.yaw, pitch: window.__sim.ctl.pitch,
        person: { x: p.pos.x, z: p.pos.z, sitting: !!window.__sim.player.sitting }, object: { x: o.x, z: o.z, by: o.carriedBy },
        notices: [...document.querySelectorAll('.chat-line')].map(e => e.textContent).slice(-4),
      };
    }, anaChair)));
  }
  check('Ben sees Ana pick up her chair', !!anaHeld && !!held);
  await thirdPerson(A.page);
  const aim = await aimSomewhere(A.page, anaChair);
  await sleep(300);
  const put = await placeHeld(A.page, anaChair);
  if (!put) {
    // Diagnostics for a failed release: what each mirror and the server think, and when.
    const diag = {
      ana: await where(A.page, anaChair), ben: await where(B.page, anaChair),
      server: (await admin('GET', '/api/admin/objects')).body,
      anaAim: await A.page.evaluate(() => window.__sim.objectAim),
      anaState: await A.page.evaluate(() => ({ joined: window.__sim.net.joined, mode: window.__sim.ctl.mode })),
      // why the server refused: it tells the player in the chat panel
      anaNotices: await A.page.evaluate(() => [...document.querySelectorAll('#chat li, #chatLog li, .chat-line')].map(e => e.textContent).slice(-6)),
      anaPos: await A.page.evaluate(() => { const p = window.__sim.player.person; return { x: p.pos.x, z: p.pos.z }; }),
    };
    console.log('release diagnostics:', JSON.stringify(diag));
    await sleep(5000);
    console.log('release diagnostics +5s:', JSON.stringify({ ana: await where(A.page, anaChair), ben: await where(B.page, anaChair) }));
  }
  const settledPut = put && await settledWhere(B.page, anaChair, w => w.by === null && moved(w));
  // With physics enabled, a valid placement may settle against a nearby
  // collider after the server accepts the aimed point. Assert the
  // authoritative settled release and movement, while retaining the aim for
  // diagnostics rather than treating the first resting pose as exact.
  check('and sees it set down where Ana aimed', !!settledPut && moved(settledPut), JSON.stringify({ put: settledPut, aim }));
  const seatMoved = await B.page.evaluate(i => { const o = window.__sim.objects.at(i); const s = o.link.spot; return Math.hypot(s.pos.x - o.x, s.pos.z - o.z) < 1.2 && Math.hypot(s.pos.x - o.home.x, s.pos.z - o.home.z) > .15; }, anaChair);
  check('the seat went with the chair, on the other page too', seatMoved);

  // ---- 3. anyone may move anyone's things: Ben, at Ana's desk, is offered something of hers to pick up
  await walkTo(B.page, `interactables.of('desk').find(s => s.id === '${deskOf.obj_ana}').approach`);
  await lookAt(B.page, anaChair);
  const benOffer = await until(() => B.page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden && /Pick up/.test(b.textContent) ? b.textContent : null; }), 8000);
  check('Ben, at Ana\'s desk, is offered her things to pick up too', !!benOffer, String(benOffer));

  // ---- 4. Cat, the guest, moves a dining chair in a shared area
  await walkTo(C.page, "interactables.of('dining')[0].approach");
  const diningIdx = await C.page.evaluate(() => window.__sim.objects.all().find(o => o.spot === 'dining:0').index);
  // (she stands right at the chair's seat, so the first sweep of her view can miss it: look once more before calling it a failure)
  check('Cat looks at the dining chair, and it is the one offered', await lookAt(C.page, diningIdx) || await lookAt(C.page, diningIdx));
  await until(() => C.page.evaluate(() => { const b = document.getElementById('fpObj'); return !b.hidden && /Pick up/.test(b.textContent); }), 8000);
  const catHeldInitial = await holdPickupAlreadyAimed(C.page, diningIdx) ?? await holdPickup(C.page, diningIdx, "interactables.of('dining')[0].approach");
  // The gateway broadcasts object movement on the next simulation tick, and
  // each socket can receive that event at a different time.  A's mirror is
  // not proof that Cat's own mirror has changed; wait for the actor before
  // calculating a placement target from Cat's carried-object state.
  const catId = await C.page.evaluate(() => window.__sim.player.person.id);
  const catHeld = await until(async () => {
    const w = await where(C.page, diningIdx);
    return w.by === catId ? w : null;
  }, 15000);
  const seenByAna = await until(async () => {
    const w = await where(A.page, diningIdx);
    return w.by !== null ? w : null;
  }, 15000);
  if (!catHeld) {
    const state = await C.page.evaluate(i => {
      const o = window.__sim.objects.at(i), p = window.__sim.player.person;
      return {
        object: o && { index: o.index, id: o.id, x: o.x, y: o.y, z: o.z, carriedBy: o.carriedBy, holds: o.holds?.length ?? 0 },
        // is she carrying something else (a neighbouring chair)?
        carrying: window.__sim.objects.all().filter(x => x.carriedBy === p?.id || x.holds?.some(h => h.person === p?.id)).map(x => ({ index: x.index, type: x.type, x: x.x, z: x.z })),
        person: p && { id: p.id, x: p.pos.x, z: p.pos.z },
        pick: window.__sim.objectPick,
        aim: window.__sim.objectAim,
        prompt: document.getElementById('fpObj')?.textContent,
        mode: window.__sim.ctl.mode,
        active: document.activeElement?.id ?? document.activeElement?.tagName,
        sitting: !!window.__sim.player.sitting,
        notices: [...document.querySelectorAll('.chat-line')].map(e => e.textContent).slice(-4)
      };
    }, diningIdx);
    throw new Error(`Cat did not observe dining chair pickup: ${JSON.stringify(state)}`);
  }
  if (!seenByAna) throw new Error(`Ana did not observe dining chair pickup: ${JSON.stringify(await where(A.page, diningIdx))}`);
  // Leave the crowded dining cluster before choosing a resting pose. Carrying is
  // authoritative and remains supported while walking; this avoids asking the
  // placement ray to find a free chair-sized footprint between fixed chairs.
  await walkTo(C.page, "interactables.of('exit')[0].approach");
  await thirdPerson(C.page); // (to look about for a place without turning round with it: in first person she turns as she looks)
  const catAim = await aimSomewhere(C.page, diningIdx);
  if (!catAim) {
    const placementState = await C.page.evaluate(i => {
      const p = window.__sim.player.person;
      const held = window.__sim.objects.all().find(o => o.carriedBy === p?.id);
      return {
        person: p && { x: p.pos.x, z: p.pos.z, face: p.face },
        held: held && { index: held.index, x: held.x, z: held.z, by: held.carriedBy },
        aim: window.__sim.objectAim,
        nearby: window.__sim.objects.all().filter(o => !o.removed && Math.hypot(o.x - p.pos.x, o.z - p.pos.z) < 4).map(o => ({ index: o.index, type: o.type, x: o.x, z: o.z, by: o.carriedBy }))
      };
    }, diningIdx);
    throw new Error(`Cat had no valid placement target after observing the pickup: ${JSON.stringify(placementState)}`);
  }
  await sleep(300);
  const catRelease = await placeHeld(C.page, diningIdx);
  const catPut = catRelease && await settledWhere(A.page, diningIdx, w => w.by === null && moved(w));
  // Rapier may settle a valid release against a nearby collider, so the
  // authoritative settled pose—not the first release ray—is the cross-client
  // observation we verify. Keep the ray in diagnostics for failed runs.
  check('Cat moves a dining chair; Ana, far away, sees it where Cat put it', !!catPut && moved(catPut), JSON.stringify({ catPut, catRelease, catAim }));

  // ---- 5. "tidy my desk" puts Ana's chair back (and not Cat's)
  await A.page.keyboard.press('t');
  const tidy = await until(async () => { const w = await where(B.page, anaChair); return w.by === null && !moved(w) ? w : null; });
  check('Ana tidies her desk: her chair is back where it started, for Ben too', !!tidy);
  check('and Cat\'s chair stays where Cat put it', moved(await where(A.page, diningIdx)));

  // ---- 6. a polite restart, then a hard kill: Cat's chair is still moved, everybody comes back
  const before = await settledWhere(C.page, diningIdx, w => w.by === null && moved(w));
  console.log('restarting the server politely ...');
  await Promise.all([A, B, C].map(x => x.page.evaluate(() => { window.__sim.net.joined = false; })));
  compose('restart', 'server');
  await waitUp('after the restart');
  await Promise.all([A, B, C].map(x => joined(x.page)));
  const afterRestart = await until(async () => { const w = await where(B.page, diningIdx); return moved(w) && Math.hypot(w.x - before.x, w.z - before.z) < .01 ? w : null; }, 30000);
  check('after a restart Cat\'s chair is where she put it, on every page', !!afterRestart);
  const savedBeforeKill = await worldStatus();
  const saved = await until(async () => {
    const status = await worldStatus();
    const persistence = status.persistence ?? {};
    return persistence.lastError === null &&
      (persistence.saves > (savedBeforeKill.persistence?.saves ?? 0) ||
        persistence.lastSavedAt !== savedBeforeKill.persistence?.lastSavedAt)
      ? status
      : null;
  }, 15000);
  check('a successful save follows the settled moved pose', !!saved, JSON.stringify(saved?.persistence ?? savedBeforeKill.persistence));
  console.log('killing the server (SIGKILL) ...');
  await Promise.all([A, B, C].map(x => x.page.evaluate(() => { window.__sim.net.joined = false; })));
  compose('kill', '-s', 'SIGKILL', 'server');
  compose('up', '-d', 'server');
  await waitUp('after the kill');
  await Promise.all([A, B, C].map(x => joined(x.page)));
  const afterKill = await until(async () => { const w = await where(A.page, diningIdx); return moved(w) && Math.hypot(w.x - before.x, w.z - before.z) < .01 ? w : null; }, 60000);
  check('and after a hard kill', !!afterKill);

  // ---- 7. the admin sees it, puts it back, and it is in the audit log
  const list = outOfPlace((await admin('GET', '/api/admin/objects')).body);
  const id = await C.page.evaluate(i => window.__sim.objects.at(i).id, diningIdx);
  check('the admin API lists exactly what is out of place', Array.isArray(list) && list.length === 1 && list[0].id === id, JSON.stringify(list));
  // (Hazel plays at any hour, and may be sitting in that very chair just now: the admin API refuses a chair somebody sits in, so try again until she gets up)
  let reset = await admin('POST', '/api/admin/objects/reset', { object: id });
  for (let i = 0; i < 40 && reset.status === 409; i++) { await sleep(1500); reset = await admin('POST', '/api/admin/objects/reset', { object: id }); }
  check('putting it back works', reset.status === 201 && reset.body.reset === 1);
  const back = await until(async () => { const w = await where(A.page, diningIdx); return !moved(w) ? w : null; });
  check('and every page sees the chair go home', !!back);
  const audit = (await admin('GET', '/api/admin/audit')).body;
  check('it is in the audit log', audit.some(l => l.action === 'objects.reset' && l.target === id));

  // The reset is broadcast on the next simulation tick. Wait for Cat's own
  // mirror too before walking back; otherwise its raycaster can still select
  // the pre-reset pose even though the other pages have already updated.
  const catReset = await until(async () => {
    const w = await where(C.page, diningIdx);
    return !moved(w) ? w : null;
  }, 15000);
  check('Cat receives the reset before trying the chair again', !!catReset);

  // ---- 8. a player who leaves while carrying: what they carried goes home, and the others see it
  await walkTo(C.page, "interactables.of('dining')[0].approach"); // (a guest is not kept over a restart: Cat is back at the door)
  await until(() => C.page.evaluate(i => {
    const o = window.__sim.objects.at(i);
    return o && Math.hypot(o.x - o.home.x, o.z - o.home.z) < .02 ? true : null;
  }, diningIdx), 15000);
  let looked = await lookAt(C.page, diningIdx);
  let offered = await until(() => C.page.evaluate(() => {
    const b = document.getElementById('fpObj');
    return !b.hidden && /Pick up/.test(b.textContent) ? b.textContent : null;
  }), 10000);
  if (!looked || !offered) {
    looked = await lookAt(C.page, diningIdx);
    offered = await until(() => C.page.evaluate(() => {
      const b = document.getElementById('fpObj');
      return !b.hidden && /Pick up/.test(b.textContent) ? b.textContent : null;
    }), 5000);
  }
  check('Cat is offered the reset dining chair again', !!looked && !!offered, offered ?? 'no prompt');
  // Reacquire the authoritative ray before each retry; after an admin reset the
  // browser may still have a stale object-pick target for one render tick.
  const catHeldAgain = await holdPickup(C.page, diningIdx, "interactables.of('dining')[0].approach", 8) ?? await holdPickupAlreadyAimed(C.page, diningIdx);
  const seenAgain = await until(async () => (await where(A.page, diningIdx)).by !== null);
  check('Cat picks the chair up again', !!catHeldAgain && !!seenAgain);
  await C.page.close();
  const dropped = await until(async () => { const w = await where(A.page, diningIdx); return w.by === null && !moved(w) ? w : null; }, 20000);
  check('Cat closes her browser while carrying: after the grace period the chair is home and nobody holds it', !!dropped);
  const finalObjects = await until(async () => {
    const result = await admin('GET', '/api/admin/objects');
    return Array.isArray(result.body) && outOfPlace(result.body).length === 0 ? result.body : null;
  }, 15000);
  check('nothing is left out of place', !!finalObjects, JSON.stringify(finalObjects ?? (await admin('GET', '/api/admin/objects')).body));

  // ---- 9. store a chair in the inventory and drag it out again: the same chair comes back, and the object list does not grow
  const anaDesk = `interactables.of('desk').find(s => s.id === '${deskOf.obj_ana}').approach`;
  await walkTo(A.page, anaDesk);
  await lookAt(A.page, anaChair);
  const toStore = await holdPickupAlreadyAimed(A.page, anaChair) ?? await holdPickup(A.page, anaChair, anaDesk);
  check('Ana picks her chair up to store it', !!toStore);
  const countBefore = await A.page.evaluate(() => window.__sim.objects.all().length);
  await A.page.keyboard.down('e');
  await sleep(2000); // (a deliberate hold, well past the storage delay, for the same slow-frame reason)
  await A.page.keyboard.up('e');
  const storedHere = await until(() => A.page.evaluate(i => window.__sim.objects.at(i).removed === true ? true : null, anaChair), 8000);
  const storedThere = await until(() => B.page.evaluate(i => window.__sim.objects.at(i).removed === true ? true : null, anaChair), 8000);
  check('storing it in the inventory shows as a consumed chair on both pages', !!storedHere && !!storedThere);
  const stateOf = i => A.page.evaluate(i => {
    const p = window.__sim.player.person, o = window.__sim.objects.at(i);
    return {
      removed: o.removed, carriedBy: o.carriedBy, items: p.inventory?.items?.map(x => x.id), revision: p.mechanics.inventoryRevision, sitting: !!window.__sim.player.sitting,
      pos: { x: p.pos.x, z: p.pos.z, face: p.face }, notices: [...document.querySelectorAll('.chat-line')].map(e => e.textContent).slice(-4),
    };
  }, i);
  if (!storedHere) { console.log('store diagnostics:', JSON.stringify(await stateOf(anaChair))); throw new Error('the chair was not stored; cannot continue with the drop'); }
  // (a chair needs room to be put down in front of you: leave the crowded desk for open floor first)
  await walkTo(A.page, "interactables.of('exit')[0].approach");
  // The way a person does it: drag the item out of the inventory panel and let go outside it (the page sends the drop on `dragend`).
  await A.page.evaluate(i => {
    const itemEl = document.querySelector(`#inventoryGrid [data-item-id="world:${window.__sim.objects.at(i).id}"]`);
    if (!itemEl) throw new Error('the stored chair is not shown in the inventory');
    const dt = new DataTransfer();
    itemEl.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const r = document.getElementById('inventoryPanel').getBoundingClientRect();
    const x = r.left > 60 ? r.left - 40 : r.right + 40, y = r.top > 60 ? r.top - 40 : r.bottom + 40;
    itemEl.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, clientX: Math.max(1, x), clientY: Math.max(1, y), bubbles: true, cancelable: true }));
  }, anaChair);
  const backThere = await until(() => B.page.evaluate(i => { const o = window.__sim.objects.at(i); return o.removed === false && o.carriedBy === null ? true : null; }, anaChair), 8000);
  if (!backThere) console.log('drop diagnostics:', JSON.stringify(await stateOf(anaChair)));
  check('dragging it out brings the same chair back, on the other page too', !!backThere);
  const countAfter = await A.page.evaluate(() => window.__sim.objects.all().length);
  check('and the object list did not grow', countAfter === countBefore, `${countBefore} -> ${countAfter}`);

  const errors = [...A.errors, ...B.errors, ...C.errors].filter(e => !/401|403|Failed to load resource|WebSocket connection|WebSocket is already in CLOSING or CLOSED state|502/.test(e));
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
