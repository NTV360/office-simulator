import type { Person } from './types';

/** A typed edge from a holder to one directly held character. */
export interface CharacterHold {
  holder: number;
  target: number;
  /** Relative attachment angle and height, in metres. */
  az: number;
  lift: number;
}

/** A small graph wrapper; relationships are deliberately separate from WorldObject holds. */
export class CharacterHoldGraph {
  private readonly byHolder = new Map<number, CharacterHold>();
  private readonly byTarget = new Map<number, CharacterHold>();

  getHeld(holder: number): CharacterHold | undefined { return this.byHolder.get(holder); }
  getHolder(target: number): CharacterHold | undefined { return this.byTarget.get(target); }
  has(holder: number, target: number): boolean { return this.byHolder.get(holder)?.target === target; }

  /** True when adding holder -> target would make a directed cycle. */
  createsCycle(holder: number, target: number): boolean {
    // The new edge is holder -> target. It closes a cycle when target already
    // reaches holder through existing outgoing hold edges.
    let current: number | undefined = target;
    const seen = new Set<number>();
    while (current !== undefined) {
      if (current === holder) return true;
      if (seen.has(current)) return true;
      seen.add(current);
      current = this.byHolder.get(current)?.target;
    }
    return false;
  }

  /** Add one direct relationship. A character cannot hold two things or be held twice. */
  attach(edge: CharacterHold): boolean {
    if (!Number.isInteger(edge.holder) || !Number.isInteger(edge.target) || edge.holder === edge.target) return false;
    if (this.byHolder.has(edge.holder) || this.byTarget.has(edge.target) || this.createsCycle(edge.holder, edge.target)) return false;
    this.byHolder.set(edge.holder, edge); this.byTarget.set(edge.target, edge);
    return true;
  }

  detach(holder: number): CharacterHold | undefined {
    const edge = this.byHolder.get(holder);
    if (!edge) return undefined;
    this.byHolder.delete(holder); this.byTarget.delete(edge.target);
    return edge;
  }

  detachTarget(target: number): CharacterHold | undefined {
    const edge = this.byTarget.get(target);
    if (!edge) return undefined;
    return this.detach(edge.holder);
  }

  /** Remove every edge involving a person, returning detached relationships. */
  releasePerson(id: number): CharacterHold[] {
    const out: CharacterHold[] = [];
    const direct = this.detach(id); if (direct) out.push(direct);
    const incoming = this.detachTarget(id); if (incoming) out.push(incoming);
    return out;
  }

  /** Walk the held descendants with a deterministic safety budget. */
  descendants(root: number, maxNodes = 10000): number[] {
    const out: number[] = [], stack = [root], seen = new Set<number>();
    while (stack.length && out.length < maxNodes) {
      const id = stack.pop()!;
      const edge = this.byHolder.get(id);
      if (!edge || seen.has(edge.target)) continue;
      seen.add(edge.target); out.push(edge.target); stack.push(edge.target);
    }
    return out;
  }

  /** The directly held character's mass is counted once; nested contents remain attached but are excluded. */
  effectiveMass(holder: number, massOf: (person: Person) => number, people: readonly Person[]): number {
    const target = this.byHolder.get(holder)?.target;
    if (target === undefined) return 0;
    const p = people.find(q => q.id === target);
    return p ? Math.max(0, massOf(p)) : 0;
  }

  all(): readonly CharacterHold[] { return [...this.byHolder.values()]; }
  clear(): void { this.byHolder.clear(); this.byTarget.clear(); }
}
