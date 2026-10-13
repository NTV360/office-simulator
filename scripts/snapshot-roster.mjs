// Save the roster the dev server has imported as a fixture for the offline/seeded checks (the golden recordings):  npm run snapshot:roster
// It reads the dev database (the container made by `npm run dev:online`), so it makes no outside call. The file holds real employee names:
// it is git-ignored on purpose (tests/fixtures/roster.local.json) and must never be committed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests/fixtures/roster.local.json');
const container = process.env.DEV_DB_CONTAINER || 'office-dev-db';

const sql = `select coalesce(json_agg(json_build_object('userId', user_id, 'firstName', first_name, 'lastName', last_name, 'department', department,
  'intern', intern, 'shift', shift, 'character', character, 'desk', desk, 'photo', null) order by user_id), '[]'::json) from employees where not removed`;
const run = spawnSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'office', '-t', '-A', '-c', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (run.status !== 0) { console.error(`could not read the roster from ${container}: ${(run.stderr || '').trim()}\nIs npm run dev:online running (or has it been)?`); process.exit(1); }

const list = JSON.parse(run.stdout.trim());
if (!list.length) { console.error('the roster is empty: nothing to save (has the server imported the real employees yet?)'); process.exit(1); }
if (new Set(list.map(e => e.userId)).size !== list.length) { console.error('duplicate employee ids in the roster'); process.exit(1); }

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(list, null, 1) + '\n');
console.log(`saved ${list.length} employees to ${path.relative(root, out)} (git-ignored: it holds real names)`);
