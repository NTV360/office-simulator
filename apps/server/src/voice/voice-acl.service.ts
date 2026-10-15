import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { RoomServiceClient } from 'livekit-server-sdk';
import { TrackType } from '@livekit/protocol';
import { PlayService } from '../play/play.service';
import { nearbyVoiceParticipants, voiceConfig, type VoiceConfig } from './voice';

/**
 * Keeps LiveKit audio subscriptions aligned with authoritative player positions.
 * The browser may still hide or detach tracks, but it cannot opt into a track
 * that the server has not granted through the Room Service API.
 */
@Injectable()
export class VoiceAclService implements OnApplicationShutdown {
  private readonly log = new Logger('VoiceAcl');
  private readonly config: VoiceConfig = voiceConfig();
  private readonly client: RoomServiceClient | null;
  private readonly granted = new Map<string, Set<string>>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private closed = false;

  constructor(private readonly players: PlayService) {
    this.client = this.config.enabled && this.config.apiUrl && this.config.apiKey && this.config.apiSecret
      ? new RoomServiceClient(this.config.apiUrl, this.config.apiKey, this.config.apiSecret)
      : null;
  }

  /** Start bounded reconciliation without making ordinary gameplay depend on voice. */
  onApplicationBootstrap(): void {
    if (!this.client || this.closed) return;
    this.timer = setInterval(() => { void this.reconcile(); }, 1000);
    void this.reconcile();
  }

  /** Reconcile every connected participant's permitted audio track SIDs. */
  async reconcile(): Promise<void> {
    if (!this.client || this.closed || this.running) return;
    this.running = true;
    try {
      const participants = await this.client.listParticipants(this.config.room);
      if (this.closed) return;
      const positions = this.players.manager().hearers();
      const byAccount = new Map(positions.map(participant => [String(participant.accountId), participant]));
      const liveIdentities = new Set(participants.map(participant => participant.identity));
      const tracks = new Map<string, string[]>();

      for (const participant of participants) {
        const accountId = Number(participant.identity);
        if (!Number.isInteger(accountId) || accountId < 1) continue;
        tracks.set(participant.identity, participant.tracks
          .filter(track => {
            const type = String(track.type).toUpperCase();
            return (type === 'AUDIO' || type === '0' || Number(track.type) === Number(TrackType.AUDIO)) && !!track.sid;
          })
          .map(track => track.sid));
      }

      for (const listener of participants) {
        const listenerPosition = byAccount.get(listener.identity);
        const desired = new Set<string>();
        if (listenerPosition) {
          const allowed = new Set(
            nearbyVoiceParticipants(listenerPosition, positions, this.config.range)
              .filter(accountId => String(accountId) !== listener.identity),
          );
          for (const source of participants) {
            if (source.identity === listener.identity || !allowed.has(Number(source.identity))) continue;
            for (const sid of tracks.get(source.identity) ?? []) desired.add(sid);
          }
        }
        await this.update(listener.identity, desired);
      }

      for (const identity of [...this.granted.keys()]) {
        if (!liveIdentities.has(identity)) {
          await this.update(identity, new Set());
          this.granted.delete(identity);
        }
      }
    } catch (error) {
      this.log.warn(`voice ACL reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async update(identity: string, desired: Set<string>): Promise<void> {
    if (!this.client || this.closed) return;
    const previous = this.granted.get(identity) ?? new Set<string>();
    const add = [...desired].filter(sid => !previous.has(sid));
    const remove = [...previous].filter(sid => !desired.has(sid));
    if (add.length) await this.client.updateSubscriptions(this.config.room, identity, add, true);
    if (this.closed) return;
    if (remove.length) await this.client.updateSubscriptions(this.config.room, identity, remove, false);
    if (!this.closed) this.granted.set(identity, new Set(desired));
  }

  onApplicationShutdown(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.granted.clear();
  }
}
