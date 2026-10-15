import type { Pool } from 'pg';
import { SaveError, parseSavedWorld, type SavedWorld } from '@office/shared';

/** Reads and writes the saved world (one row). */
export class WorldStore {
  constructor(private readonly pool: Pool) {}

  /** The saved world, or null if there is none. A save that cannot be read is moved aside (never lost) and reported as an error. */
  async load(): Promise<SavedWorld | null> {
    // Read and, if necessary, quarantine under the same row lock. Otherwise a save can
    // replace the malformed row between the read and the cleanup DELETE.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ data: unknown }>('SELECT data FROM world_state WHERE id = 1 FOR UPDATE');
      if (res.rowCount === 0) {
        await client.query('COMMIT');
        return null;
      }
      const raw = res.rows[0].data;
      try {
        const saved = parseSavedWorld(raw);
        await client.query('COMMIT');
        return saved;
      } catch (err) {
        const reason = err instanceof SaveError ? err.message : String(err);
        await client.query('INSERT INTO world_state_rejected (data, reason) VALUES ($1, $2)', [JSON.stringify(raw), reason]);
        await client.query('DELETE FROM world_state WHERE id = 1');
        await client.query('COMMIT');
        throw new SaveError(`the saved world could not be read (${reason}); it was kept in world_state_rejected`);
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async save(world: SavedWorld): Promise<void> {
    await this.pool.query(
      'INSERT INTO world_state (id, data, saved_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, saved_at = now()',
      [JSON.stringify(world)],
    );
  }
}
