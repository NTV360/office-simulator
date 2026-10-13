import { describe, expect, it } from 'vitest';
import {
  HOTBAR_SIZE, INVENTORY_COLUMNS, INVENTORY_ROWS, INVENTORY_SIZE, canPlaceItem, createInventory,
  findFirstFit, inventoryFingerprint, itemAtCell, itemCells, itemCanRotate, inventoryFootprint,
  placeItem, removeItem, setHotbarSlot, tryPlaceItem, validateInventory,
} from './inventory';

describe('authoritative inventory', () => {
  it('uses a 4 by 5 board and three hotbar slots', () => {
    expect(INVENTORY_SIZE).toBe(20);
    expect([INVENTORY_COLUMNS, INVENTORY_ROWS, HOTBAR_SIZE]).toEqual([4, 5, 3]);
    expect(createInventory()).toEqual({ items: [], hotbar: [null, null, null] });
  });

  it('uses catalogue types, dimensions, and quarter-turns deterministically', () => {
    expect(inventoryFootprint('notebook')).toEqual([2, 2]);
    expect(inventoryFootprint('keyboard', 90)).toEqual([1, 2]);
    expect(itemCanRotate('keyboard')).toBe(true);
    expect(itemCanRotate('mug')).toBe(false);
    expect(itemCells({ type: 'keyboard', x: 1, y: 2, rotation: 90 })).toEqual([{ x: 1, y: 2 }, { x: 1, y: 3 }]);
    expect(() => inventoryFootprint('not-a-catalogue-item')).toThrow();
  });

  it('rejects out-of-bounds, duplicate, overlapping, and non-rotatable placements', () => {
    const empty = createInventory();
    expect(canPlaceItem(empty, { id: 'mug-1', type: 'mug', x: 3, y: 4, rotation: 0 })).toBe(true);
    expect(canPlaceItem(empty, { id: 'book-1', type: 'notebook', x: 3, y: 4, rotation: 0 })).toBe(false);
    const withBook = placeItem(empty, { id: 'book-1', type: 'notebook', x: 0, y: 0, rotation: 0 });
    expect(canPlaceItem(withBook, { id: 'mug-1', type: 'mug', x: 1, y: 1, rotation: 0 })).toBe(false);
    expect(canPlaceItem(withBook, { id: 'book-1', type: 'notebook', x: 2, y: 2, rotation: 0 })).toBe(false);
    expect(canPlaceItem(empty, { id: 'mug-1', type: 'mug', x: 0, y: 0, rotation: 90 })).toBe(false);
    expect(tryPlaceItem(empty, { id: 'mug-1', type: 'mug', x: 9, y: 0, rotation: 0 })).toBeNull();
  });

  it('finds the first row-major fit and preserves inputs', () => {
    const state = placeItem(createInventory(), { id: 'book-1', type: 'notebook', x: 0, y: 0, rotation: 0 });
    const found = findFirstFit(state, 'keyboard-1', 'keyboard', 90);
    expect(found).toEqual({ id: 'keyboard-1', type: 'keyboard', x: 2, y: 0, rotation: 90 });
    expect(state.items).toHaveLength(1);
    expect(inventoryFingerprint(state)).toBe(JSON.stringify({ items: [{ id: 'book-1', type: 'notebook', x: 0, y: 0, rotation: 0 }], hotbar: [null, null, null] }));
  });

  it('removes items and clears stale hotbar references', () => {
    let state = placeItem(createInventory(), { id: 'mug-1', type: 'mug', x: 0, y: 0, rotation: 0 });
    state = setHotbarSlot(state, 1, 'mug-1');
    expect(itemAtCell(state, 0, 0)?.id).toBe('mug-1');
    state = removeItem(state, 'mug-1');
    expect(state).toEqual({ items: [], hotbar: [null, null, null] });
    expect(itemAtCell(state, 0, 0)).toBeNull();
  });

  it('validates JSON-safe state and rejects corrupt hotbars', () => {
    const state = createInventory([{ id: 'mug-1', type: 'mug', x: 0, y: 0, rotation: 0 }], ['mug-1']);
    expect(() => validateInventory(state)).not.toThrow();
    expect(() => validateInventory({ ...state, hotbar: ['missing', null, null] })).toThrow();
  });
});
