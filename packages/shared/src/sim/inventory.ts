import { CATALOGUE } from '../world/catalogue';

/** The fixed inventory board used by character mechanics. Coordinates are zero-based. */
export const INVENTORY_COLUMNS = 4;
export const INVENTORY_ROWS = 5;
export const INVENTORY_SIZE = INVENTORY_COLUMNS * INVENTORY_ROWS;
export const HOTBAR_SIZE = 3;

export type InventoryRotation = 0 | 90;
export type InventoryFootprint = readonly [width: number, height: number];
export interface InventoryItem {
  /** Stable instance id, not the catalogue type. */
  id: string;
  /** A key in the shared world catalogue. */
  type: string;
  /** Top-left cell in the inventory grid. */
  x: number;
  y: number;
  /** Clockwise quarter-turn; only 0 or 90 are valid. */
  rotation: InventoryRotation;
}
export interface InventoryState {
  /** Items are kept in insertion order for deterministic serialization. */
  items: InventoryItem[];
  /** Item ids, or null for an empty hotbar slot. */
  hotbar: Array<string | null>;
}
export interface InventoryCell { x: number; y: number }

/**
 * Inventory footprints for the existing catalogue. The catalogue remains the source of truth for item identity;
 * these are the character-inventory dimensions, deliberately separate from world collision dimensions.
 */
export const INVENTORY_FOOTPRINTS: Readonly<Record<string, InventoryFootprint>> = {
  mug: [1, 1], notebook: [2, 2], monitor: [2, 2], keyboard: [2, 1], mouse: [1, 1], cup: [1, 1],
  'cup-small': [1, 1], 'coffee-machine': [2, 2], 'water-jug': [1, 2], toaster: [2, 2], 'fruit-bowl': [2, 2],
  bananas: [2, 1], apple: [1, 1], orange: [1, 1], puck: [1, 1], 'plant-desk': [1, 1],
  piano: [3, 2], 'guitar-stand': [2, 2], console: [2, 2],
  'chair-office': [2, 2], 'chair-wood': [2, 2], 'stool-bar': [2, 2], 'stool-low': [2, 2],
  'table-dining': [4, 3], 'table-coffee': [4, 2], 'table-bar': [4, 3], sofa: [4, 2], couch: [3, 2],
  armchair: [2, 2], 'plant-floor': [2, 2], credenza: [4, 2], 'cabinet-tall': [4, 2], 'tv-stand': [4, 2],
  whiteboard: [4, 1], 'piano-stand': [3, 2],
  bandage: [1, 1], 'first-aid-box': [1, 2],
};

/** Items whose orientation can be changed while stored. Square items are harmlessly included. */
export const INVENTORY_ROTATABLE: Readonly<Record<string, boolean>> = {
  keyboard: true, notebook: true, monitor: true, 'water-jug': true, bananas: true, piano: true,
  'coffee-machine': true, toaster: true, 'fruit-bowl': true, console: true, 'guitar-stand': true,
  'table-dining': true, 'table-coffee': true, 'table-bar': true, sofa: true, couch: true, armchair: true,
  'plant-floor': true, credenza: true, 'cabinet-tall': true, 'tv-stand': true, whiteboard: true,
  'piano-stand': true, 'first-aid-box': true,
};

const validDimension = (n: number): boolean => Number.isInteger(n) && n > 0;
const validCoord = (n: number): boolean => Number.isInteger(n) && n >= 0;
const isRotation = (value: number): value is InventoryRotation => value === 0 || value === 90;

/** Return the inventory footprint for a catalogue type, including a safe 1x1 fallback for newly-added items. */
export function inventoryFootprint(type: string, rotation: InventoryRotation = 0): InventoryFootprint {
  if (!CATALOGUE[type]) throw new Error(`unknown item type "${type}"`);
  const base = INVENTORY_FOOTPRINTS[type] ?? [1, 1];
  if (!isRotation(rotation)) throw new Error(`invalid inventory rotation ${rotation}`);
  return rotation === 90 ? [base[1], base[0]] : base;
}

/** Alias that reads naturally at call sites dealing with catalogue definitions. */
export const footprintForItem = inventoryFootprint;

export function itemCanRotate(type: string): boolean {
  if (!CATALOGUE[type]) return false;
  return INVENTORY_ROTATABLE[type] ?? false;
}

export function normalizeInventoryRotation(type: string, rotation: number | undefined = 0): InventoryRotation {
  if (!CATALOGUE[type]) throw new Error(`unknown item type "${type}"`);
  if (rotation !== 0 && rotation !== 90) return 0;
  return rotation === 90 && itemCanRotate(type) ? 90 : 0;
}

export function createInventory(items: readonly InventoryItem[] = [], hotbar: readonly (string | null)[] = []): InventoryState {
  if (hotbar.length > HOTBAR_SIZE) throw new Error(`hotbar has more than ${HOTBAR_SIZE} slots`);
  const state: InventoryState = { items: [], hotbar: Array<string | null>(HOTBAR_SIZE).fill(null) };
  for (const item of items) state.items.push({ ...item });
  for (let i = 0; i < hotbar.length; i++) state.hotbar[i] = hotbar[i] ?? null;
  validateInventory(state);
  return state;
}

/** A row-major list of cells occupied by an item. */
export function itemCells(item: Pick<InventoryItem, 'type' | 'x' | 'y' | 'rotation'>): InventoryCell[] {
  const [width, height] = inventoryFootprint(item.type, item.rotation);
  return Array.from({ length: width * height }, (_, i) => ({ x: item.x + i % width, y: item.y + Math.floor(i / width) }));
}

export function itemFits(item: Pick<InventoryItem, 'type' | 'x' | 'y' | 'rotation'>): boolean {
  if (!validCoord(item.x) || !validCoord(item.y)) return false;
  if (!isRotation(item.rotation) || (item.rotation === 90 && !itemCanRotate(item.type))) return false;
  const [width, height] = inventoryFootprint(item.type, item.rotation);
  return item.x + width <= INVENTORY_COLUMNS && item.y + height <= INVENTORY_ROWS;
}

/** True when an item can occupy the requested space without touching another item. */
export function canPlaceItem(state: InventoryState, item: InventoryItem): boolean {
  if (!item.id || !CATALOGUE[item.type] || !itemFits(item)) return false;
  if (state.items.some(existing => existing.id === item.id)) return false;
  const occupied = new Set(state.items.flatMap(itemCells).map(cellKey));
  return itemCells(item).every(cell => !occupied.has(cellKey(cell)));
}

/** Find the first legal placement in deterministic row-major order, or null. */
export function findFirstFit(state: InventoryState, id: string, type: string, rotation: InventoryRotation = 0): InventoryItem | null {
  const normalized = normalizeInventoryRotation(type, rotation);
  const [width, height] = inventoryFootprint(type, normalized);
  for (let y = 0; y <= INVENTORY_ROWS - height; y++) for (let x = 0; x <= INVENTORY_COLUMNS - width; x++) {
    const item: InventoryItem = { id, type, x, y, rotation: normalized };
    if (canPlaceItem(state, item)) return item;
  }
  return null;
}

/** Add an item without mutating the previous state. Throws when authoritative validation fails. */
export function placeItem(state: InventoryState, item: InventoryItem): InventoryState {
  if (!canPlaceItem(state, item)) throw new Error(`item "${item.id}" cannot be placed in inventory`);
  return { items: [...state.items.map(existing => ({ ...existing })), { ...item }], hotbar: [...state.hotbar] };
}

/** Non-throwing form for command handlers that want to turn validation into a refusal. */
export function tryPlaceItem(state: InventoryState, item: InventoryItem): InventoryState | null {
  return canPlaceItem(state, item) ? placeItem(state, item) : null;
}

export function removeItem(state: InventoryState, id: string): InventoryState {
  if (!state.items.some(item => item.id === id)) return cloneInventory(state);
  return {
    items: state.items.filter(item => item.id !== id).map(item => ({ ...item })),
    hotbar: state.hotbar.map(slot => slot === id ? null : slot),
  };
}

/** Move an existing item (or rotate it) without changing its identity or hotbar assignment. */
export function moveItem(state: InventoryState, id: string, x: number, y: number, rotation?: number): InventoryState | null {
  const current = state.items.find(item => item.id === id);
  if (!current || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  const nextRotation = rotation === undefined ? current.rotation : normalizeInventoryRotation(current.type, rotation);
  if (rotation !== undefined && rotation !== 0 && rotation !== 90) return null;
  const candidate: InventoryItem = { ...current, x, y, rotation: nextRotation };
  const without = { items: state.items.filter(item => item.id !== id).map(item => ({ ...item })), hotbar: [...state.hotbar] };
  return canPlaceItem(without, candidate) ? { items: [...without.items, candidate], hotbar: [...without.hotbar] } : null;
}

export function rotateItem(state: InventoryState, id: string): InventoryState | null {
  const current = state.items.find(item => item.id === id);
  if (!current || !itemCanRotate(current.type)) return null;
  return moveItem(state, id, current.x, current.y, current.rotation === 0 ? 90 : 0);
}

export function setHotbarSlot(state: InventoryState, slot: number, itemId: string | null): InventoryState {
  if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SIZE) throw new Error(`invalid hotbar slot ${slot}`);
  if (itemId !== null && !state.items.some(item => item.id === itemId)) throw new Error(`unknown inventory item "${itemId}"`);
  const hotbar = [...state.hotbar]; hotbar[slot] = itemId;
  return { items: state.items.map(item => ({ ...item })), hotbar };
}

export function clearHotbarSlot(state: InventoryState, slot: number): InventoryState { return setHotbarSlot(state, slot, null); }

export function itemAtCell(state: InventoryState, x: number, y: number): InventoryItem | null {
  if (!validCoord(x) || !validCoord(y) || x >= INVENTORY_COLUMNS || y >= INVENTORY_ROWS) return null;
  return state.items.find(item => itemCells(item).some(cell => cell.x === x && cell.y === y)) ?? null;
}

/** Stable JSON representation, useful for revisions, tests, and deterministic command logs. */
export function inventoryFingerprint(state: InventoryState): string {
  return JSON.stringify({ items: state.items.map(item => ({ ...item })), hotbar: [...state.hotbar] });
}

export function cloneInventory(state: InventoryState): InventoryState {
  return { items: state.items.map(item => ({ ...item })), hotbar: [...state.hotbar] };
}

export function validateInventory(state: InventoryState): void {
  if (!Array.isArray(state.items) || !Array.isArray(state.hotbar) || state.hotbar.length !== HOTBAR_SIZE) throw new Error('invalid inventory shape');
  const ids = new Set<string>();
  const cells = new Set<string>();
  for (const item of state.items) {
    if (ids.has(item.id)) throw new Error(`duplicate inventory item "${item.id}"`);
    if (!canPlaceAgainstCells(item, cells, ids)) throw new Error(`invalid inventory item "${item.id}"`);
    ids.add(item.id); for (const cell of itemCells(item)) cells.add(cellKey(cell));
  }
  for (const id of state.hotbar) if (id !== null && !ids.has(id)) throw new Error(`hotbar references unknown item "${id}"`);
}

function canPlaceAgainstCells(item: InventoryItem, cells: Set<string>, ids: Set<string>): boolean {
  return !!item.id && !ids.has(item.id) && !!CATALOGUE[item.type] && itemFits(item) && itemCells(item).every(cell => !cells.has(cellKey(cell)));
}
function cellKey(cell: InventoryCell): string { return `${cell.x},${cell.y}`; }
