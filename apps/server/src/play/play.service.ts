import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AuthProvider } from '../auth/auth.provider';
import type { AuthService } from '../auth/auth.service';
import { WorldService } from '../world/world.service';
import { PlayerManager } from './player-manager';

/**
 * Builds the PlayerManager on the accounts, once the world and the accounts are both up, and makes the world agree with the
 * accounts (desks and their owners) at start-up.
 */
@Injectable()
export class PlayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private current: { auth: AuthService; manager: PlayerManager } | null = null;
  private kickHandler: ((accountId: number, reason: string) => void) | null = null;
  private readonly log = new Logger('Play');

  constructor(
    @Inject(WorldService) private readonly worlds: WorldService,
    @Inject(AuthProvider) private readonly auth: AuthProvider,
  ) {}

  /** The manager for the current auth service (made on first use; replaced if tests swap the service). */
  manager(): PlayerManager {
    const auth = this.auth.require();
    if (!this.current || this.current.auth !== auth) {
      const manager = new PlayerManager(auth.accounts, { graceMs: Number(process.env.GRACE_MS) || 30_000, log: this.log });
      if (this.kickHandler) manager.onKick(this.kickHandler);
      this.current = { auth, manager };
    }
    return this.current.manager;
  }

  /** Where kicks go (the gateway registers this). */
  onKick(fn: (accountId: number, reason: string) => void): void {
    this.kickHandler = fn;
    this.current?.manager.onKick(fn);
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

  onApplicationShutdown(): void { this.current?.manager.releaseAll(); }
}
