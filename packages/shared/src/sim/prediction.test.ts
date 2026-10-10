import { describe, expect, it } from 'vitest';
import { Reconciler } from './prediction';

describe('the reconciler', () => {
  it('ignores a small difference (the server believes an input for one tick; the client moved in frames)', () => {
    const r = new Reconciler();
    r.record(1, 0, 0); r.record(2, 0.15, 0);
    expect(r.reconcile({ seq: 1, x: 0.14, z: 0 }, { x: 0.3, z: 0 })).toEqual({ kind: 'none' });
    expect(r.reconcile({ seq: 2, x: 0.38, z: 0.1 }, { x: 0.6, z: 0 })).toEqual({ kind: 'none' });
  });

  it('pulls half of a bigger difference, and shifts the newer history so the same difference is not corrected twice', () => {
    const r = new Reconciler();
    r.record(1, 0, 0); r.record(2, 1, 0); r.record(3, 2, 0);
    // the server stopped the person at a wall: it says input 1 left them at x = -2 (the client had them at 0)
    const c = r.reconcile({ seq: 1, x: -2, z: 0 }, { x: 2.5, z: 0 });
    expect(c).toMatchObject({ kind: 'pull', dx: -1, dz: 0 });
    // the client applied the pull: it is now at 1.5, and its history for inputs 2 and 3 moved the same way (to 0 and 1).
    // The server, a step later, says -1. Against the shifted history (0) that is a difference of 1, so half of it (-0.5) is pulled.
    // Without the shift it would look like a difference of 2 and pull 1.0: the part already corrected would be corrected again.
    expect(r.reconcile({ seq: 2, x: -1, z: 0 }, { x: 1.5, z: 0 })).toMatchObject({ kind: 'pull', dx: -0.5 });
  });

  it('keeps pulling while the difference stays, and so converges', () => {
    const r = new Reconciler();
    let pos = { x: 10, z: 0 };
    const server = { x: 0, z: 0 }; // the person is standing still on the server, the client thinks it is 10 m away
    let seq = 0;
    for (let i = 0; i < 30; i++) {
      seq++; r.record(seq, pos.x, pos.z);
      const c = r.reconcile({ seq, x: server.x, z: server.z }, pos);
      if (c.kind === 'snap') pos = { x: c.x, z: c.z }; else if (c.kind === 'pull') pos = { x: pos.x + c.dx, z: pos.z + c.dz };
    }
    expect(Math.hypot(pos.x - server.x, pos.z - server.z)).toBeLessThan(0.55);
  });

  it('snaps when the difference is more than 3 m (a desk was taken, the world was reset)', () => {
    const r = new Reconciler();
    r.record(5, 0, 0);
    expect(r.reconcile({ seq: 5, x: 20, z: -4 }, { x: 1, z: 0 })).toMatchObject({ kind: 'snap', x: 20, z: -4 });
  });

  it('with nothing sent lately it compares with where the person is now', () => {
    const r = new Reconciler();
    expect(r.reconcile({ seq: 0, x: 5, z: 5 }, { x: 5.1, z: 5 })).toEqual({ kind: 'none' });
    expect(r.reconcile({ seq: 0, x: 8, z: 5 }, { x: 5.1, z: 5 })).toMatchObject({ kind: 'pull' });
  });

  it('a repeated ack for the same input (the server kept using it) does not pull a running player backwards', () => {
    const r = new Reconciler();
    r.record(7, 10, 0);
    expect(r.reconcile({ seq: 7, x: 10.1, z: 0 }, { x: 10.7, z: 0 }, false)).toEqual({ kind: 'none' }); // compared with the history: fine
    // the server kept using input 7 for two more ticks (10.4, then 10.7) while the person on screen ran on, a metre ahead
    expect(r.reconcile({ seq: 7, x: 10.4, z: 0 }, { x: 11.4, z: 0 }, false)).toEqual({ kind: 'none' });
    expect(r.reconcile({ seq: 7, x: 10.7, z: 0 }, { x: 11.8, z: 0 }, false)).toEqual({ kind: 'none' });
    // someone standing still is a different matter: there the person on screen should be where the server says
    const still = new Reconciler();
    still.record(7, 10, 0);
    still.reconcile({ seq: 7, x: 10, z: 0 }, { x: 10, z: 0 }, true);
    expect(still.reconcile({ seq: 7, x: 12, z: 0 }, { x: 10, z: 0 }, true)).toMatchObject({ kind: 'pull' });
  });

  it('ignores an ack older than one it has already used, and rubbish', () => {
    const r = new Reconciler();
    r.record(1, 0, 0); r.record(2, 0, 0);
    expect(r.reconcile({ seq: 2, x: 0, z: 0 }, { x: 0, z: 0 })).toEqual({ kind: 'none' });
    expect(r.reconcile({ seq: 1, x: 9, z: 9 }, { x: 0, z: 0 })).toEqual({ kind: 'none' });
    expect(r.reconcile({ seq: 3, x: NaN, z: 0 }, { x: 0, z: 0 })).toEqual({ kind: 'none' });
    expect(r.reconcile({ seq: 3, x: Infinity, z: 0 }, { x: 0, z: 0 })).toEqual({ kind: 'none' });
  });

  it('forgets old history, and a reset starts numbering again (a new connection)', () => {
    const r = new Reconciler({ keep: 3 });
    for (let i = 1; i <= 10; i++) r.record(i, i, 0);
    // input 2 was forgotten: compared with the current position instead
    expect(r.reconcile({ seq: 2, x: 8, z: 0 }, { x: 10, z: 0 })).toMatchObject({ kind: 'pull' });
    r.reset();
    r.record(1, 0, 0);
    expect(r.reconcile({ seq: 1, x: 0, z: 0 }, { x: 0, z: 0 })).toEqual({ kind: 'none' }); // (seq 1 again is not "older" after a reset)
  });

  it('over a simulated network with 100 ms each way the predicted person stays within 0.5 m of the server while walking, and the server never has to pull', () => {
    // the client walks at 1.5 m/s in frames of 16 ms, sends an input every 50 ms; the server steps every 50 ms with the latest input
    const r = new Reconciler();
    let client = 0, serverPos = 0, seq = 0, nextSend = 0, serverNext = 0, ticks = 0;
    const toServer: Array<{ at: number; seq: number }> = [];
    const toClient: Array<{ at: number; seq: number; x: number }> = [];
    let latest = 0, pulls = 0;
    for (let t = 0; t < 4000; t += 16) {
      client += 1.5 * 0.016;
      if (t >= nextSend) { seq++; r.record(seq, client, 0); toServer.push({ at: t + 100, seq }); nextSend += 50; }
      while (toServer.length && toServer[0].at <= t) latest = toServer.shift()!.seq;
      while (t >= serverNext) { if (latest > 0) serverPos += 1.5 * 0.05; ticks++; toClient.push({ at: t + 100, seq: latest, x: serverPos }); serverNext += 50; }
      while (toClient.length && toClient[0].at <= t) {
        const a = toClient.shift()!;
        const c = r.reconcile({ seq: a.seq, x: a.x, z: 0 }, { x: client, z: 0 });
        if (c.kind !== 'none') pulls++;
      }
    }
    expect(ticks).toBeGreaterThan(70);
    expect(pulls).toBe(0);
  });
});
