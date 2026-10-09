import { describe, expect, it } from 'vitest';
import { buildHealth } from './health';

describe('buildHealth', () => {
  it('is ok when the database answers', () => {
    const h = buildHealth({ dbOk: true, startedAt: 1_000, now: 6_400 });
    expect(h).toEqual({ status: 'ok', db: 'ok', uptimeSeconds: 5, protocol: 5 });
  });

  it('is degraded, not failed, when the database is down', () => {
    const h = buildHealth({ dbOk: false, startedAt: 0, now: 0 });
    expect(h.status).toBe('degraded');
    expect(h.db).toBe('down');
  });

  it('never reports negative uptime', () => {
    expect(buildHealth({ dbOk: true, startedAt: 5_000, now: 1_000 }).uptimeSeconds).toBe(0);
  });
});
