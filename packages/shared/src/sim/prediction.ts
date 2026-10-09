// Client-side prediction, the part that can be plain code. The client moves your person at once (with the same collision and speed
// rules as the server) and sends inputs numbered 1, 2, 3...; the server answers each tick with an `ack`: the number of the last input
// it used and where your person is. The reconciler compares that with where the client's own history says it was when it sent that
// input, and says how far to pull. See docs/PHASE-4-BREAKDOWN.md, decision 1.
//
// It is deliberately tolerant instead of an exact replay of every input: a small difference is normal (the server believes an input for
// one tick, the client moved in frames), so differences up to `threshold` are ignored.

export interface Pos { x: number; z: number }
export interface AckLike { seq: number; x: number; z: number }

/** What to do about an ack: nothing, a pull (add dx, dz to the predicted position), or snap (put the person at the server's position). */
export type Correction = { kind: 'none' } | { kind: 'pull'; dx: number; dz: number; error: number } | { kind: 'snap'; x: number; z: number; error: number };

export interface ReconcilerOptions {
  /** A difference smaller than this (metres) is ignored. The server may use an input for a tick or two longer than the client did: 0.3 m while running, so 0.5 leaves room for that. */
  threshold?: number;
  /** A difference bigger than this (metres) is a teleport (a desk was taken, the world was reset): snap, do not glide. */
  snapDistance?: number;
  /** The fraction of the difference pulled in on each ack that is over the threshold. */
  pull?: number;
  /** How many sent inputs to remember. */
  keep?: number;
}

export class Reconciler {
  private trail: Array<{ seq: number; x: number; z: number }> = [];
  private readonly threshold: number;
  private readonly snapDistance: number;
  private readonly pull: number;
  private readonly keep: number;
  /** The newest ack number seen: an older one is ignored (a late or repeated message). */
  private newest = 0;

  constructor(opts: ReconcilerOptions = {}) {
    this.threshold = opts.threshold ?? 0.5;
    this.snapDistance = opts.snapDistance ?? 3;
    this.pull = opts.pull ?? 0.5;
    this.keep = opts.keep ?? 120;
  }

  /** Forget everything (a new connection numbers its inputs from 1 again). */
  reset(): void { this.trail = []; this.newest = 0; }

  /** Input `seq` is being sent while the predicted person is at (x, z). */
  record(seq: number, x: number, z: number): void {
    this.trail.push({ seq, x, z });
    if (this.trail.length > this.keep) this.trail.splice(0, this.trail.length - this.keep);
  }

  /**
   * The server says that after input `ack.seq` the person was at (ack.x, ack.z). `current` is where the predicted person is now.
   * Returns what to do. The history is kept consistent: after a pull, later inputs are shifted by the same amount, so the next ack
   * is not corrected a second time for the same difference.
   */
  reconcile(ack: AckLike, current: Pos): Correction {
    if (!Number.isFinite(ack.x) || !Number.isFinite(ack.z) || ack.seq < this.newest) return { kind: 'none' };
    this.newest = ack.seq;
    const at = this.trail.find(e => e.seq === ack.seq);
    // an input we still remember: compare with where we were when we sent it. Otherwise (nothing sent for a while, or an input from
    // before we started keeping history) compare with where we are now.
    const ref = at ?? current;
    const ex = ack.x - ref.x, ez = ack.z - ref.z, error = Math.hypot(ex, ez);
    this.trail = this.trail.filter(e => e.seq > ack.seq);
    if (error <= this.threshold) return { kind: 'none' };
    if (error > this.snapDistance) { this.trail = []; return { kind: 'snap', x: ack.x, z: ack.z, error }; }
    const dx = ex * this.pull, dz = ez * this.pull;
    for (const e of this.trail) { e.x += dx; e.z += dz; }
    return { kind: 'pull', dx, dz, error };
  }
}
