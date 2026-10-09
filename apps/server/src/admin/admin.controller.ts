import {
  BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, NotFoundException, Param, PipeTransform, Post, Put, UseGuards,
} from '@nestjs/common';
import { HAZEL_NAME, interactables, type Person } from '@office/shared';
import { publicAccount, type PublicAccount } from '../auth/auth.service';
import { AuthProvider } from '../auth/auth.provider';
import { PlayError } from '../play/player-manager';
import { PlayService } from '../play/play.service';
import { WorldService } from '../world/world.service';
import { AdminGuard } from './admin.guard';
import { parseSettingsUpdate, type Settings } from './settings';

/** An account id from the address: a whole number a database id can be (anything else is a 400, not a database error). */
@Injectable()
export class AccountIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^\d{1,10}$/.test(value)) throw new BadRequestException('the account id must be a whole number');
    const n = Number(value);
    if (n < 1 || n > 2_147_483_647) throw new BadRequestException('the account id is out of range');
    return n;
  }
}

/** The answer an admin gets for a refusal from the player manager. */
function asHttp(err: unknown): never {
  if (!(err instanceof PlayError)) throw err;
  if (err.code === 'no-account') throw new NotFoundException(err.message);
  if (err.code === 'no-desk' || err.code === 'has-no-desk') throw new BadRequestException(err.message);
  throw new ConflictException(err.message);
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    @Inject(WorldService) private readonly worlds: WorldService,
    @Inject(PlayService) private readonly play: PlayService,
    @Inject(AuthProvider) private readonly auth: AuthProvider,
  ) {}

  @Get('settings')
  settings(): Settings {
    return this.worlds.settings();
  }

  /** Change the number of staff, the clock speed, or pause. Saved straight away and visible to every viewer. */
  @Put('settings')
  async update(@Body() body: unknown): Promise<Settings> {
    return this.worlds.applySettings(parseSettingsUpdate(body));
  }

  /** Show a message to everyone connected. */
  @Post('announce')
  announce(@Body() body: unknown): { ok: true } {
    const text = (body as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || text.trim() === '' || text.length > 200) throw new BadRequestException('send { "text": "..." } with 1 to 200 characters');
    this.worlds.announce(text.trim());
    return { ok: true };
  }

  /** Every account: who they are, whether they have a desk, whether they are playing right now. */
  @Get('users')
  async users(): Promise<Array<{ id: number; username: string; role: string; slotSpot: string | null; disabled: boolean; online: boolean; createdAt: Date; lastLoginAt: Date | null }>> {
    const accounts = await this.auth.require().accounts.list();
    const manager = this.play.manager();
    return accounts.map(a => ({
      id: a.id, username: a.username, role: a.role, slotSpot: a.slotSpot, disabled: a.disabled,
      online: manager.isOnline(a.id), createdAt: a.createdAt, lastLoginAt: a.lastLoginAt,
    }));
  }

  /** Make an account for a person in the office. There is no sign-up page: this is the only way accounts come to exist. They choose their own password at first login. */
  @Post('users')
  async createUser(@Body() body: unknown): Promise<{ account: PublicAccount }> {
    const b = (body ?? {}) as { username?: unknown; password?: unknown };
    return { account: publicAccount(await this.auth.require().createAccount({ username: b.username, password: b.password, mustChange: true })) };
  }

  /** Every desk with a person at it: free to give away, belonging to an account, or reserved (Hazel). */
  @Get('slots')
  async slots(): Promise<Array<{ spot: string; place: string; person: string; status: 'unclaimed' | 'claimed' | 'reserved'; account: { id: number; username: string } | null }>> {
    const accounts = new Map((await this.auth.require().accounts.list()).map(a => [a.id, a]));
    const out = [];
    for (const desk of interactables.of('desk')) {
      const person = desk.owner as Person | undefined;
      if (!person) continue;
      const owner = person.owner !== undefined ? accounts.get(person.owner) : undefined;
      out.push({
        spot: desk.id, place: desk.place, person: person.name,
        status: person.name === HAZEL_NAME ? 'reserved' as const : person.owner !== undefined ? 'claimed' as const : 'unclaimed' as const,
        account: owner ? { id: owner.id, username: owner.username } : null,
      });
    }
    return out;
  }

  /** Give an account one of the unclaimed desks. */
  @Post('users/:id/assign-slot')
  async assign(@Param('id', AccountIdPipe) id: number, @Body() body: unknown): Promise<{ ok: true; spot: string; person: string }> {
    const spot = (body as { spot?: unknown } | null)?.spot;
    if (typeof spot !== 'string' || !/^desk:\d{1,4}$/.test(spot)) throw new BadRequestException('send { "spot": "desk:12" }');
    try {
      const person = await this.play.manager().assignSlot(id, spot);
      return { ok: true, spot, person: person.name };
    } catch (err) { return asHttp(err); }
  }

  /** Take an account's desk away again. */
  @Post('users/:id/release-slot')
  async release(@Param('id', AccountIdPipe) id: number): Promise<{ ok: true }> {
    try {
      await this.play.manager().releaseSlot(id);
      return { ok: true };
    } catch (err) { return asHttp(err); }
  }
}
