import { afterEach, describe, expect, it } from 'vitest';
import { people, roster, setSeed, hasSlot } from '@office/shared';
import { WorldService } from './world.service';

const employee = (userId: string) => ({
  userId,
  firstName: userId,
  lastName: 'Employee',
  department: 'UI/UX',
  intern: false,
  shift: null,
  character: null,
  desk: null,
  photo: null,
});

const noDatabase = { pool: null } as never;

afterEach(() => {
  roster.list = null;
  roster.status = 'unavailable';
  setSeed(null);
});

describe('WorldService boot roster safety', () => {
  it('clears a stale roster before building a fresh world without a database', async () => {
    roster.list = [employee('stale-employee')];
    roster.status = 'ready';

    const service = new WorldService(noDatabase);
    await (service as unknown as { boot: () => Promise<unknown> }).boot();

    expect(roster.status).toBe('unavailable');
    expect(roster.list).toBeNull();
    expect(people.filter(hasSlot)).toHaveLength(0);
  });
});
