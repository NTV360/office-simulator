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
import { collectErrors, freePort, openPage, sleep, startSite } from './site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const goldenDir = path.join(root, 'tests/browser/golden');
const outDir = path.join(root, 'tests/browser/out');
const record = process.argv.includes('--record');

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
  const a = await openPage(browser, site.url);
  const first = await a.page.evaluate(() => ({ paused: window.__sim.sim.paused, t: window.__sim.sim.t, hash: window.__sim.fingerprint().hash }));
  await sleep(1500);
  const later = await a.page.evaluate(() => window.__sim.sim.t);
  const b = await openPage(browser, site.url);
  const other = await b.page.evaluate(() => window.__sim.fingerprint().hash);
  if (first.paused === false) pass('the simulation runs live'); else fail('the simulation started paused without a seed');
  if (later > first.t) pass(`the clock advances on its own (${first.t.toFixed(2)} to ${later.toFixed(2)})`); else fail('the clock did not advance');
  if (first.hash !== other) pass('two loads without a seed differ (still random)'); else fail('two loads without a seed were identical');
  [...a.errors, ...b.errors].forEach(e => fail(e));
  await a.page.close(); await b.page.close();
} finally {
  await browser.close();
  site.stop();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
