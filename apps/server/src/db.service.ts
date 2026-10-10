import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

/** The connection to Postgres. In phase 0 it only answers "is the database reachable?". */
@Injectable()
export class DbService implements OnApplicationShutdown {
  readonly pool: Pool | null;

  constructor() {
    const url = process.env.DATABASE_URL;
    this.pool = url ? new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 2000 }) : null;
    // An idle client dropping must not crash the server.
    this.pool?.on('error', err => console.error('database pool error:', err.message));
  }

  async check(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /** After everything that still needs the database has had its say (the world saves itself in beforeApplicationShutdown, which runs before this). */
  private closed = false;
  async onApplicationShutdown(): Promise<void> {
    if (this.closed) return; // (a second stop signal must not close it twice)
    this.closed = true;
    await this.pool?.end();
  }
}
