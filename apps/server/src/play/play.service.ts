import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AuthProvider } from '../auth/auth.provider';
import type { AuthService } from '../auth/auth.service';
import { WorldService } from '../world/world.service';
import { PlayerManager, type PlayerNote } from './player-manager';

/**
 * Builds the PlayerManager on the accounts, once the world and the accounts are both up, and makes the world agree with the
 * accounts (desks and their owners) at start-up.
 */
@Injectable()
export class PlayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private current: { auth: AuthService; manager: PlayerManager } | null = null;
  private kickHandler: ((accountId: number, reason: string) => void) | null = null;
  private removeManagerKick: (() => void) | null = null;
  private noteHandler: ((accountId: number, note: PlayerNote) => void) | null = null;
  private removeManagerNote: (() => void) | null = null;
  private readonly log = new Logger('Play');
  private readonly removeBeforeStep: () => void;
  private readonly removeImpactListener: () => void;

  constructor(
    @Inject(WorldService) private readonly worlds: WorldService,
    @Inject(AuthProvider) private readonly auth: AuthProvider,
  ) {
    // people a human drives are moved at the start of every tick, from their latest input
    this.removeBeforeStep = this.worlds.world.onBeforeStep((dt, tick) => { if (this.auth.available) this.manager().stepAll(dt, tick); });
    // Item physics reports fast contacts after each step; the manager owns health, knockback and hold cleanup.
    this.removeImpactListener = this.worlds.world.onItemImpact(impact => { if (this.auth.available) this.manager().applyItemImpact(impact); });
  }

  /** The manager for the current auth service (made on first use; replaced if tests swap the service). */
  manager(): PlayerManager {
    const auth = this.auth.require();
    if (!this.current || this.current.auth !== auth) {
      this.removeManagerKick?.();
      this.removeManagerKick = null;
      this.removeManagerNote?.();
      this.removeManagerNote = null;
      this.current?.manager.releaseAll();
      const manager = new PlayerManager(auth.accounts, { graceMs: Number(process.env.GRACE_MS) || 30_000, log: this.log });
      if (this.kickHandler) this.removeManagerKick = manager.onKick(this.kickHandler);
      if (this.noteHandler) this.removeManagerNote = manager.onNotify(this.noteHandler);
      this.current = { auth, manager };
    }
    return this.current.manager;
  }

  /** Where kicks go (the gateway registers this). */
  onKick(fn: (accountId: number, reason: string) => void): () => void {
    this.removeManagerKick?.();
    this.removeManagerKick = null;
    this.kickHandler = fn;
    if (this.current) this.removeManagerKick = this.current.manager.onKick(fn);
    return () => {
      if (this.kickHandler !== fn) return;
      this.removeManagerKick?.();
      this.removeManagerKick = null;
      this.kickHandler = null;
    };
  }

  /** Where notes for one player go (the gateway registers this): what a medkit holds, how a care is going. */
  onNotify(fn: (accountId: number, note: PlayerNote) => void): () => void {
    this.removeManagerNote?.();
    this.removeManagerNote = null;
    this.noteHandler = fn;
    if (this.current) this.removeManagerNote = this.current.manager.onNotify(fn);
    return () => {
      if (this.noteHandler !== fn) return;
      this.removeManagerNote?.();
      this.removeManagerNote = null;
      this.noteHandler = null;
    };
  }

  /** After start-up (and in tests after the accounts are in place): make the world agree with the accounts. */
  async reconcile(): Promise<void> {
    if (!this.auth.available) return;
    const r = await this.manager().reconcile();
    if (r.claimed || r.released) this.log.log(`desks reconciled with the accounts: ${r.claimed} claimed, ${r.released} released`);
  }

  async onApplicationBootstrap(): Promise<void> {
    await Promise.all([this.worlds.ready, this.auth.ready]);
    await this.reconcile().catch(err => this.log.error(`reconciling desks failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  onApplicationShutdown(): void {
    this.removeBeforeStep();
    this.removeImpactListener();
    this.removeManagerKick?.();
    this.removeManagerKick = null;
    this.removeManagerNote?.();
    this.removeManagerNote = null;
    this.kickHandler = null;
    this.noteHandler = null;
    this.current?.manager.releaseAll();
  }
}
