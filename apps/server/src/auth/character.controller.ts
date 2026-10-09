import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { DEFAULT_SPEC, normalizePlayerSpec, type CharacterSpec } from '@office/shared';
import { PlayService } from '../play/play.service';
import { AuthProvider } from './auth.provider';
import { SameOriginGuard, SessionGuard } from './auth.controller';
import { AuthError } from './auth.service';
import type { Req as HttpReq } from './http';
import { RateLimiter } from './rate-limit';

/** How people look. Your own look only: the account always comes from the session, never from the request. */
@Controller('character')
@UseGuards(SameOriginGuard, SessionGuard)
export class CharacterController {
  // a look is a few hundred bytes of text, but every change is announced to every viewer: 10 a minute is plenty for a creation page
  private readonly changes = new RateLimiter(10, 60_000);

  constructor(
    @Inject(AuthProvider) private readonly auth: AuthProvider,
    @Inject(PlayService) private readonly play: PlayService,
  ) {}

  /** Your saved look (or null if you have never made one), and the starting look the creation page begins from. */
  @Get()
  get(@Req() req: HttpReq): { spec: CharacterSpec | null; starting: CharacterSpec } {
    if (req.account!.mustChangePassword) throw new ForbiddenException({ statusCode: 403, code: 'must-change-password', message: 'choose your own password first' });
    const saved = req.account!.spec;
    return { spec: saved ? normalizePlayerSpec(saved) : null, starting: normalizePlayerSpec(DEFAULT_SPEC) };
  }

  /**
   * Save your look and show it to everyone at once. Whatever is sent is made valid first (a wrong colour or style falls back to the
   * default, the height is held to the allowed range), and the looks that belong to Hazel (skirt, cube head, angry face) are dropped.
   */
  @Put()
  @HttpCode(200)
  async put(@Body() body: unknown, @Req() req: HttpReq): Promise<{ spec: CharacterSpec }> {
    const account = req.account!;
    if (account.mustChangePassword) throw new ForbiddenException({ statusCode: 403, code: 'must-change-password', message: 'choose your own password first' });
    const sent = (body as { spec?: unknown } | null)?.spec;
    if (!sent || typeof sent !== 'object' || Array.isArray(sent)) throw new BadRequestException('send { "spec": { ... } }');
    if (!this.changes.allow(String(account.id))) throw new AuthError('rate', 'too many changes; wait a minute');
    const spec = normalizePlayerSpec(sent);
    await this.auth.require().accounts.setSpec(account.id, spec);
    this.play.manager().applyLook(account.id, spec);
    return { spec };
  }
}
