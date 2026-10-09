import { BadRequestException } from '@nestjs/common';
import { SPEED_RANGE } from '../world/world';

/** What an admin may change while the server runs. Every field is optional. */
export interface SettingsUpdate {
  /** How many staff the office has. Clamped to the number of desks. */
  slots?: number;
  /** Clock speed, clamped to 0.25 to 8. */
  speed?: number;
  paused?: boolean;
}

export interface Settings {
  slots: number;
  maxSlots: number;
  speed: number;
  paused: boolean;
  tickRate: number;
}

/** Check an untrusted request body. Unknown fields, wrong types and non-finite numbers are refused with a message. */
export function parseSettingsUpdate(body: unknown): SettingsUpdate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequestException('send a JSON object');
  const out: SettingsUpdate = {};
  const known = new Set(['slots', 'speed', 'paused']);
  for (const key of Object.keys(body)) if (!known.has(key)) throw new BadRequestException(`unknown setting "${key}"`);
  const b = body as Record<string, unknown>;
  if (b.slots !== undefined) {
    if (typeof b.slots !== 'number' || !Number.isInteger(b.slots)) throw new BadRequestException('slots must be a whole number');
    if (b.slots < 0) throw new BadRequestException('slots cannot be negative');
    out.slots = b.slots;
  }
  if (b.speed !== undefined) {
    if (typeof b.speed !== 'number' || !Number.isFinite(b.speed)) throw new BadRequestException('speed must be a number');
    out.speed = Math.min(SPEED_RANGE[1], Math.max(SPEED_RANGE[0], b.speed));
  }
  if (b.paused !== undefined) {
    if (typeof b.paused !== 'boolean') throw new BadRequestException('paused must be true or false');
    out.paused = b.paused;
  }
  if (Object.keys(out).length === 0) throw new BadRequestException('nothing to change: send slots, speed or paused');
  return out;
}
