import { Controller, ForbiddenException, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SameOriginGuard, SessionGuard } from './auth.controller';
import type { Req as HttpReq } from './http';
import { TicketService } from './tickets';

@Controller('play')
@UseGuards(SameOriginGuard)
export class PlayController {
  constructor(@Inject(TicketService) private readonly tickets: TicketService) {}

  /** Ask for a one-time ticket to open the realtime connection. Needs a logged-in session. */
  @Post('ticket')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  ticket(@Req() req: HttpReq): { ticket: string; expiresInMs: number } {
    // an account an admin has just made plays only after its person has chosen their own password
    if (req.account!.mustChangePassword) throw new ForbiddenException({ statusCode: 403, code: 'must-change-password', message: 'choose your own password first' });
    const sessionHash = createHash('sha256').update(req.sessionToken!).digest('hex');
    return this.tickets.mint(req.account!.id, sessionHash);
  }
}
