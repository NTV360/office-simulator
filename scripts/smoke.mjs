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
} catch (err) {
  check(`could not reach ${base}`, false, err.message);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
// exitCode (not process.exit) lets open connections close first; exit() can crash Node on Windows.
process.exitCode = failed ? 1 : 0;
