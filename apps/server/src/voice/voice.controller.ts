import { Body, Controller, ForbiddenException, HttpCode, Inject, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { SameOriginGuard, SessionGuard } from '../auth/auth.controller';
import type { Req as HttpReq } from '../auth/http';
import { PlayService } from '../play/play.service';
import { nearbyVoiceParticipants, validVoiceRoom, voiceConfig, voiceToken } from './voice';

/** Mints a short-lived LiveKit participant token without exposing the signing secret. */
@Controller('voice')
@UseGuards(SameOriginGuard, SessionGuard)
export class VoiceController {
  private readonly config = voiceConfig();

  constructor(@Inject(PlayService) private readonly players: PlayService) {}

  @Post('token')
  @HttpCode(200)
  token(@Body() body: Record<string, unknown> | undefined, @Req() req: HttpReq): {
    url: string;
    token: string;
    expiresIn: number;
    room: string;
    range: number;
    participants: number[];
    participantPositions: Array<{ accountId: number; x: number; z: number }>;
    position: { x: number; z: number };
  } {
    if (!this.config.enabled || !this.config.url) throw new ServiceUnavailableException('voice is not available');
    if (req.account!.mustChangePassword) throw new ForbiddenException({ statusCode: 403, code: 'must-change-password', message: 'choose your own password first' });
    // The public client does not need to know the configured room name. If a room is
    // supplied, validate it; otherwise bind the token to the server-configured room.
    if (body?.room !== undefined && !validVoiceRoom(body.room, this.config)) throw new ForbiddenException('invalid voice room');
    const speaker = this.players.manager().speaker(req.account!.id);
    if (!speaker) throw new ForbiddenException('the account is not playing');
    const token = voiceToken(req.account!.id, speaker.name, this.config);
    const hearers = this.players.manager().hearers();
    const participants = nearbyVoiceParticipants(speaker, hearers, this.config.range);
    const participantPositions = hearers
      .filter(participant => Number.isInteger(participant.accountId) && Number.isFinite(participant.x) && Number.isFinite(participant.z))
      .map(({ accountId, x, z }) => ({ accountId, x, z }));
    return { url: this.config.url, token: token.token, expiresIn: token.expiresIn, room: this.config.room, range: this.config.range, participants, participantPositions, position: { x: speaker.x, z: speaker.z } };
  }
}
