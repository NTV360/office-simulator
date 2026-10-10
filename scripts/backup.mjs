// Backing up and restoring the database of the Docker stack.
//   npm run backup                          writes backups/office-<date>-<time>.sql (accounts, sessions, audit log, staff list, the saved world)
//   npm run backup -- --keep=14             and keeps only the newest 14 files in backups/
//   npm run backup:rehearse                 proves a backup can be restored: dumps the running database, restores it into a throwaway PostgreSQL
//                                           and compares what is in both (no change to your stack)
//   npm run restore -- backups/<file>.sql --yes    REPLACES the stack's database with that file (stops the server, restores, starts it again)
// The stack must be up (docker compose up -d). Other options: --user=office --db=office (the defaults of docker-compose.yml).
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
const command = argv.find(a => !a.startsWith('--')) ?? 'backup';
const file = argv.filter(a => !a.startsWith('--'))[1];
const USER = opt('user', process.env.POSTGRES_USER || 'office'), DB = opt('db', process.env.POSTGRES_DB || 'office');
const TABLES = ['accounts', 'sessions', 'audit_log', 'employees', 'world_state', 'schema_migrations'];

const run = (cmd, args, o = {}) => spawnSync(cmd, args, { cwd: root, maxBuffer: 1 << 30, ...o });
const compose = (...args) => run('docker', ['compose', ...args]);
const die = msg => { console.error('\n' + msg + '\n'); process.exit(1); };
const text = r => (r.stdout ? r.stdout.toString() : '').trim();

function stackDb() {
  const r = compose('exec', '-T', 'db', 'psql', '-U', USER, '-d', DB, '-tAc', 'select 1');
  if (r.status !== 0 || text(r) !== '1') die(`the stack's database does not answer (is it up? docker compose up -d).\n${r.stderr?.toString().trim() ?? ''}`);
}
/** A plain SQL dump that can be restored under any user (no owners or grants), dropping what is there first. */
function dump() {
  stackDb();
  const r = compose('exec', '-T', 'db', 'pg_dump', '-U', USER, '-d', DB, '--clean', '--if-exists', '--no-owner', '--no-privileges');
  if (r.status !== 0) die('pg_dump failed:\n' + r.stderr?.toString());
  return r.stdout;
}
const count = (runner, table) => { const r = runner(`select count(*) from ${table}`); return r.status === 0 ? text(r) : 'missing'; };
const stackSql = q => compose('exec', '-T', 'db', 'psql', '-U', USER, '-d', DB, '-tAc', q);
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

if (command === 'backup') {
  const data = dump();
  const dir = path.join(root, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const out = path.join(dir, `office-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.sql`);
  fs.writeFileSync(out, data);
  console.log(`backup written: ${path.relative(root, out)} (${(data.length / 1024).toFixed(0)} KB)`);
  const keep = Number(opt('keep', 0));
  if (keep > 0) {
    const old = fs.readdirSync(dir).filter(f => /^office-.*\.sql$/.test(f)).sort().reverse().slice(keep);
    for (const f of old) { fs.unlinkSync(path.join(dir, f)); console.log(`  removed the old backup ${f}`); }
  }
} else if (command === 'rehearse') {
  const data = dump();
  const name = `office-restore-rehearsal-${process.pid}`;
  const port = await freePort();
  let ok = false;
  try {
    const up = run('docker', ['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=test', '-e', 'POSTGRES_DB=test', '-p', `127.0.0.1:${port}:5432`, 'postgres:16-alpine']);
    if (up.status !== 0) die('could not start a throwaway PostgreSQL: ' + up.stderr?.toString());
    for (let i = 0; ; i++) {
      const q = run('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'test', '-tAc', 'select 1']);
      if (q.status === 0 && text(q) === '1') break;
      if (i > 60) die('the throwaway PostgreSQL did not become ready');
      await new Promise(r => setTimeout(r, 1000));
    }
    await new Promise(r => setTimeout(r, 1500));
    const load = run('docker', ['exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'test', '-v', 'ON_ERROR_STOP=1', '-q'], { input: data });
    if (load.status !== 0) die('restoring the dump into the throwaway database failed:\n' + load.stderr?.toString().slice(0, 2000));
    const restored = q => run('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'test', '-tAc', q]);
    console.log(`restored ${(data.length / 1024).toFixed(0)} KB into a throwaway PostgreSQL; comparing with the stack:\n`);
    let bad = 0;
    for (const t of TABLES) {
      const a = count(stackSql, t), b = count(restored, t), same = a === b && a !== 'missing';
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
  process.exit(ok ? 0 : 1);
} else if (command === 'restore') {
  if (!file) die('which file? npm run restore -- backups/office-....sql --yes');
  const full = path.resolve(root, file);
  if (!fs.existsSync(full)) die(`no such file: ${file}`);
  if (!flag('yes')) die(`this REPLACES the stack's database (${DB}) with ${file}.\nIt stops the server for a moment. Run it again with --yes to go ahead (make a backup first: npm run backup).`);
  stackDb();
  const data = fs.readFileSync(full);
  console.log('stopping the server ...');
  compose('stop', 'server');
  console.log('emptying the database and loading the backup ...');
  const wipe = compose('exec', '-T', 'db', 'psql', '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  if (wipe.status !== 0) { compose('start', 'server'); die('could not empty the database:\n' + wipe.stderr?.toString()); }
  const load = run('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', USER, '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q'], { input: data });
  if (load.status !== 0) die('loading the backup failed (the server is still stopped):\n' + load.stderr?.toString().slice(0, 2000));
  console.log('starting the server ...');
  compose('start', 'server');
  console.log('done. The server takes a few seconds to come back; people log in again if their session was newer than the backup.');
} else die(`unknown command "${command}": backup, rehearse or restore`);
