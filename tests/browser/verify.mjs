// Browser verification for the simulation refactor (phase 1). See docs/PHASE-1-BREAKDOWN.md, step 0.
//
//   npm run verify:browser            quick check: seeds 1 to 3 against the recorded golden fingerprints
//   npm run verify:browser:thorough   all ten recorded seeds (use at the end of each phase 1 step)
//   npm run verify:browser:record     (re)record all ten: only when a change is MEANT to alter behaviour
//
// It serves the freshly built client (or uses VERIFY_URL if you already have a site running), loads it in
// headless Chromium with ?seed=N, steps the simulation to fixed points in the day with __sim.advance(),
// and compares __sim.fingerprint() with tests/browser/golden/seed-N.json. It then visits every camera view,
// saves a screenshot of each to tests/browser/out/, and fails if the browser console shows any error.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminCreate, adminJson, collectErrors, freePort, openPage, personOf, sitDownSomewhere, sleep, startSite, walkTo } from './site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const goldenDir = path.join(root, 'tests/browser/golden');
const outDir = path.join(root, 'tests/browser/out');
const record = process.argv.includes('--record');
const screenshotOf = (page, name) => page.screenshot({ path: path.join(outDir, name) }).catch(() => {});

const ALL_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const thorough = process.argv.includes('--thorough');
const SEEDS = record || thorough ? ALL_SEEDS : [1, 2, 3];
const CHECKPOINTS = [0, 600, 3000, 12000, 36000]; // steps from the start (0.05 s of sim time each at 1x)
const VIEWS = ['angle', 'top', 'follow', 'fp', 'third', 'angle'];

let failures = 0;
const fail = msg => { failures++; console.log('  FAIL  ' + msg); };
const pass = msg => console.log('  ok    ' + msg);

// Step the simulation to each checkpoint and return the fingerprints.
async function runSeed(browser, url, seed) {
  const { page, errors } = await openPage(browser, url, `?seed=${seed}`);
  const prints = [], mesh = [];
  let done = 0;
  for (const cp of CHECKPOINTS) {
    prints.push(await page.evaluate(n => { window.__sim.advance(n); return window.__sim.fingerprint(); }, cp - done));
    done = cp;
    // the meshes must show exactly what the people's state says (let two frames render first; the sim is paused)
    const bad = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
      const out = [], keys = ['mug', 'phone', 'pad', 'guitar', 'putter'];
      for (const p of window.__sim.people) {
        if (p.controller !== 'ai') continue; // the player's own body belongs to the camera
        if (p.body.root.visible !== p.shown || p.body.ring.visible !== p.shown) out.push(p.name + ': body shown ' + p.body.root.visible + ' but state says ' + p.shown);
        for (const k of keys) if (p.body[k].visible !== p.props[k]) out.push(p.name + ': ' + k + ' mesh ' + p.body[k].visible + ' but state says ' + p.props[k]);
      }
      out.push(...window.__sim.screenMismatches());
      res(out.slice(0, 4));
    }))));
    mesh.push(...bad.map(b => 'step ' + cp + ' ' + b));
  }
  await page.close();
  return { prints, errors, mesh };
}

// First few differences between two plain JSON values.
function diffs(expected, actual, where = '', out = []) {
  if (out.length >= 8) return out;
  if (typeof expected !== typeof actual || Array.isArray(expected) !== Array.isArray(actual) || expected === null || actual === null) {
    if (expected !== actual) out.push(`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return out;
  }
  if (typeof expected !== 'object') {
    if (expected !== actual) out.push(`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return out;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of keys) diffs(expected[k], actual[k], where ? `${where}.${k}` : k, out);
  return out;
}

// ---- main
const site = await startSite();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  console.log(`${record ? 'Recording' : 'Verifying'} the simulation under seeds ${SEEDS.join(', ')} at steps ${CHECKPOINTS.join(', ')}\n`);
  fs.mkdirSync(goldenDir, { recursive: true });

  // the committed layout data (what the server loads) must equal what the client's own furniture code builds
  if (!record) {
    console.log('office layout data');
    const { page: lp, errors: le } = await openPage(browser, site.url, '?seed=1');
    const live = JSON.parse(JSON.stringify(await lp.evaluate(() => window.__sim.layoutData())));
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'packages/shared/src/layout/office.json'), 'utf8'));
    const d = diffs(saved, live);
    if (!d.length) pass(`the client\'s furniture matches packages/shared/src/layout/office.json (${live.spots.length} spots, ${live.obstacles.length} obstacles)`);
    else fail('the layout data is stale; run npm run layout:dump. First differences:\n          ' + d.join('\n          '));
    le.forEach(e => fail(e));
    await lp.close();
  }

  for (const seed of SEEDS) {
    console.log(`seed ${seed}`);
    const first = await runSeed(browser, site.url, seed);
    first.errors.forEach(e => fail(e));
    first.mesh.forEach(e => fail('meshes disagree with state, ' + e));
    if (!first.mesh.length) pass('meshes (visibility, held props and desk screens) match the simulation state at every checkpoint');

    if (record) {
      const second = await runSeed(browser, site.url, seed); // the recording itself must be repeatable
      const d = diffs(first.prints, second.prints);
      if (d.length) { fail('two runs of the same seed differ, so it cannot be recorded:\n          ' + d.join('\n          ')); continue; }
      fs.writeFileSync(path.join(goldenDir, `seed-${seed}.json`), JSON.stringify({ seed, steps: CHECKPOINTS, fingerprints: first.prints }, null, 1) + '\n');
      pass(`recorded (hashes ${first.prints.map(p => p.hash).join(' ')})`);
      continue;
    }

    const file = path.join(goldenDir, `seed-${seed}.json`);
    if (!fs.existsSync(file)) { fail(`no recording at ${path.relative(root, file)}; run npm run verify:browser:record`); continue; }
    const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
    CHECKPOINTS.forEach((cp, i) => {
      const d = diffs(golden.fingerprints[i], first.prints[i]);
      if (!d.length) pass(`step ${String(cp).padStart(5)}  matches  (${first.prints[i].hash})`);
      else fail(`step ${cp} differs from the recording:\n          ` + d.join('\n          '));
    });
  }

  // a player in the office must not change the staff: same seed, player present, same recorded fingerprints
  if (!record) {
    console.log('\nwith a player present');
    const g = JSON.parse(fs.readFileSync(path.join(goldenDir, 'seed-1.json'), 'utf8'));
    const { page: pp, errors: pe } = await openPage(browser, site.url, '?seed=1');
    const present = await pp.evaluate(() => { window.__sim.setView('third'); return { inList: window.__sim.people.includes(window.__sim.player.person), controller: window.__sim.player.person.controller }; });
    if (present.inList && present.controller === 'account') pass('the player is in the people list as an account-controlled person');
    else fail('the player is not in the list as expected ' + JSON.stringify(present));
    let done = 0;
    for (let i = 0; i < CHECKPOINTS.length; i++) {
      const fp = await pp.evaluate(n => { window.__sim.advance(n); return window.__sim.fingerprint(); }, CHECKPOINTS[i] - done);
      done = CHECKPOINTS[i];
      const d = diffs(g.fingerprints[i], fp);
      if (!d.length) pass(`step ${String(CHECKPOINTS[i]).padStart(5)}  staff unchanged with the player present  (${fp.hash})`);
      else fail(`step ${CHECKPOINTS[i]}: the player changed the staff:\n          ` + d.join('\n          '));
    }
    pe.forEach(e => fail(e));
    await pp.close();
  }

  // every camera view loads without errors; a screenshot of each is saved for a human to glance at
  console.log('\ncamera views');
  fs.mkdirSync(outDir, { recursive: true });
  const { page, errors } = await openPage(browser, site.url);
  await page.waitForFunction(() => !window.__sim.net || (window.__sim.net.joined && window.__sim.viewId() === 'third'), null, { timeout: 30000 }); // (online: you arrive as your person, in third person)
  let n = 0;
  for (const v of VIEWS) {
    await page.evaluate(view => window.__sim.setView(view), v);
    await sleep(700);
    const now = await page.evaluate(() => window.__sim.viewId());
    if (now === v) pass(`view ${v}`); else fail(`asked for view ${v} but the app is in ${now}`);
    await page.screenshot({ path: path.join(outDir, `${String(++n).padStart(2, '0')}-${v}.png`) });
  }
  errors.forEach(e => fail(e));
  if (!errors.length) pass('no errors in the browser console');
  await page.close();

  // a scripted play-through of what people actually do, so code the recordings never reach (positions being
  // copied and measured, following, walking, sitting, jumping to areas, Hazel) is exercised too
  console.log('\ninteraction scenario');
  {
    const { page: sp, errors: serr } = await openPage(browser, site.url, '?seed=1');
    const ev = (fn, arg) => sp.evaluate(fn, arg);
    const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));

    // the jump-to buttons move the camera to plan positions
    for (const area of ['pantry', 'booths', 'desks', 'meeting', 'lounge', 'golf']) {
      await ev(a => document.querySelector('[data-go="' + a + '"]').click(), area);
    }
    ok((await ev(() => window.__sim.viewId())) === 'free', 'the jump-to buttons work and leave you in the free camera');

    // select someone and follow them
    const followed = await ev(() => {
      const S = window.__sim, p = S.people.find(x => x.controller === 'ai' && x.state !== 'away');
      S.select(p); document.getElementById('pFollow').click();
      return p.name;
    });
    await sleep(900);
    const fol = await ev(() => {
      const S = window.__sim, p = S.following();
      // the camera EASES toward its goal (slowly in a headless browser), so check the goal, which is set on the person every frame
      return { view: S.viewId(), name: p && p.name, d: p ? Math.hypot(S.camGoal.target.x - p.pos.x, S.camGoal.target.z - p.pos.z) : -1 };
    });
    ok(fol.view === 'follow' && fol.name === followed && fol.d >= 0 && fol.d < 0.05, 'following ' + followed + ': the camera is aimed at them (' + fol.d.toFixed(3) + ' m off)');

    // walk as the player, sit at a dining seat, stand again
    await ev(() => window.__sim.setView('fp'));
    const start = await ev(() => { const p = window.__sim.player.person; return { x: p.pos.x, z: p.pos.z }; });
    await sp.keyboard.down('w'); await sleep(1500); await sp.keyboard.up('w');
    const moved = await ev(s => { const p = window.__sim.player.person; return Math.hypot(p.pos.x - s.x, p.pos.z - s.z); }, start);
    ok(moved > 0.2, 'walking forward moves the player (' + moved.toFixed(2) + ' m)');
    await ev(() => {
      const S = window.__sim, seat = S.interactables.of('dining')[0], pos = S.player.person.pos;
      pos.copy(seat.pos); pos.x += 0.3; pos.z += 0.1;
    });
    await sleep(400);
    await sp.keyboard.press('e'); await sleep(250);
    ok(await ev(() => !!window.__sim.player.sitting && window.__sim.player.person.task?.kind === 'playerSit'), 'pressing E sits at the nearest seat');
    await sp.keyboard.press('e'); await sleep(250);
    ok(await ev(() => !window.__sim.player.sitting), 'pressing E again stands up');

    // third person, the shoulder swap, and out again
    await sp.keyboard.press('v'); await sleep(300);
    ok((await ev(() => window.__sim.viewId())) === 'third', 'V switches to third person');
    const side0 = await ev(() => window.__sim.tp.side);
    await sp.keyboard.press('c'); await sleep(150);
    ok((await ev(() => window.__sim.tp.side)) === -side0, 'C swaps the shoulder');
    await sp.keyboard.press('Escape'); await sleep(300);
    ok((await ev(() => window.__sim.viewId())) === 'free' && (await ev(() => !window.__sim.ctl.active)), 'Escape leaves third person');

    // the staff slider adds and removes people
    const counts = await ev(() => {
      const s = document.getElementById('staff'), n0 = window.__sim.people.filter(p => p.controller === "ai").length;
      s.value = 46; s.dispatchEvent(new Event('input', { bubbles: true }));
      const n1 = window.__sim.people.filter(p => p.controller === "ai").length;
      s.value = 40; s.dispatchEvent(new Event('input', { bubbles: true }));
      return [n0, n1, window.__sim.people.filter(p => p.controller === "ai").length, window.__sim.people.includes(window.__sim.player.person)];
    });
    ok(counts[0] === 40 && counts[1] === 46 && counts[2] === 40 && counts[3] === true, 'the staff slider adds and removes staff and leaves the player alone (' + counts.join(' to ') + ')');

    // Hazel: make sure she is in, find her, make her angry
    await ev(() => { const S = window.__sim; let n = 0; while (S.people[0].state === 'away' && n < 5000) { S.advance(50); n += 50; } });
    await ev(() => document.getElementById('findHazel').click()); await sleep(300);
    ok((await ev(() => window.__sim.following() && window.__sim.following().name)) === 'Hazel Sellote', '"Find her" follows Hazel');
    await ev(() => document.getElementById('rageHazel').click()); await sleep(1800);
    const rage = await ev(() => ({ k: window.__sim.people[0].rageK || 0, btn: document.getElementById('rageHazel').textContent }));
    ok(rage.k > 0.3 && /Calming down/.test(rage.btn), '"Make her angry" works (rage ' + rage.k.toFixed(2) + ', button "' + rage.btn + '")');

    serr.forEach(e => fail(e));
    if (!serr.length) pass('no errors in the browser console during the scenario');
    await sp.close();
  }

  // without a seed the game must behave exactly as it always did: live, and different every time
  console.log('\ndefault mode (no seed)');
  const a = await openPage(browser, site.url, '?offline');
  const first = await a.page.evaluate(() => ({ paused: window.__sim.sim.paused, t: window.__sim.sim.t, hash: window.__sim.fingerprint().hash }));
  await sleep(1500);
  const later = await a.page.evaluate(() => window.__sim.sim.t);
  const b = await openPage(browser, site.url, '?offline');
  const other = await b.page.evaluate(() => window.__sim.fingerprint().hash);
  if (first.paused === false) pass('the simulation runs live'); else fail('the simulation started paused without a seed');
  if (later > first.t) pass(`the clock advances on its own (${first.t.toFixed(2)} to ${later.toFixed(2)})`); else fail('the clock did not advance');
  if (first.hash !== other) pass('two loads without a seed differ (still random)'); else fail('two loads without a seed were identical');
  [...a.errors, ...b.errors].forEach(e => fail(e));
  await a.page.close(); await b.page.close();

  // online mode: two browsers watching one server
  const probe = await openPage(browser, site.url, '?trace', { login: null });
  const isOnline = await probe.page.evaluate(() => window.__sim.online);
  await probe.page.close();
  if (isOnline) {
    console.log('\nonline mode (two browsers, one server)');
    const p1 = await openPage(browser, site.url, '?trace', { login: 'verify_a' }), p2 = await openPage(browser, site.url, '?trace', { login: 'verify_b' });
    const ready = p => p.page.waitForFunction(() => window.__sim.net && window.__sim.net.snapshots > 25, null, { timeout: 15000 });
    await Promise.all([ready(p1), ready(p2)]);
    await sleep(2500); // a few keyframes
    const view = p => p.page.evaluate(() => ({
      people: window.__sim.people.filter(x => x.controller === 'ai').length,
      shown: window.__sim.people.filter(x => x.controller === 'ai' && x.body && x.body.root.visible).length,
      present: window.__sim.people.filter(x => x.controller === 'ai' && x.state !== 'away').length,
      status: document.getElementById('netStatus')?.className,
      statusText: document.getElementById('netStatus')?.textContent,
      locked: [...document.querySelectorAll('#staff, #play, [data-speed]')].every(e => e.disabled),
      layoutOk: window.__sim.net.layoutOk,
      clock: window.__sim.sim.t,
      trace: [...window.__sim.net.trace.entries()],
    }));
    const [v1, v2] = await Promise.all([view(p1), view(p2)]);
    if (v1.people === 40 && v2.people === 40) pass('both pages show the 40 people the server has'); else fail(`people: ${v1.people} and ${v2.people}`);
    // (how many are in the building depends on the time of day the server is at, so compare with who is in, not a fixed number)
    if (v1.present > 3 && v1.shown === v1.present && v2.shown === v2.present) pass(`bodies are drawn for everyone who is in (${v1.shown} and ${v2.shown} visible)`); else fail(`bodies drawn: ${v1.shown} of ${v1.present} in, ${v2.shown} of ${v2.present}`);
    if (v1.status === 'ok' && v2.status === 'ok') pass(`the status says "${v1.statusText}"`); else fail(`status: ${v1.status} / ${v2.status}`);
    if (v1.locked && v2.locked && v1.layoutOk && v2.layoutOk) pass('server-owned controls are locked, and both offices match the server'); else fail('controls not locked or layout mismatch');
    if (Math.abs(v1.clock - v2.clock) < 1) pass(`the two clocks agree (${v1.clock.toFixed(2)} and ${v2.clock.toFixed(2)})`); else fail(`clocks differ: ${v1.clock} vs ${v2.clock}`);
    // at every keyframe both pages hold exactly the server's picture, so the pictures must be identical
    const m2 = new Map(v2.trace);
    let common = 0, bad = 0;
    for (const [tick, people] of v1.trace) {
      const other = m2.get(tick);
      if (!other) continue;
      common++;
      const same = people.length === other.length && people.every((q, i) => q[0] === other[i][0] && q[3] === other[i][3] && q[4] === other[i][4] && Math.abs(q[1] - other[i][1]) < 1e-4 && Math.abs(q[2] - other[i][2]) < 1e-4);
      if (!same) bad++;
    }
    if (common >= 2 && !bad) pass(`at ${common} shared keyframes both pages hold identical positions, states and tasks`); else fail(`keyframes in common: ${common}, different: ${bad}`);
    // the ledger and the info card work on mirrored people
    const ui = await p1.page.evaluate(() => {
      const p = window.__sim.people.find(x => x.controller === 'ai' && x.state !== 'away');
      window.__sim.select(p);
      return { present: document.getElementById('present')?.textContent, card: document.getElementById('pName')?.textContent, status: document.getElementById('pStatus')?.textContent || document.getElementById('pRole')?.textContent };
    });
    if (/^\d+ \/ 40 in$/.test(ui.present || '') && ui.card) pass(`ledger "${ui.present}", info card for ${ui.card}`); else fail(`ledger/card: ${JSON.stringify(ui)}`);
    await p1.page.screenshot({ path: path.join(outDir, 'online-1.png') });
    [...p1.errors, ...p2.errors].forEach(e => fail(e));
    if (!p1.errors.length && !p2.errors.length) pass('no errors in either browser console');
    await p1.page.close(); await p2.page.close();

    // the login screen, as a person uses it
    console.log('\nthe login screen');
    const uname = 'ui_' + (Date.now() % 1e7);
    const u = await openPage(browser, site.url, '?trace', { login: null });
    const screenShown = await u.page.waitForSelector('#loginScreen', { timeout: 10000 }).then(() => true, () => false);
    if (screenShown && !(await u.page.evaluate(() => window.__sim.people.length))) pass('without a session the login screen shows and no office is drawn yet'); else fail('the login screen did not appear first');
    if (await u.page.$('.login-tab, #loginCode')) fail('the login screen still offers sign-up'); else pass('the login screen has no sign-up');
    // an admin makes the account; its first password must be replaced on first login
    await adminCreate(site.url, uname, 'first-pass-from-admin-1');
    await u.page.fill('#loginName', uname);
    await u.page.fill('#loginPass', 'first-pass-from-admin-1');
    await u.page.click('.login-form button[type=submit]');
    await u.page.waitForSelector('#loginNew', { timeout: 8000 }).then(() => pass('the first login asks the person to choose their own password'), () => fail('no choose-a-password step'));
    if (await u.page.evaluate(() => window.__sim.people.length)) fail('the office appeared before the password was changed'); else pass('no office until the password is changed');
    await u.page.fill('#loginNew', 'short'); await u.page.fill('#loginNew2', 'short');
    await u.page.click('.login-form button[type=submit]');
    await u.page.waitForFunction(() => /at least 8/.test(document.querySelector('.login-note')?.textContent || ''), null, { timeout: 8000 }).then(() => pass('a weak new password is refused with the reason, on the screen'), () => fail('no weak-password message'));
    await u.page.fill('#loginNew', 'a-fine-long-password'); await u.page.fill('#loginNew2', 'a-different-one-123');
    await u.page.click('.login-form button[type=submit]');
    await u.page.waitForFunction(() => /not the same/.test(document.querySelector('.login-note')?.textContent || ''), null, { timeout: 8000 }).then(() => pass('two different new passwords are refused'), () => fail('no mismatch message'));
    await u.page.fill('#loginNew', 'a-fine-long-password'); await u.page.fill('#loginNew2', 'a-fine-long-password');
    await u.page.click('.login-form button[type=submit]');
    await u.page.waitForFunction(() => window.__sim.net.snapshots > 10 && !document.getElementById('loginScreen'), null, { timeout: 20000 }).then(() => pass('choosing a password logs in and the office appears'), () => fail('choosing a password did not lead to the office'));
    const box = await u.page.evaluate(() => ({ name: document.querySelector('#accountBox span')?.textContent, people: window.__sim.people.length, status: document.getElementById('netStatus')?.className }));
    if (box.name === uname && box.people >= 40 && box.status === 'ok') pass(`the account box shows "${box.name}" and the status is online`); else fail(`account box: ${JSON.stringify(box)}`);

    // logging out brings the screen back and empties the office; a wrong password is refused; the right one returns
    await u.page.click('#accountBox button:last-child');
    await u.page.waitForSelector('#loginScreen', { timeout: 8000 }).then(() => pass('logging out shows the login screen again'), () => fail('no login screen after logout'));
    if ((await u.page.evaluate(() => window.__sim.people.length)) === 0) pass('the office is cleared on logout'); else fail('people remained after logout');
    await u.page.fill('#loginName', uname);
    await u.page.fill('#loginPass', 'wrong-password-here');
    await u.page.click('.login-form button[type=submit]');
    await u.page.waitForFunction(() => /invalid username or password/.test(document.querySelector('.login-note')?.textContent || ''), null, { timeout: 8000 }).then(() => pass('a wrong password gets the plain "invalid username or password"'), () => fail('no wrong-password message'));
    await u.page.fill('#loginPass', 'a-fine-long-password');
    await u.page.click('.login-form button[type=submit]');
    await u.page.waitForFunction(() => window.__sim.net.snapshots > 5 && window.__sim.people.length >= 40, null, { timeout: 20000 }).then(() => pass('logging back in returns to the office'), () => fail('did not return to the office'));

    // the same account from a second browser takes over, and the first is told why
    const second = await openPage(browser, site.url, '?trace', { login: uname, password: 'a-fine-long-password' });
    await second.page.waitForFunction(() => window.__sim.net.snapshots > 5, null, { timeout: 20000 });
    await u.page.waitForFunction(() => /somewhere else/.test(document.getElementById('netStatus')?.textContent || ''), null, { timeout: 10000 }).then(() => pass('a second login takes over and the first browser is told "logged in from somewhere else"'), () => fail('the first browser was not told'));
    await screenshotOf(u.page, 'login-kicked.png');
    [...u.errors, ...second.errors].filter(e => !/401|403|Failed to load resource/.test(e)).forEach(e => fail(e));
    await u.page.close(); await second.page.close();

    // character creation: an account with a desk makes its character on first login; everybody sees it; it can be changed later
    console.log('\ncharacter creation');
    const cname = 'char_' + (Date.now() % 1e7);
    await adminCreate(site.url, cname, 'first-pass-from-admin-1');
    const accounts = (await adminJson(site.url, 'GET', '/api/admin/users')).body;
    const cid = accounts.find(a => a.username === cname).id;
    const freeDesk = (await adminJson(site.url, 'GET', '/api/admin/slots')).body.find(s => s.status === 'unclaimed').spot;
    const assigned = await adminJson(site.url, 'POST', `/api/admin/users/${cid}/assign-slot`, { spot: freeDesk });
    if (assigned.status === 201) pass('an admin gave the new account a desk'); else fail(`assign-slot: ${assigned.status}`);
    const watcher = await openPage(browser, site.url, '?trace');
    const c = await openPage(browser, site.url, '?trace', { login: cname });
    const creatorShown = await c.page.waitForSelector('#creatorScreen', { timeout: 20000 }).then(() => true, () => false);
    if (creatorShown) pass('the first login after a desk is given opens character creation'); else fail('character creation did not open');
    if (await c.page.evaluate(() => document.getElementById('creatorCancel').hidden)) pass('it cannot be skipped the first time'); else fail('the first-time page can be cancelled');
    const drawn = () => c.page.evaluate(() => new Promise(done => requestAnimationFrame(() => {
      const src = document.getElementById('creatorPreview');
      const copy = document.createElement('canvas'); copy.width = src.width; copy.height = src.height;
      const g = copy.getContext('2d'); g.drawImage(src, 0, 0);
      const d = g.getImageData(0, 0, copy.width, copy.height).data;
      let n = 0, red = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { n++; if (d[i] > 150 && d[i + 1] < 120 && d[i + 2] < 110) red++; }
      done({ n, red });
    })));
    const before = await drawn();
    if (before.n > 1500) pass(`the live preview draws the character (${before.n} pixels)`); else fail(`the preview looks empty (${before.n} pixels)`);
    await c.page.click('[data-key="shirt"][data-color="#c45f4b"]');
    await c.page.click('[data-style="bun"]');
    await c.page.check('#creator-glasses');
    await c.page.fill('#creatorHeight', '1.08');
    await sleep(300);
    const after = await drawn();
    if (after.red > before.red + 200) pass('the preview changes at once when a choice is made (red shirt)'); else fail(`preview did not change: red ${before.red} to ${after.red}`);
    await screenshotOf(c.page, 'character-creator.png');
    await c.page.click('#creatorSave');
    await c.page.waitForFunction(() => !document.getElementById('creatorScreen') && window.__sim.net.snapshots > 5, null, { timeout: 20000 }).then(() => pass('saving closes the page and the office appears'), () => fail('saving did not lead to the office'));
    const mine = await c.page.evaluate(n => { const p = window.__sim.people.find(x => x.name === n); return p ? { spec: p.spec, controller: p.controller } : null; }, cname);
    if (mine && mine.controller === 'account' && mine.spec.shirt === '#c45f4b' && mine.spec.style === 'bun' && mine.spec.glasses === true && Math.abs(mine.spec.scale - 1.08) < 0.001) pass('their own person wears the new look'); else fail(`own person: ${JSON.stringify(mine)}`);
    await watcher.page.waitForFunction(n => { const p = window.__sim.people.find(x => x.name === n); return p && p.spec.shirt === '#c45f4b' && p.spec.style === 'bun'; }, cname, { timeout: 10000 }).then(() => pass('another browser sees the new look'), () => fail('the other browser did not see the look'));
    const seenBody = await watcher.page.evaluate(n => { const p = window.__sim.people.find(x => x.name === n); return !!(p && p.body && p.body.root.parent); }, cname);
    if (seenBody) pass('and it has a body in the scene'); else fail('no body drawn for the new look');

    // change it later, from the account box; cancel leaves it alone
    await c.page.click('#characterBtn');
    await c.page.waitForSelector('#creatorScreen', { timeout: 8000 });
    if (!(await c.page.evaluate(() => document.getElementById('creatorCancel').hidden))) pass('later it can be cancelled'); else fail('cancel is missing when changing');
    if (await c.page.evaluate(() => document.querySelector('[data-style="bun"]').getAttribute('aria-pressed') === 'true' && document.getElementById('creator-glasses').checked)) pass('it starts from the saved look'); else fail('the editor did not start from the saved look');
    await c.page.click('[data-style="curly"]');
    await c.page.keyboard.press('Escape');
    await c.page.waitForFunction(() => !document.getElementById('creatorScreen'), null, { timeout: 5000 });
    await sleep(500);
    if ((await c.page.evaluate(n => window.__sim.people.find(x => x.name === n).spec.style, cname)) === 'bun') pass('closing without saving changes nothing'); else fail('an unsaved change was applied');
    await c.page.click('#characterBtn');
    await c.page.waitForSelector('#creatorScreen');
    await c.page.click('[data-style="curly"]');
    await c.page.click('[data-key="jacket"][data-color="#2f3a45"]');
    await c.page.click('#creatorSave');
    await watcher.page.waitForFunction(n => { const p = window.__sim.people.find(x => x.name === n); return p && p.spec.style === 'curly' && p.spec.jacket === '#2f3a45'; }, cname, { timeout: 10000 }).then(() => pass('a later change reaches the other browser too'), () => fail('the later change was not seen'));

    // a reload does not ask again, and keeps the look
    await c.page.reload({ waitUntil: 'load' });
    await c.page.waitForFunction(() => window.__sim && window.__sim.net && window.__sim.net.snapshots > 5, null, { timeout: 30000 });
    if (!(await c.page.$('#creatorScreen'))) pass('a reload does not ask for a character again'); else fail('character creation opened again');
    if ((await c.page.evaluate(n => window.__sim.people.find(x => x.name === n).spec.style, cname)) === 'curly') pass('and the look is kept'); else fail('the look was not kept across a reload');
    [...c.errors, ...watcher.errors].filter(e => !/401|403|Failed to load resource/.test(e)).forEach(e => fail(e));
    await c.page.close(); await watcher.page.close();
    await adminJson(site.url, 'POST', `/api/admin/users/${cid}/release-slot`); // (leave the desk free for the next run)

    // a link must not be able to point the login screen at somebody else's server
    {
      const hctx = await browser.newContext(); const hp = await hctx.newPage();
      const hosts = new Set(); hp.on('request', r => hosts.add(new URL(r.url()).hostname));
      await hp.route('**/*', route => (new URL(route.request().url()).hostname === 'evil.example' ? route.abort() : route.continue()));
      await hp.goto(site.url + '/?online=https://evil.example&trace', { waitUntil: 'load' });
      await hp.waitForSelector('#loginScreen', { timeout: 15000 }).catch(() => {});
      await hp.fill('#loginName', 'someone'); await hp.fill('#loginPass', 'not-a-real-password'); await hp.keyboard.press('Enter');
      await sleep(1500);
      if (!hosts.has('evil.example')) pass('a link cannot point the login screen at another server'); else fail('the page contacted evil.example');
      await hctx.close();
    }

    {
    // driving in the browser: log in, arrive as your person, walk and sit with the keyboard, others see it, log out, come back
    console.log('\ndriving in the browser');
    const dtag = String(Date.now() % 1e6);
    const dname = `drv_${dtag}`, gname = `drg_${dtag}`;
    const giveDesk = async name => {
      await adminCreate(site.url, name, 'first-pass-from-admin-1');
      const id = (await adminJson(site.url, 'GET', '/api/admin/users')).body.find(a => a.username === name).id;
      const spot = (await adminJson(site.url, 'GET', '/api/admin/slots')).body.find(s => s.status === 'unclaimed').spot;
      const r = await adminJson(site.url, 'POST', `/api/admin/users/${id}/assign-slot`, { spot });
      if (r.status !== 201) fail(`could not give ${name} a desk: ${r.status}`);
      return id;
    };
    const did = await giveDesk(dname);
    const watcher2 = await openPage(browser, site.url, '?trace');
    const d = await openPage(browser, site.url, '?trace', { login: dname });
    await d.page.waitForSelector('#creatorScreen', { timeout: 20000 });
    await d.page.click('#creatorSave');
    await d.page.waitForFunction(() => !document.getElementById('creatorScreen') && window.__sim.net.joined, null, { timeout: 20000 });
    const arrived = await d.page.evaluate(() => ({ view: window.__sim.viewId(), you: window.__sim.net.you, mine: window.__sim.player.person && window.__sim.player.person.id, controlling: window.__sim.player.controlling, ctl: window.__sim.ctl.active }));
    if (arrived.view === 'third' && arrived.mine === arrived.you && arrived.controlling && arrived.ctl) pass('logging in puts you in third person, steering your own person'); else fail(`arrival: ${JSON.stringify(arrived)}`);
    const desk = await d.page.evaluate(() => { const s = window.__sim.player.person.slot; return s ? { place: s.place, id: s.id } : null; });
    const info = await d.page.textContent('#deskInfo');
    if (desk && info === desk.place) pass(`the account box says where you sit ("${info}")`); else fail(`desk info "${info}" vs ${JSON.stringify(desk)}`);
    if (!(await d.page.$('#guestNote:not([hidden])'))) pass('no guest note for someone with a desk'); else fail('a guest note for someone with a desk');

    // walk to the desk with the keyboard; another browser sees you there
    const before = await personOf(d.page, dname);
    const outLeft = await walkTo(d.page, "interactables.of('lounge')[0].approach");
    const out = await personOf(d.page, dname);
    if (outLeft < .6 && Math.hypot(out.x - before.x, out.z - before.z) > 2) pass(`walked ${Math.hypot(out.x - before.x, out.z - before.z).toFixed(1)} m to the lounge with W (and Shift)`); else fail(`walk out: ${outLeft} m left, moved ${Math.hypot(out.x - before.x, out.z - before.z)}`);
    const left = await walkTo(d.page, "interactables.of('desk').find(s => s.id === '" + desk.id + "').approach");
    const after = await personOf(d.page, dname);
    if (left < .6 && Math.hypot(after.x - out.x, after.z - out.z) > 2) pass(`and back to the desk (${Math.hypot(after.x - out.x, after.z - out.z).toFixed(1)} m)`); else fail(`walk back: ${left} m left, moved ${Math.hypot(after.x - out.x, after.z - out.z)}`);
    await sleep(400);
    const seenWalk = await personOf(watcher2.page, dname);
    if (seenWalk && Math.hypot(seenWalk.x - after.x, seenWalk.z - after.z) < .5 && seenWalk.controller === 'account') pass('another browser sees them in the same place, driven by a player'); else fail(`watcher sees ${JSON.stringify(seenWalk)} vs ${JSON.stringify(after)}`);

    // sit with E; stand by walking
    await d.page.keyboard.press('e');
    await d.page.waitForFunction(() => window.__sim.player.sitting, null, { timeout: 5000 }).then(() => pass('E sits you down'), () => fail('E did not sit'));
    await watcher2.page.waitForFunction(n => { const p = window.__sim.people.find(x => x.name === n); return p && p.task && p.task.kind === 'playerSit'; }, dname, { timeout: 5000 }).then(() => pass('another browser sees them seated'), () => fail('the watcher does not see them seated'));
    await screenshotOf(d.page, 'driving-seated.png');
    await d.page.keyboard.down('s'); await sleep(500); await d.page.keyboard.up('s');
    await d.page.waitForFunction(() => !window.__sim.player.sitting, null, { timeout: 5000 }).then(() => pass('walking away stands you up'), () => fail('still seated after walking'));

    // log out: the person stays where it is for a while, log back in and it is the same person in the same place
    const spot0 = await personOf(d.page, dname);
    await d.page.click('#accountBox button:last-child');
    await d.page.waitForSelector('#loginScreen', { timeout: 8000 });
    await sleep(1200);
    const held = await personOf(watcher2.page, dname);
    if (held && held.controller === 'account' && Math.hypot(held.x - spot0.x, held.z - spot0.z) < .5) pass('after logging out the person waits where it stood (the grace period)'); else fail(`after logout: ${JSON.stringify(held)} vs ${JSON.stringify(spot0)}`);
    await d.page.fill('#loginName', dname);
    await d.page.fill('#loginPass', 'verify-test-pass-1');
    await d.page.click('.login-form button[type=submit]');
    await d.page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person, null, { timeout: 20000 });
    const back = await personOf(d.page, dname);
    if (back && back.id === spot0.id && Math.hypot(back.x - spot0.x, back.z - spot0.z) < .5) pass('logging back in returns to the same person, where it stands'); else fail(`back: ${JSON.stringify(back)} vs ${JSON.stringify(spot0)}`);
    if ((await d.page.evaluate(() => window.__sim.viewId())) === 'third') pass('and you are steering it again'); else fail('not in third person after logging back in');

    // log out for good: after the grace period the autopilot takes over, and everyone sees it
    await d.page.click('#accountBox button:last-child');
    await watcher2.page.waitForFunction(n => { const p = window.__sim.people.find(x => x.name === n); return p && p.controller === 'ai'; }, dname, { timeout: 60000 }).then(() => pass('after the grace period the person carries on by itself, and others see that'), () => fail('the person was not handed back to the autopilot'));
    const carried = await personOf(watcher2.page, dname);
    if (carried && carried.state !== 'controlled') pass(`it is back on autopilot (${carried.state}${carried.task ? ', ' + carried.task : ''})`); else fail(`state after hand back: ${JSON.stringify(carried)}`);
    const dErr = d.errors.filter(e => !/401|403|Failed to load resource/.test(e));
    dErr.forEach(e => fail(e));
    await d.page.close();
    await adminJson(site.url, 'POST', `/api/admin/users/${did}/release-slot`);

    // a guest: no desk, a note says so, but they can walk and sit in a shared seat
    const gid = await (async () => { await adminCreate(site.url, gname, 'first-pass-from-admin-1'); return (await adminJson(site.url, 'GET', '/api/admin/users')).body.find(a => a.username === gname).id; })();
    const g = await openPage(browser, site.url, '?trace', { login: gname });
    await g.page.waitForFunction(() => window.__sim.net.joined && window.__sim.player.person, null, { timeout: 20000 });
    if (await g.page.waitForSelector('#guestNote:not([hidden])', { timeout: 5000 }).then(() => true, () => false)) pass('a guest sees a note that they have no desk yet'); else fail('no guest note');
    if ((await g.page.textContent('#deskInfo')) === 'Guest · no desk yet') pass('and the account box says "Guest · no desk yet"'); else fail('guest account box text');
    const g0 = await personOf(g.page, gname);
    const guestSat = await sitDownSomewhere(g.page);
    const g1 = await personOf(g.page, gname);
    if (Math.hypot(g1.x - g0.x, g1.z - g0.z) > 2) pass('a guest walks to the lounge with the keyboard'); else fail(`guest walk: moved ${Math.hypot(g1.x - g0.x, g1.z - g0.z)}`);
    if (guestSat && (await g.page.evaluate(() => window.__sim.player.sitting.shared))) pass('and sits in a shared seat with E'); else fail('guest could not sit');
    await screenshotOf(g.page, 'driving-guest.png');
    await g.page.close(); await watcher2.page.close();
    await adminJson(site.url, 'POST', `/api/admin/users/${gid}/disabled`, { disabled: true }); // (a guest who is not coming back)

    }

    // the admin page: one password, make accounts, reset a password, disable, desks
    console.log('\nthe admin page');
    const tag = String(Date.now() % 1e6);
    const [n1, n2, n3] = [`adm_a${tag}`, `adm_b${tag}`, `adm_c${tag}`];
    const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const ap = await actx.newPage();
    const aerrors = collectErrors(ap);
    const adminResp = await ap.goto(site.url + '/admin', { waitUntil: 'load' });
    const hh = adminResp.headers();
    if (hh['cache-control'] === 'no-store' && /frame-ancestors 'none'/.test(hh['content-security-policy'] || '') && hh['x-content-type-options'] === 'nosniff') pass('the admin page is served no-store with a strict content policy'); else fail('admin headers: ' + JSON.stringify(hh));
    await ap.waitForSelector('#adminPassword', { timeout: 10000 }).then(() => pass('/admin asks for the admin password'), () => fail('/admin shows no password box'));
    await ap.fill('#adminPassword', 'definitely-not-the-password');
    await ap.keyboard.press('Enter');
    await ap.waitForFunction(() => /Wrong password/.test(document.querySelector('.a-note')?.textContent || ''), null, { timeout: 8000 }).then(() => pass('a wrong password is refused'), () => fail('no wrong-password message'));
    await ap.fill('#adminPassword', process.env.VERIFY_ADMIN_TOKEN);
    await ap.keyboard.press('Enter');
    await ap.waitForSelector('#adminAccounts table', { timeout: 10000 }).then(() => pass('the right password opens the account list'), () => fail('the account list did not open'));

    await ap.fill('#bulkNames', `${n1}\n${n2}, bad!name\nx`);
    await ap.check('#bulkDesk');
    await ap.click('#bulkGo');
    await ap.waitForSelector('#bulkTable', { timeout: 20000 });
    const rows = await ap.evaluate(() => [...document.querySelectorAll('#bulkTable tbody tr')].map(tr => [...tr.children].map(td => td.textContent)));
    const pw1 = rows.find(r => r[0] === n1)?.[1];
    if (rows.find(r => r[0] === n1)?.[3] === 'made' && rows.find(r => r[0] === n2)?.[3] === 'made' && /^[A-Za-z0-9]{12}$/.test(pw1 || '')) pass('making accounts shows each one with a generated first password'); else fail(`bulk rows: ${JSON.stringify(rows)}`);
    const refused = rows.filter(r => r[3] !== "made");
    if (refused.length === 2 && refused.every(r => /username/i.test(r[3]))) pass('names that are not allowed are reported with the reason'); else fail(`refused rows: ${JSON.stringify(refused)}`);
    if (rows.filter(r => r[3] === 'made').every(r => r[2])) pass('each new account was given a free desk'); else fail('a new account has no desk');
    const first = await fetch(site.url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: n1, password: pw1 }) });
    if (first.ok && (await first.json()).account.mustChangePassword === true) pass('the generated password works, and asks for a new one'); else fail('the generated password did not work');

    // search
    await ap.fill('#adminFilter', n2);
    const shown = await ap.evaluate(() => [...document.querySelectorAll('#adminAccounts tbody tr[data-user]')].map(r => r.dataset.user));
    if (shown.length === 1 && shown[0] === n2) pass('searching narrows the list'); else fail(`search shows ${JSON.stringify(shown)}`);
    await ap.fill('#adminFilter', '');

    // reset a password: shown once, old one stops, the new one works
    await ap.click(`tr[data-user="${n1}"] [data-do="password"]`);
    await ap.click('[data-do="set-password"]');
    await ap.waitForSelector('[data-result="password"]', { timeout: 10000 });
    const pw2 = await ap.textContent('[data-result="password"]');
    const tryLogin = async (u, p) => (await fetch(site.url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).status;
    if (/^[A-Za-z0-9]{12}$/.test(pw2) && pw2 !== pw1 && (await tryLogin(n1, pw1)) === 401 && (await tryLogin(n1, pw2)) === 200) pass('resetting shows a new password once; the old one stops working'); else fail(`reset: ${pw2}`);
    await ap.fill('[aria-label="New password for ' + n1 + '"]', 'short');
    await ap.click('[data-do="set-password"]');
    await ap.waitForFunction(() => [...document.querySelectorAll('.a-note')].some(n => /at least 8/.test(n.textContent)), null, { timeout: 8000 }).then(() => pass('a typed password that is too weak is refused with the reason'), () => fail('weak password was not refused'));
    await ap.fill('[aria-label="New password for ' + n1 + '"]', 'typed by the admin 77');
    await ap.click('[data-do="set-password"]');
    await ap.waitForFunction(() => document.querySelector('[data-result="password"]')?.textContent === 'typed by the admin 77', null, { timeout: 8000 }).then(() => pass('an admin can type the password instead'), () => fail('typed password not applied'));
    if ((await tryLogin(n1, 'typed by the admin 77')) === 200) pass('and it works'); else fail('typed password does not log in');

    // disable needs a second click, then enable
    await ap.click(`tr[data-user="${n1}"] [data-do="disable"]`);
    if ((await tryLogin(n1, 'typed by the admin 77')) === 200) pass('one click on Disable does nothing yet (it asks "Sure?")'); else fail('disabled on a single click');
    await ap.click(`tr[data-user="${n1}"] [data-do="disable"]`);
    await ap.waitForSelector(`tr[data-user="${n1}"] .a-chip.bad`, { timeout: 8000 });
    if ((await tryLogin(n1, 'typed by the admin 77')) === 403) pass('a disabled account cannot log in'); else fail('disabled account could log in');
    await ap.click(`tr[data-user="${n1}"] [data-do="disable"]`);
    await ap.click(`tr[data-user="${n1}"] [data-do="disable"]`);
    await ap.waitForFunction(u => !document.querySelector(`tr[data-user="${u}"] .a-chip.bad`), n1, { timeout: 8000 });
    if ((await tryLogin(n1, 'typed by the admin 77')) === 200) pass('enabling lets them back in'); else fail('enabled account cannot log in');

    // desks: take one away, give one back from the list
    await ap.click(`tr[data-user="${n2}"] [data-do="release"]`);
    await ap.click(`tr[data-user="${n2}"] [data-do="release"]`);
    await ap.waitForSelector(`tr[data-user="${n2}"] select`, { timeout: 8000 }).then(() => pass('taking a desk away offers a free desk to give again'), () => fail('desk was not taken away'));
    await ap.selectOption(`tr[data-user="${n2}"] select`, { index: 1 });
    await ap.click(`tr[data-user="${n2}"] [data-do="assign"]`);
    await ap.waitForFunction(u => !document.querySelector(`tr[data-user="${u}"] select`), n2, { timeout: 8000 }).then(() => pass('a desk can be given from the list'), () => fail('desk was not given'));
    await screenshotOf(ap, 'admin-page.png');

    // the activity log shows what was just done, with no password in it
    await ap.waitForSelector('#adminAudit tbody tr', { timeout: 8000 });
    const logText = await ap.textContent('#adminAudit');
    const kinds = await ap.evaluate(() => [...document.querySelectorAll('#adminAudit tbody tr')].map(r => r.dataset.action));
    if (['account.bulk-create', 'password.set', 'account.disable', 'account.enable', 'desk.release', 'desk.assign'].every(k => kinds.includes(k))) pass('the activity list shows what was just done'); else fail('activity actions: ' + JSON.stringify(kinds));
    if (!logText.includes(pw1) && !logText.includes(pw2) && !logText.includes('typed by the admin 77')) pass('and none of the passwords are in it'); else fail('a password is in the activity list');

    // a reload keeps you in for this tab, log out forgets it
    await ap.reload({ waitUntil: 'load' });
    await ap.waitForSelector('#adminAccounts table', { timeout: 10000 }).then(() => pass('a reload stays logged in (this tab only)'), () => fail('reload logged out'));
    await ap.click('#adminLogout');
    await ap.waitForSelector('#adminPassword', { timeout: 5000 });
    await ap.reload({ waitUntil: 'load' });
    if (await ap.waitForSelector('#adminPassword', { timeout: 5000 }).then(() => true, () => false)) pass('logging out forgets the password'); else fail('still logged in after logout');
    aerrors.filter(e => !/401|403|Failed to load resource/.test(e)).forEach(e => fail(e));
    for (const n of [n1, n2]) { // (leave the desks free for the next run)
      const u = (await adminJson(site.url, 'GET', '/api/admin/users')).body.find(x => x.username === n);
      if (u?.slotSpot) await adminJson(site.url, 'POST', `/api/admin/users/${u.id}/release-slot`);
    }
    await actx.close();
  }
} finally {
  await browser.close();
  site.stop();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
