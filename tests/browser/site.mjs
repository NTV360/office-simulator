// Shared by the browser runners: serve the freshly built client (or use VERIFY_URL), open pages, collect console errors.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Ask the OS for an unused port, so two checkouts can run this at the same time (set VERIFY_PORT to force one).
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// ---- the site under test
// Vite does not export its binary, so find it from its package.json (it may or may not be hoisted).
function findVite() {
  for (const d of ['apps/client/node_modules/vite', 'node_modules/vite']) {
    const dir = path.join(root, d), pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) { const bin = JSON.parse(fs.readFileSync(pj, 'utf8')).bin; return path.join(dir, typeof bin === 'string' ? bin : bin.vite); }
  }
  throw new Error('vite is not installed; run npm install');
}

async function startSite() {
  if (process.env.VERIFY_URL) return { url: process.env.VERIFY_URL.replace(/\/$/, ''), stop() {} };
  execSync('npm run build -w @office/client', { cwd: root, stdio: 'ignore' }); // always test the current source
  const vite = findVite();
  const port = Number(process.env.VERIFY_PORT) || await freePort();
  const child = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: path.join(root, 'apps/client'), stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return { url, stop: () => child.kill() }; } catch { /* not up yet */ }
    await sleep(250);
  }
  child.kill();
  throw new Error('the preview server did not start');
}


// ---- helpers
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  return errors;
}

// A server behind the site (the Docker stack)? Asked from Node, so the browser console stays clean.
const serverCache = new Map();
async function serverBehind(url) {
  if (!serverCache.has(url)) {
    try {
      // (a plain static preview answers every path with the page itself, so look for the world, not just a 200)
      const r = await fetch(url + '/api/world');
      serverCache.set(url, r.ok && typeof (await r.json()).tick === 'number');
    } catch { serverCache.set(url, false); }
  }
  return serverCache.get(url);
}

/** The password every test account uses. */
const TEST_PASSWORD = 'verify-test-pass-1';

/**
 * Make an account the way an admin does (there is no sign-up): the server's ADMIN_TOKEN is in VERIFY_ADMIN_TOKEN.
 * The account starts on `first`, a password the person must replace at first login.
 */
export async function adminCreate(url, username, first) {
  const token = process.env.VERIFY_ADMIN_TOKEN;
  if (!token) throw new Error(`no account "${username}" and no VERIFY_ADMIN_TOKEN to make it with`);
  const r = await fetch(url + '/api/admin/users', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ username, password: first }) });
  if (!r.ok && r.status !== 409) throw new Error(`could not make ${username}: ${r.status} ${await r.text()}`);
}

/** Call the admin API (VERIFY_ADMIN_TOKEN): resolves { status, body }. */
export async function adminJson(url, method, path, body) {
  const r = await fetch(url + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.VERIFY_ADMIN_TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** Give this browser context a logged-in session for the account, making the account (and choosing its own password) the first time. */
async function loginAs(context, url, username, password = TEST_PASSWORD) {
  const body = { username, password };
  let r = await context.request.post(url + '/api/auth/login', { data: body });
  if (r.status() === 401) {
    const first = 'first-pass-from-admin-1';
    await adminCreate(url, username, first);
    r = await context.request.post(url + '/api/auth/login', { data: { username, password: first } });
    if (r.ok()) r = await context.request.post(url + '/api/auth/password', { data: { current: first, next: password } });
    if (r.ok()) r = await context.request.post(url + '/api/auth/login', { data: body });
  }
  if (!r.ok()) throw new Error(`could not log in as ${username}: ${r.status()} ${await r.text()}`);
}

/**
 * Open the page and wait until it is ready. If a server is behind the site and the page will go online (no ?seed, no ?offline),
 * it is logged in first: as `opts.login` if given, else as the shared test account verify_a. Pass `login: null` to stay logged out.
 */
async function openPage(browser, url, query = '', opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  const online = !/seed=|offline/.test(query) && await serverBehind(url);
  const login = opts.login === undefined ? (online ? 'verify_a' : null) : opts.login;
  if (login) await loginAs(context, url, login, opts.password);
  await page.goto(`${url}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__simReady === true, null, { timeout: 90000 });
  return { page, errors, context };
}


export { sleep, freePort, findVite, startSite, collectErrors, openPage, loginAs, TEST_PASSWORD };
