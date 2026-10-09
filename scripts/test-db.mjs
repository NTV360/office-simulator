// Runs the database tests against a throwaway PostgreSQL in Docker (started and removed here).   npm run test:db
import { spawnSync } from 'node:child_process';
import net from 'node:net';

// docker needs no shell (and a shell would split the SQL text); npx on Windows does
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', shell: cmd === 'npx' && process.platform === 'win32', ...opts });
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

const name = `office-test-db-${process.pid}`;
const port = await freePort();
let code = 1;
try {
  const run = sh('docker', ['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=test', '-e', 'POSTGRES_DB=test', '-p', `127.0.0.1:${port}:5432`, 'postgres:16-alpine']);
  if (run.status !== 0) throw new Error('could not start PostgreSQL in Docker: ' + run.stderr);
  for (let i = 0; i < 60; i++) {
    // pg_isready can be true during the init restart, so require a real query
    const q = sh('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'test', '-tAc', 'select 1']);
    if (q.status === 0 && q.stdout.trim() === '1') break;
    await new Promise(r => setTimeout(r, 1000));
    if (i === 59) throw new Error('PostgreSQL did not become ready');
  }
  await new Promise(r => setTimeout(r, 1500));
  const t = sh('npx', ['vitest', 'run', 'apps/server/src/db'], { stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: `postgres://postgres:test@127.0.0.1:${port}/test` } });
  code = t.status ?? 1;
} catch (err) {
  console.error(err.message);
} finally {
  sh('docker', ['rm', '-f', name]);
}
process.exitCode = code;
