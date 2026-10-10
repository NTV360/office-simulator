import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setSeed } from '@office/shared';
import { AppModule } from '../app.module';
import { configureApp } from '../app.config';

// What /api/world says about the running server: the numbers a load test (npm run bots) and an operator read against the budgets in the plan.

process.env.WORLD_SEED = '1';
delete process.env.DATABASE_URL;
let app: INestApplication, base: string;
beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
afterAll(async () => { await app.close(); setSeed(null); });

describe('GET /api/world', () => {
  it('reports the tick percentiles and the process (memory and event-loop delay), as numbers', async () => {
    await new Promise(r => setTimeout(r, 700)); // a few ticks
    const w = await (await fetch(base + '/api/world')).json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(w.tickMs.p99Ms).toBeGreaterThanOrEqual(w.tickMs.p50Ms);
    expect(w.tickMs.p50Ms).toBeGreaterThanOrEqual(0);
    for (const k of ['rssMb', 'heapMb', 'eventLoopP99Ms', 'eventLoopMaxMs']) expect(Number.isFinite(w.process[k]), k).toBe(true);
    expect(w.process.rssMb).toBeGreaterThan(20);
    expect(w.process.heapMb).toBeLessThan(w.process.rssMb);
  });
  it('looking does not empty the event-loop window for anyone else; ?fresh=1 does', async () => {
    const first = await (await fetch(base + '/api/world?fresh=1')).json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(first.process.eventLoopMaxMs).toBeGreaterThanOrEqual(0);
    await new Promise(r => setTimeout(r, 60)); // (Node's histogram misses a stall in the very first interval after it is emptied)
    const t0 = Date.now(); while (Date.now() - t0 < 120) { /* stall the loop for a moment */ }
    await new Promise(r => setTimeout(r, 50));
    const a = await (await fetch(base + '/api/world')).json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const b = await (await fetch(base + '/api/world')).json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(a.process.eventLoopMaxMs).toBeGreaterThan(50); // the stall is seen
    expect(b.process.eventLoopMaxMs, 'a second plain look sees it too').toBeGreaterThanOrEqual(a.process.eventLoopMaxMs);
    const c = await (await fetch(base + '/api/world?fresh=1')).json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const d = await (await fetch(base + '/api/world')).json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(c.process.eventLoopMaxMs).toBeGreaterThan(50);
    expect(d.process.eventLoopMaxMs, 'after a fresh look the window starts again').toBeLessThan(a.process.eventLoopMaxMs);
  });
});
