import {
  BadRequestException, Body, ConflictException, Controller, Get, Header, Inject, Logger, Injectable, NotFoundException, Param, PipeTransform, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { HAZEL_NAME, interactables, type Person } from '@office/shared';
import { AuthError, generatePassword, publicAccount, type PublicAccount } from '../auth/auth.service';
import { AuthProvider } from '../auth/auth.provider';
import { clientAddress, type Req as HttpReq } from '../auth/http';
import type { AuditRow } from '../auth/account-store';
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

/** What an answer with a password in it must carry: nothing keeps a copy of it. */
const NO_STORE = 'no-store';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  // what admins do, for the log (never a password)
  private readonly log = new Logger('Admin');
  private bulkRunning = false;

  constructor(
    @Inject(WorldService) private readonly worlds: WorldService,
    @Inject(PlayService) private readonly play: PlayService,
    @Inject(AuthProvider) private readonly auth: AuthProvider,
  ) {}

  /**
   * Write what an admin just did to the audit log (who: "admin", the one shared password; from which address). Never a password.
   * A failure to write is logged but does not undo or block what was done.
   */
  private async note(req: HttpReq, action: string, target: string | null, detail: Record<string, unknown> = {}): Promise<void> {
    try {
      if (this.auth.available) await this.auth.require().accounts.audit({ actorName: 'admin', action, target, detail: { ip: clientAddress(req), ...detail } });
    } catch (err) { this.log.error(`could not write the audit log: ${err instanceof Error ? err.message : String(err)}`); }
  }
  private async nameOf(id: number): Promise<string> { return (await this.auth.require().accounts.byId(id))?.username ?? `id ${id}`; }

  /** What admins did, newest first (up to 500 lines). */
  @Get('audit')
  async audit(@Query('limit') limit?: string): Promise<AuditRow[]> {
    const n = limit === undefined ? 100 : /^\d{1,3}$/.test(limit) ? Math.min(500, Math.max(1, Number(limit))) : NaN;
    if (Number.isNaN(n)) throw new BadRequestException('limit must be a whole number from 1 to 500');
    return this.auth.require().accounts.recentAudit(n);
  }

  @Get('settings')
  settings(): Settings {
    return this.worlds.settings();
  }

  /** Change the number of staff, the clock speed, or pause. Saved straight away and visible to every viewer. */
  @Put('settings')
  async update(@Body() body: unknown, @Req() req: HttpReq): Promise<Settings> {
    const change = parseSettingsUpdate(body);
    const result = await this.worlds.applySettings(change);
    await this.note(req, 'settings.update', null, { ...change });
    return result;
  }

  /** Show a message to everyone connected. */
  @Post('announce')
  async announce(@Body() body: unknown, @Req() req: HttpReq): Promise<{ ok: true }> {
    const text = (body as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || text.trim() === '' || text.length > 200) throw new BadRequestException('send { "text": "..." } with 1 to 200 characters');
    this.worlds.announce(text.trim());
    await this.note(req, 'announce', null, { length: text.trim().length });
    return { ok: true };
  }

  /** Every account: who they are, whether they have a desk, whether they are playing right now. */
  @Get('users')
  async users(): Promise<Array<{ id: number; username: string; role: string; slotSpot: string | null; disabled: boolean; muted: boolean; mustChangePassword: boolean; hasLook: boolean; online: boolean; createdAt: Date; lastLoginAt: Date | null }>> {
    const accounts = await this.auth.require().accounts.list();
    const manager = this.play.manager();
    return accounts.map(a => ({
      id: a.id, username: a.username, role: a.role, slotSpot: a.slotSpot, disabled: a.disabled, muted: a.muted, mustChangePassword: a.mustChangePassword, hasLook: a.spec !== null,
      online: manager.isOnline(a.id), createdAt: a.createdAt, lastLoginAt: a.lastLoginAt,
    }));
  }

  /** Make an account for a person in the office. There is no sign-up page: this is the only way accounts come to exist. They choose their own password at first login. */
  @Post('users')
  @Header('Cache-Control', NO_STORE)
  async createUser(@Body() body: unknown, @Req() req: HttpReq): Promise<{ account: PublicAccount; password?: string }> {
    const b = (body ?? {}) as { username?: unknown; password?: unknown };
    const generated = b.password === undefined || b.password === '' ? generatePassword() : undefined; // no password given: make one, and say it
    const account = await this.auth.require().createAccount({ username: b.username, password: generated ?? b.password, mustChange: true });
    this.log.log(`made account ${account.username} (id ${account.id})`);
    await this.note(req, 'account.create', account.username, { generatedPassword: !!generated });
    return { account: publicAccount(account), ...(generated ? { password: generated } : {}) };
  }

  /** Make many accounts at once (the whole office): each gets a generated first password, returned once, to hand out. */
  @Post('users/bulk')
  @Header('Cache-Control', NO_STORE)
  async createUsers(@Body() body: unknown, @Req() req: HttpReq): Promise<{ results: Array<{ username: string; ok: boolean; id?: number; password?: string; code?: string; message?: string }> }> {
    const names = (body as { usernames?: unknown } | null)?.usernames;
    if (!Array.isArray(names) || names.length < 1 || names.length > 200 || names.some(n => typeof n !== 'string')) throw new BadRequestException('send { "usernames": ["ana", "ben"] } with 1 to 200 names');
    if (this.bulkRunning) throw new ConflictException('another bulk creation is still running; wait a moment'); // (each one is a slow hash)
    this.bulkRunning = true;
    try {
      const auth = this.auth.require();
      const results = [];
      for (const name of names as string[]) {
        const password = generatePassword();
        try {
          const account = await auth.createAccount({ username: name, password, mustChange: true });
          results.push({ username: account.username, ok: true, id: account.id, password });
        } catch (err) {
          if (!(err instanceof AuthError)) throw err;
          results.push({ username: name.slice(0, 40), ok: false, code: err.code, message: err.message });
        }
      }
      this.log.log(`bulk: made ${results.filter(r => r.ok).length} of ${results.length} accounts`);
      await this.note(req, 'account.bulk-create', `${results.length} names`, { made: results.filter(r => r.ok).map(r => r.username), failed: results.filter(r => !r.ok).length });
      return { results };
    } finally { this.bulkRunning = false; }
  }

  /**
   * Set or reset an account's password (a typed one, or a generated one if none is sent). The password is in the answer, once.
   * Its owner must choose their own at the next login, and their sessions and connections end now.
   */
  @Post('users/:id/password')
  @Header('Cache-Control', NO_STORE)
  async resetPassword(@Param('id', AccountIdPipe) id: number, @Body() body: unknown, @Req() req: HttpReq): Promise<{ username: string; password: string }> {
    const typed = (body as { password?: unknown } | null)?.password;
    const { account, password } = await this.auth.require().adminSetPassword(id, typed);
    this.log.log(`set a new password for ${account.username} (id ${id})`);
    await this.note(req, 'password.set', account.username, { generated: typed === undefined || typed === '' });
    return { username: account.username, password };
  }

  /** Disable or enable an account. A disabled account cannot log in and is dropped at once. */
  @Post('users/:id/disabled')
  async disable(@Param('id', AccountIdPipe) id: number, @Body() body: unknown, @Req() req: HttpReq): Promise<{ id: number; disabled: boolean }> {
    const disabled = (body as { disabled?: unknown } | null)?.disabled;
    if (typeof disabled !== 'boolean') throw new BadRequestException('send { "disabled": true } or { "disabled": false }');
    const account = await this.auth.require().setDisabled(id, disabled);
    this.log.log(`${disabled ? 'disabled' : 'enabled'} account ${account.username} (id ${id})`);
    await this.note(req, disabled ? 'account.disable' : 'account.enable', account.username);
    return { id: account.id, disabled: account.disabled };
  }

  /** Mute or unmute an account's chat. A muted account can still play; what it types is not sent to anyone. */
  @Post('users/:id/muted')
  async mute(@Param('id', AccountIdPipe) id: number, @Body() body: unknown, @Req() req: HttpReq): Promise<{ id: number; muted: boolean }> {
    const muted = (body as { muted?: unknown } | null)?.muted;
    if (typeof muted !== 'boolean') throw new BadRequestException('send { "muted": true } or { "muted": false }');
    const account = await this.auth.require().setMuted(id, muted);
    this.log.log(`${muted ? 'muted' : 'unmuted'} account ${account.username} (id ${id})`);
    await this.note(req, muted ? 'account.mute' : 'account.unmute', account.username);
    return { id: account.id, muted: account.muted };
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
  async assign(@Param('id', AccountIdPipe) id: number, @Body() body: unknown, @Req() req: HttpReq): Promise<{ ok: true; spot: string; person: string }> {
    const spot = (body as { spot?: unknown } | null)?.spot;
    if (typeof spot !== 'string' || !/^desk:\d{1,4}$/.test(spot)) throw new BadRequestException('send { "spot": "desk:12" }');
    try {
      const person = await this.play.manager().assignSlot(id, spot);
      await this.note(req, 'desk.assign', await this.nameOf(id), { spot });
      return { ok: true, spot, person: person.name };
    } catch (err) { return asHttp(err); }
  }

  /** Take an account's desk away again. */
  @Post('users/:id/release-slot')
  async release(@Param('id', AccountIdPipe) id: number, @Req() req: HttpReq): Promise<{ ok: true }> {
    try {
      await this.play.manager().releaseSlot(id);
      await this.note(req, 'desk.release', await this.nameOf(id));
      return { ok: true };
    } catch (err) { return asHttp(err); }
  }
}
