import { PROTOCOL_VERSION } from '@office/shared';

export interface HealthInput {
  /** Whether the database answered a trivial query. */
  dbOk: boolean;
  /** When the process started, in ms since the epoch. */
  startedAt: number;
  /** The current time, in ms since the epoch. */
  now: number;
}

export interface Health {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  uptimeSeconds: number;
  protocol: number;
}

/** What `GET /api/health` reports. Pure so it can be tested without a server or a database. */
export function buildHealth({ dbOk, startedAt, now }: HealthInput): Health {
  return {
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'down',
    uptimeSeconds: Math.max(0, Math.round((now - startedAt) / 1000)),
    protocol: PROTOCOL_VERSION,
  };
}
