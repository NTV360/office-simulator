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
  it('the event-loop figures are for the time since the last look (a second look starts afresh)', async () => {
    await fetch(base + '/api/world');
    await new Promise(r => setTimeout(r, 300));
    const b = await (await fetch(base + '/api/world')).json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(b.process.eventLoopMaxMs).toBeLessThan(500);
  });
});
