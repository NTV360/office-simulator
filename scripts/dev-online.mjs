// The whole game on your PC with fast reloads, for working on multiplayer:  npm run dev:online
//   - PostgreSQL in Docker (one container, "office-dev-db", kept between runs so accounts stay),
//   - the server (restarts when you change apps/server), with the shared package rebuilt when you change packages/shared,
//   - the page on http://localhost:5173 (reloads when you change apps/client or packages/shared).
// Open http://localhost:5173/?online in two browser windows (use a private window for the second: the login is per browser).
// Ctrl+C stops the server and the page; the database container keeps running (docker stop office-dev-db to stop it).
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'office-dev-db';
const DB_PORT = process.env.DEV_DB_PORT || '5433';
const ADMIN = { user: 'boss', pass: 'dev-admin-pass', token: 'dev-admin-token' }; // development only: this database lives on your PC

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
const die = msg => { console.error('\n' + msg + '\n'); process.exit(1); };

if (sh('docker', ['info']).status !== 0) die('Docker is not running. Start Docker Desktop, wait until it says it is running, and try again.');

// ---- the database
const state = sh('docker', ['inspect', '-f', '{{.State.Running}}', DB]);
if (state.status !== 0) {
  console.log(`creating the database container "${DB}" (first run only)...`);
  const run = sh('docker', ['run', '-d', '--name', DB, '-p', `127.0.0.1:${DB_PORT}:5432`, '-e', 'POSTGRES_PASSWORD=dev', '-e', 'POSTGRES_DB=office', '-v', 'office-dev-pgdata:/var/lib/postgresql/data', 'postgres:16-alpine']);
  if (run.status !== 0) die(`could not start PostgreSQL: ${run.stderr.trim()}\n(If the port ${DB_PORT} is taken, run again with DEV_DB_PORT=5434.)`);
} else if (state.stdout.trim() !== 'true') {
  const start = sh('docker', ['start', DB]);
  if (start.status !== 0) die(`could not start the database container: ${start.stderr.trim()}`);
}
process.stdout.write('waiting for the database');
for (let i = 0; ; i++) {
  const q = sh('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'office', '-tAc', 'select 1']);
  if (q.status === 0 && q.stdout.trim() === '1') break;
  if (i > 60) die('the database did not become ready');
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, 1000));
}
console.log(' ready');

// ---- the shared package (the server reads its built copy), then the server and the page
const win = process.platform === 'win32';
const children = [];
const start = (name, cmd, args, env = {}) => {
  const child = spawn(cmd, args, { cwd: root, shell: win, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = chunk => String(chunk).split(/\r?\n/).filter(Boolean).forEach(l => console.log(`[${name}] ${l}`));
  child.stdout.on('data', tag); child.stderr.on('data', tag);
  child.on('exit', code => { if (!stopping) { console.log(`[${name}] stopped (${code})`); stop(1); } });
  children.push(child);
  return child;
};
let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const c of children) { if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F']); else c.kill('SIGTERM'); }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log('building the shared package...');
if (spawnSync('npm', ['run', 'build', '-w', '@office/shared'], { cwd: root, shell: win, stdio: 'inherit' }).status !== 0) die('the shared package did not build');

start('shared', 'npm', ['run', 'build', '-w', '@office/shared', '--', '--watch']);
start('server', 'npm', ['run', 'dev', '-w', '@office/server'], {
  PORT: '3000', DATABASE_URL: `postgres://postgres:dev@127.0.0.1:${DB_PORT}/office`,
  ADMIN_USERNAME: ADMIN.user, ADMIN_PASSWORD: ADMIN.pass, ADMIN_TOKEN: ADMIN.token,
});
start('page', 'npm', ['run', 'dev']);

setTimeout(() => console.log(`
==================================================================================
  The game:   http://localhost:5173/?online      (open it in two windows to see yourself from outside)
  Admin page: http://localhost:5173/admin        password: ${ADMIN.token}
  First login: user "${ADMIN.user}", password "${ADMIN.pass}" (it asks you to choose a new one).
  Make more accounts on the admin page, and give each a desk.
  Ctrl+C stops the server and the page. The database keeps running: docker stop ${DB}
==================================================================================
`), 6000);
