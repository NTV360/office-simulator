/** The last server-validated horizontal intent for each human-driven person. */
const intents = new Map<number, { x: number; z: number }>();

export function movementIntent(personId: number): { x: number; z: number } | null {
  return intents.get(personId) ?? null;
}

export function setMovementIntent(personId: number, intent: { x: number; z: number }): void {
  intents.set(personId, intent);
}

export function clearMovementIntent(personId: number): void {
  intents.delete(personId);
}

export function clearMovementIntents(): void {
  intents.clear();
}
