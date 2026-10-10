import { beforeEach, describe, expect, it } from 'vitest';
import type { EmployeeStore, ImportedEmployee } from './employee-store';

// What every employee store must do, whether it lives in memory or in PostgreSQL. The memory store runs this in employee-store.test.ts; the
// PostgreSQL one in db/db.test.ts.

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const imp = (n: number, over: Partial<ImportedEmployee> = {}): ImportedEmployee => ({
  userId: U(n), firstName: `First${n}`, lastName: `Last${n}`, department: 'UI/UX', intern: false, shift: null, character: null, desk: null, ...over,
});
const LOOK = { type: 'blocky', name: 'Mine' };

export function employeeStoreContract(label: string, make: () => Promise<EmployeeStore>, skip = false): void {
  describe.skipIf(skip)(label, () => {
    let store: EmployeeStore;
    beforeEach(async () => { store = await make(); });

    it('starts empty', async () => {
      expect(await store.list()).toEqual([]);
      expect(await store.byId(U(1))).toBeNull();
    });

    it('an import adds new people (with their look and desk from the source) and lists them by name', async () => {
      const r = await store.applyImport([imp(2, { firstName: 'Zed' }), imp(1, { firstName: 'Ana', character: LOOK, desk: 'A3', shift: { code: 'NIGHT', start: 1260, end: 360 } })]);
      expect(r).toEqual({ added: 2, updated: 0, removed: 0, restored: 0 });
      const list = await store.list();
      expect(list.map(e => e.firstName)).toEqual(['Ana', 'Zed']);
      expect(list[0]).toMatchObject({ userId: U(1), department: 'UI/UX', intern: false, character: LOOK, desk: 'A3', shift: { code: 'NIGHT', start: 1260, end: 360 }, removed: false });
      expect(list[1]).toMatchObject({ character: null, desk: null, shift: null });
    });

    it('importing the same list again changes nothing', async () => {
      const list = [imp(1, { character: LOOK, desk: 'B2', shift: { code: 'DAY', start: 540, end: 1080 } }), imp(2)];
      await store.applyImport(list);
      expect(await store.applyImport(list)).toEqual({ added: 0, updated: 0, removed: 0, restored: 0 });
    });

    it('an import updates names, department, intern flag and shift, but never the look or the desk chosen here', async () => {
      await store.applyImport([imp(1, { character: LOOK, desk: 'A1' })]);
      await store.setCharacter(U(1), { type: 'chibi', name: 'Chosen here' });
      await store.setDesk(U(1), 'C4');
      const r = await store.applyImport([imp(1, { firstName: 'Renamed', department: 'QA', intern: true, shift: { code: 'MID', start: 900, end: 0 }, character: { other: 1 }, desk: 'A1' })]);
      expect(r.updated).toBe(1);
      expect(await store.byId(U(1))).toMatchObject({ firstName: 'Renamed', department: 'QA', intern: true, shift: { code: 'MID', start: 900, end: 0 }, character: { type: 'chibi', name: 'Chosen here' }, desk: 'C4' });
    });

    it('a person with no look or desk here gets them from the source later; a desk someone else has here is not taken', async () => {
      await store.applyImport([imp(1), imp(2)]);
      await store.setDesk(U(2), 'A1');
      await store.applyImport([imp(1, { character: LOOK, desk: 'A1' }), imp(2)]);
      expect(await store.byId(U(1))).toMatchObject({ character: LOOK, desk: null }); // A1 is U(2)'s
      expect(await store.byId(U(2))).toMatchObject({ desk: 'A1' });
    });

    it('two new people from the source who chose the same desk: the first gets it', async () => {
      await store.applyImport([imp(1, { desk: 'A1' }), imp(2, { desk: 'A1' })]);
      expect([(await store.byId(U(1)))!.desk, (await store.byId(U(2)))!.desk]).toEqual(['A1', null]);
    });

    it('people no longer in the source are marked removed (and drop out of the list), and come back with their look when they return', async () => {
      await store.applyImport([imp(1), imp(2)]);
      await store.setCharacter(U(2), LOOK);
      expect((await store.applyImport([imp(1)])).removed).toBe(1);
      expect((await store.list()).map(e => e.userId)).toEqual([U(1)]);
      expect(await store.byId(U(2))).toMatchObject({ removed: true, character: LOOK });
      const back = await store.applyImport([imp(1), imp(2)]);
      expect(back).toMatchObject({ restored: 1, added: 0 });
      expect(await store.byId(U(2))).toMatchObject({ removed: false, character: LOOK });
    });

    it('a removed person\'s desk is free for someone else', async () => {
      await store.applyImport([imp(1, { desk: 'A1' }), imp(2)]);
      await store.applyImport([imp(2)]); // 1 is gone
      expect(await store.setDesk(U(2), 'A1')).toBe('ok');
    });

    it('someone who comes back after another took their desk comes back without it, and the import still goes through', async () => {
      await store.applyImport([imp(1, { desk: 'A1' }), imp(2)]);
      await store.applyImport([imp(2)]); // 1 is gone
      expect(await store.setDesk(U(2), 'A1')).toBe('ok'); // 2 takes the desk
      const r = await store.applyImport([imp(1), imp(2)]);
      expect(r).toMatchObject({ restored: 1 });
      expect(await store.byId(U(1))).toMatchObject({ removed: false, desk: null });
      expect(await store.byId(U(2))).toMatchObject({ desk: 'A1' });
    });

    it('a profile picture comes from the source every time (it is not chosen here): added, changed, removed, and back with the person', async () => {
      await store.applyImport([imp(1, { photo: 'https://img.example.test/a.png' }), imp(2)]);
      expect((await store.byId(U(1)))!.photo).toBe('https://img.example.test/a.png');
      expect((await store.byId(U(2)))!.photo).toBeNull();
      expect(await store.applyImport([imp(1, { photo: 'https://img.example.test/b.png' }), imp(2)])).toMatchObject({ updated: 1 });
      expect((await store.byId(U(1)))!.photo).toBe('https://img.example.test/b.png');
      expect(await store.applyImport([imp(1, { photo: null }), imp(2)])).toMatchObject({ updated: 1 }); // the picture was taken down
      expect((await store.byId(U(1)))!.photo).toBeNull();
      expect(await store.applyImport([imp(1, { photo: null }), imp(2, { photo: null })])).toMatchObject({ updated: 0 });
    });

    it('a source that could not read the pictures (none said) leaves the stored ones as they are', async () => {
      await store.applyImport([imp(1, { photo: 'https://img.example.test/a.png' })]);
      const { photo: _none, ...noPhoto } = imp(1);
      expect(await store.applyImport([noPhoto])).toMatchObject({ updated: 0 });
      expect((await store.byId(U(1)))!.photo).toBe('https://img.example.test/a.png');
    });

    it('a desk can be chosen once; none is always allowed; an unknown person is missing', async () => {
      await store.applyImport([imp(1), imp(2)]);
      expect(await store.setDesk(U(1), 'D5')).toBe('ok');
      expect(await store.setDesk(U(2), 'D5')).toBe('taken');
      expect(await store.setDesk(U(1), null)).toBe('ok');
      expect(await store.setDesk(U(2), 'D5')).toBe('ok');
      expect(await store.setDesk(U(99), 'D6')).toBe('missing');
      expect(await store.setCharacter(U(99), LOOK)).toBe(false);
      expect(await store.setCharacter(U(1), LOOK)).toBe(true);
    });

    it('names with accents, quotes and long text are kept as they are', async () => {
      await store.applyImport([imp(1, { firstName: "Zoë O'Brien-\"X\"", lastName: 'Ñandú 你好', department: 'R&D <b>' })]);
      expect(await store.byId(U(1))).toMatchObject({ firstName: "Zoë O'Brien-\"X\"", lastName: 'Ñandú 你好', department: 'R&D <b>' });
    });
  });
}
