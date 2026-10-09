// Smoke test for a running stack: node scripts/smoke.mjs   (or: npm run smoke)
// Checks that the page and its files are served and that the server reports a healthy database.
// Target: SMOKE_URL, else http://localhost:$WEB_PORT (default 8080).

const base = (process.env.SMOKE_URL || `http://localhost:${process.env.WEB_PORT || 8080}`).replace(/\/$/, '');
let failed = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failed++;
}

async function get(path) {
  const res = await fetch(base + path);
  return { res, text: await res.text().catch(() => '') };
}

try {
  const page = await get('/');
  check('GET / returns the page', page.res.ok && page.text.includes('id="stage"'), `status ${page.res.status}`);

  const assets = [...page.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
  check('the page links its script and styles', assets.length >= 2, `${assets.length} asset links`);
  for (const a of assets) {
    const r = await fetch(base + a);
    check(`GET ${a}`, r.ok, `status ${r.status}`);
  }

  const health = await get('/api/health');
  let body = null;
  try { body = JSON.parse(health.text); } catch { /* reported below */ }
  check('GET /api/health answers', health.res.ok && body !== null, `status ${health.res.status}`);
  check('the server says it is ok', body?.status === 'ok', JSON.stringify(body));
  check('the database is reachable', body?.db === 'ok');

  const w1 = JSON.parse((await get('/api/world')).text);
  await new Promise(r => setTimeout(r, 1200));
  const w2 = JSON.parse((await get('/api/world')).text);
  check('the world is running: ticks and the clock advance', w2.tick > w1.tick && (w2.paused || w2.simTime !== w1.simTime), `tick ${w1.tick} to ${w2.tick}`);
  check('the office has its staff', w2.staff > 0 && w2.desks === 70, `${w2.staff} staff, ${w2.desks} desks`);
  check('ticks fit their budget', w2.tickMs.avgMs < 10, `avg ${w2.tickMs.avgMs.toFixed(2)} ms, max ${w2.tickMs.maxMs.toFixed(2)} ms`);

  // accounts: the auth routes are wired (an anonymous caller is told "not logged in", not 404 or 500)
  const me = await fetch(base + '/api/auth/me');
  const meBody = await me.json().catch(() => null);
  check('accounts: /api/auth/me says "not logged in" to a stranger', me.status === 401 && meBody?.code === 'unauthenticated', `status ${me.status}`);

  // realtime: connect through the proxy exactly as a browser does, say hello, expect the welcome and a stream of snapshots
  try {
    const { io } = await import('socket.io-client');
    const { encode, decode, PROTOCOL_VERSION } = await import('../packages/shared/dist/index.js');
    const got = { welcome: null, snapshots: 0 };
    const socket = io(base, { transports: ['websocket'], reconnection: false });
    socket.on('m', data => {
      const m = decode(new Uint8Array(data));
      if (m.type === 'welcome') got.welcome = m;
      if (m.type === 'snapshot') got.snapshots++;
    });
    await new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); setTimeout(() => rej(new Error('no connection in 5 s')), 5000); });
    socket.emit('m', encode({ type: 'hello', version: PROTOCOL_VERSION }));
    await new Promise(r => setTimeout(r, 1500));
    socket.close();
    check('realtime: the welcome arrives through the proxy', !!got.welcome && got.welcome.people.length > 0, got.welcome ? got.welcome.people.length + ' people' : 'none');
    check('realtime: snapshots stream (about 20 a second)', got.snapshots >= 15, got.snapshots + ' in 1.5 s');
  } catch (err) {
    check('realtime connection', false, err.message);
  }
} catch (err) {
  check(`could not reach ${base}`, false, err.message);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
// exitCode (not process.exit) lets open connections close first; exit() can crash Node on Windows.
process.exitCode = failed ? 1 : 0;
