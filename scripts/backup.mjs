// Backing up and restoring the database of the Docker stack.
//   npm run backup                          writes backups/office-<date>-<time>.sql (accounts, sessions, audit log, staff list, the saved world)
//   npm run backup -- --keep=14             and keeps only the newest 14 backups (office-YYYYMMDD-HHMMSS.sql; files you named yourself are never removed)
//   npm run backup:rehearse                 proves a backup can be restored: dumps the running database, restores it into a throwaway PostgreSQL
//                                           and compares what is in both (no change to your stack)
//   npm run restore -- backups/<file>.sql --yes    REPLACES the stack's database with that file (a safety backup of what is there first, then stops
//                                           the server, restores in one transaction, starts it again)
// The stack must be up (docker compose up -d). Other options: --user=office --db=office (default: POSTGRES_USER / POSTGRES_DB from .env, else office).
// What is not in a backup: the pictures and code (git has those) and the secrets in .env (keep that file safe yourself).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = n => argv.some(a => a === `--${n}`);
const opt = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const positional = argv.filter(a => !a.startsWith('--'));
const command = positional[0] ?? 'backup';
const file = positional[1];

/** A value from .env (npm run does not load it), else from the environment. */
function envValue(name) {
  try {
    const m = fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, 'm'));
    if (m) return m[1].replace(/^(["'])(.*)\1$/, '$2');
  } catch { /* no .env: the defaults of docker-compose.yml */ }
  return process.env[name];
}
const USER = opt('user', envValue('POSTGRES_USER') || 'office'), DB = opt('db', envValue('POSTGRES_DB') || 'office');
const TABLES = ['accounts', 'sessions', 'audit_log', 'employees', 'world_state', 'schema_migrations'];
const LIVE_TABLES = new Set(['sessions', 'audit_log']); // (change with every login on the running stack: a difference there is not a failed restore)

const run = (cmd, args, o = {}) => spawnSync(cmd, args, { cwd: root, maxBuffer: 1 << 30, ...o });
const compose = (...args) => run('docker', ['compose', ...args]);
const text = r => (r.stdout ? r.stdout.toString() : '').trim();
class Stop extends Error {}
const die = msg => { throw new Stop(msg); };

function stackDb() {
  const r = compose('exec', '-T', 'db', 'psql', '-U', USER, `--dbname=${DB}`, '-tAc', 'select 1');
  if (r.status !== 0 || text(r) !== '1') die(`the stack's database does not answer (is it up? docker compose up -d).\n${r.stderr?.toString().trim() ?? ''}`);
}
/** A plain SQL dump that can be restored under any user (no owners or grants), dropping what is there first. */
function dump() {
  stackDb();
  const r = compose('exec', '-T', 'db', 'pg_dump', '-U', USER, `--dbname=${DB}`, '--clean', '--if-exists', '--no-owner', '--no-privileges');
  if (r.status !== 0) die('pg_dump failed:\n' + r.stderr?.toString());
  if (!isCompleteDump(r.stdout)) die('the dump is cut short (too big to hold in memory?): not using it');
  return r.stdout;
}
/** pg_dump ends every complete dump with this line. */
const isCompleteDump = buf => buf.subarray(Math.max(0, buf.length - 400)).toString().includes('PostgreSQL database dump complete');
const count = (runner, table) => { const r = runner(`select count(*) from ${table}`); return r.status === 0 ? text(r) : 'missing'; };
const stackSql = q => compose('exec', '-T', 'db', 'psql', '-U', USER, `--dbname=${DB}`, '-tAc', q);
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

const BACKUP = /^office-\d{8}-\d{6}(?:-\d+)?\.sql$/;
/** Writes backups/office-<date>-<time>.sql (a second one in the same second gets -1, -2 ...); returns its path. */
function writeBackup(data, label = '') {
  const dir = path.join(root, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const stem = `office-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let out = path.join(dir, `${stem}.sql`);
  for (let i = 1; fs.existsSync(out); i++) out = path.join(dir, `${stem}-${i}.sql`);
  fs.writeFileSync(out, data);
  console.log(`${label}backup written: ${path.relative(root, out)} (${(data.length / 1024).toFixed(0)} KB)`);
  return out;
}

async function main() {
  for (const [n, v] of [['user', USER], ['db', DB]]) if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(v)) die(`--${n} "${v}" is not a plain name`);
  if (command === 'backup') {
    const keep = Number(opt('keep', 0));
    if (!Number.isInteger(keep) || keep < 0) die('--keep must be a whole number (how many backups to keep)');
    writeBackup(dump());
    if (keep > 0) {
      const dir = path.join(root, 'backups');
      const old = fs.readdirSync(dir).filter(f => BACKUP.test(f))
        .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(keep);
      for (const { f } of old) { fs.unlinkSync(path.join(dir, f)); console.log(`  removed the old backup ${f}`); }
    }
  } else if (command === 'rehearse') {
    const data = dump();
    const name = `office-restore-rehearsal-${process.pid}`;
    const port = await freePort();
    let ok = false;
    try {
      const up = run('docker', ['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=test', '-e', 'POSTGRES_DB=test', '-p', `127.0.0.1:${port}:5432`, 'postgres:16-alpine']);
      if (up.status !== 0) die('could not start a throwaway PostgreSQL: ' + up.stderr?.toString());
      // (over TCP: the temporary server that runs while the image initialises listens only on its socket)
      for (let i = 0; ; i++) {
        const q = run('docker', ['exec', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'test', '-tAc', 'select 1']);
        if (q.status === 0 && text(q) === '1') break;
        if (i > 60) die('the throwaway PostgreSQL did not become ready');
        await new Promise(r => setTimeout(r, 1000));
      }
      const load = run('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'test', '-v', 'ON_ERROR_STOP=1', '-q'], { input: data });
      if (load.status !== 0) die('restoring the dump into the throwaway database failed:\n' + load.stderr?.toString().slice(0, 2000));
      const restored = q => run('docker', ['exec', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'test', '-tAc', q]);
      console.log(`restored ${(data.length / 1024).toFixed(0)} KB into a throwaway PostgreSQL; comparing with the stack:\n`);
      let bad = 0;
      for (const t of TABLES) {
        const a = count(stackSql, t), b = count(restored, t);
        // (the stack goes on running: new logins add rows to these two after the dump was taken)
        const same = a !== 'missing' && b !== 'missing' && (a === b || (LIVE_TABLES.has(t) && Number(b) <= Number(a)));
        if (!same) bad++;
        console.log(`  ${same ? 'ok  ' : 'MISS'}  ${t.padEnd(18)} stack ${a.padStart(6)}   restored ${b.padStart(6)}`);
      }
      // the stack saves its world every few seconds, so a checksum of it moves between the dump and now: compare what does not (how many people, the save version)
      const shape = r => text(r("select coalesce(jsonb_array_length(data->'people'), -1) || ' people, version ' || coalesce(data->>'version', '?') || ', ' || coalesce(jsonb_array_length(data->'deskOrder'), -1) || ' desks in order' from world_state limit 1"));
      const a = shape(stackSql), b = shape(restored);
      console.log(`  ${a === b && a ? 'ok  ' : 'MISS'}  ${'the saved world'.padEnd(18)} stack ${a || 'none'}  |  restored ${b || 'none'}`);
      if (a !== b || !a) bad++;
      ok = bad === 0;
      console.log(ok ? '\nthe backup restores: a rehearsal that passed.' : `\n${bad} difference(s): this backup would NOT restore the same data.`);
    } finally { run('docker', ['rm', '-f', name]); }
    if (!ok) process.exitCode = 1;
  } else if (command === 'restore') {
    if (!file) die('which file? npm run restore -- backups/office-....sql --yes');
    const full = path.resolve(root, file);
    if (!fs.existsSync(full)) die(`no such file: ${file}`);
    if (!flag('yes')) die(`this REPLACES the stack's database (${DB}) with ${file}.\nIt stops the server for a moment. Run it again with --yes to go ahead (a backup of what is there now is made first).`);
    const data = fs.readFileSync(full);
    if (!isCompleteDump(data)) die(`${file} is not a complete backup (it does not end the way pg_dump output does): nothing was changed.`);
    stackDb();
    writeBackup(dump(), 'safety ');
    console.log('stopping the server ...');
    const stop = compose('stop', 'server');
    if (stop.status !== 0) die('could not stop the server (nothing was changed):\n' + stop.stderr?.toString());
    console.log('emptying the database and loading the backup (all or nothing) ...');
    // one session and one transaction: a file that fails half way leaves the database as it was
    const load = run('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', USER, `--dbname=${DB}`, '-1', '-v', 'ON_ERROR_STOP=1', '-q', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;', '-f', '-'], { input: data });
    const start = compose('start', 'server');
    if (load.status !== 0) die(`loading the backup failed; the database is as it was (the server was started again):\n${load.stderr?.toString().slice(0, 2000)}`);
    if (start.status !== 0) die('the backup is loaded, but the server did not start: docker compose start server\n' + start.stderr?.toString());
    console.log('done. The server takes a few seconds to come back; people log in again if their session was newer than the backup.');
  } else die(`unknown command "${command}": backup, rehearse or restore`);
}

try { await main(); } catch (e) {
  if (!(e instanceof Stop)) throw e;
  console.error('\n' + e.message + '\n');
  process.exitCode = 1;
}
