/** Server settings and their defaults. Real values come from the server's environment. */
export const DEFAULTS = {
  /** How many times per second the server steps the world and sends a snapshot. */
  tickRate: 20,
  /** Hard cap on players connected at once. */
  maxPlayers: 100,
  /** How many character slots (desks with a person) exist when the world is first created. */
  slotCount: 40,
} as const;

/** Keep a requested slot count between 0 and the number of desks. */
export function clampSlotCount(requested: number, desks: number): number {
  if (!Number.isFinite(requested)) return 0;
  return Math.max(0, Math.min(Math.floor(requested), desks));
}
