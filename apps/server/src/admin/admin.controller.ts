import {
  BadRequestException, Body, ConflictException, Controller, Get, Header, Inject, Logger, Injectable, NotFoundException, Param, PipeTransform, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { HAZEL_NAME, deskSeat, interactables, live, people, type Person } from '@office/shared';
import { AuthError, generatePassword, publicAccount, type PublicAccount } from '../auth/auth.service';
import { AuthProvider } from '../auth/auth.provider';
import { clientAddress, type Req as HttpReq } from '../auth/http';
import type { AuditRow } from '../auth/account-store';
import { EmployeeService, type ImportStatus } from '../employees/employee.service';
import { SourceError } from '../employees/supabase-source';
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

/** An employee id from the address: a UUID (anything else is a 400, not a database error). */
@Injectable()
export class EmployeeIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException('the employee id must be a UUID');
    return value.toLowerCase();
  }
}

/** The answer an admin gets for a refusal from the player manager. */
function asHttp(err: unknown): never {
  if (!(err instanceof PlayError)) throw err;
  if (err.code === 'no-account' || err.code === 'no-employee') throw new NotFoundException(err.message);
  if (err.code === 'no-desk' || err.code === 'has-no-desk' || err.code === 'has-no-employee') throw new BadRequestException(err.message);
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
    @Inject(EmployeeService) private readonly employees: EmployeeService,
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

  /** Change the number of staff, the clock speed, pause, or the clock mode. Saved straight away and visible to every viewer. */
  @Put('settings')
  async update(@Body() body: unknown, @Req() req: HttpReq): Promise<Settings> {
    const change = parseSettingsUpdate(body);
    // Live follows who is clocked in: read it first, so everyone is seated as the records say when the clock switches
    if (change.clockMode === 'live' && this.employees.status.configured) await this.employees.refreshAttendance().catch(() => {});
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
  async users(): Promise<Array<{ id: number; username: string; role: string; slotSpot: string | null; employeeId: string | null; disabled: boolean; muted: boolean; mustChangePassword: boolean; hasLook: boolean; online: boolean; createdAt: Date; lastLoginAt: Date | null }>> {
    const accounts = await this.auth.require().accounts.list();
    const manager = this.play.manager();
    return accounts.map(a => ({
      id: a.id, username: a.username, role: a.role, slotSpot: a.slotSpot, employeeId: a.employeeId, disabled: a.disabled, muted: a.muted, mustChangePassword: a.mustChangePassword, hasLook: a.spec !== null,
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

  // ---- employees: the staff list, linking accounts to them, and the import from the company's records

  /** Every employee in the staff list: who they are, where they sit, whether they have a look, and which account (if any) plays them. */
  @Get('employees')
  async employeeList(): Promise<Array<{ userId: string; name: string; department: string | null; intern: boolean; shift: unknown; desk: string | null; seat: string | null; hasLook: boolean; inOffice: boolean; present: boolean; account: { id: number; username: string } | null }>> {
    const records = await this.employees.require().list();
    const linked = new Map((await this.auth.require().accounts.list()).filter(a => a.employeeId).map(a => [a.employeeId as string, a]));
    return records.map(r => {
      const person = people.find(p => p.userId === r.userId);
      const account = linked.get(r.userId);
      return {
        userId: r.userId, name: `${r.firstName} ${r.lastName}`.trim(), department: r.department, intern: r.intern, shift: r.shift, desk: r.desk,
        seat: person?.slot?.deskId ?? null, hasLook: r.character !== null, inOffice: !!person, present: !!person && person.state !== 'away',
        account: account ? { id: account.id, username: account.username } : null,
      };
    });
  }

  /** Link an account to an employee ({ "employeeId": "..." }) or unlink it ({ "employeeId": null }). Logging in then plays that employee. */
  @Post('users/:id/employee')
  async linkEmployee(@Param('id', AccountIdPipe) id: number, @Body() body: unknown, @Req() req: HttpReq): Promise<{ ok: true; employeeId: string | null; person: string | null }> {
    const employeeId = (body as { employeeId?: unknown } | null)?.employeeId;
    if (employeeId !== null && (typeof employeeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId))) throw new BadRequestException('send { "employeeId": "<uuid>" } or { "employeeId": null }');
    try {
      if (employeeId === null) {
        const person = await this.play.manager().unlinkEmployee(id);
        await this.note(req, 'employee.unlink', await this.nameOf(id));
        return { ok: true, employeeId: null, person: person?.name ?? null };
      }
      const wanted = employeeId.toLowerCase();
      const person = await this.play.manager().linkEmployee(id, wanted);
      // they must not have to make a look again if one exists: the account's and the employee's are made the same
      const accounts = this.auth.require().accounts, emp = await this.employees.require().byId(wanted), account = await accounts.byId(id);
      if (emp?.character && account && !account.spec) await accounts.setSpec(id, emp.character);
      else if (emp && !emp.character && account?.spec) { await this.employees.require().setCharacter(wanted, account.spec); await this.employees.syncWorld(); }
      await this.note(req, 'employee.link', await this.nameOf(id), { employee: person.name });
      return { ok: true, employeeId: wanted, person: person.name };
    } catch (err) { return asHttp(err); }
  }

  /** Choose an employee's desk ({ "desk": "A3" }, or null for any free desk). The employee moves there if they can. */
  @Put('employees/:userId')
  async setEmployee(@Param('userId', EmployeeIdPipe) userId: string, @Body() body: unknown, @Req() req: HttpReq): Promise<{ ok: true; desk: string | null }> {
    const b = (body ?? {}) as { desk?: unknown };
    if (b.desk === undefined) throw new BadRequestException('send { "desk": "A3" } or { "desk": null }');
    let desk: string | null = null;
    if (b.desk !== null) {
      const seat = typeof b.desk === 'string' ? deskSeat(b.desk) : null;
      if (!seat) throw new BadRequestException('there is no such desk (use a seat id such as "A3" or "HR2")');
      desk = seat.id;
    }
    const store = this.employees.require(), emp = await store.byId(userId);
    if (!emp || emp.removed) throw new NotFoundException('there is no such employee');
    if (desk) {
      const seat = deskSeat(desk)!;
      if (seat.island.department && seat.island.department !== emp.department) throw new ConflictException(`${seat.label} is for ${seat.island.department} only`);
    }
    const r = await store.setDesk(userId, desk);
    if (r === 'taken') throw new ConflictException(`${desk} was chosen by someone else`);
    if (r === 'missing') throw new NotFoundException('there is no such employee');
    await this.employees.syncWorld();
    await this.note(req, 'employee.desk', `${emp.firstName} ${emp.lastName}`.trim(), { desk });
    return { ok: true, desk };
  }

  /** What the last import from the employee records did (and whether there is a source at all). */
  @Get('import')
  importStatus(): ImportStatus & { clockMode: string } { return { ...this.employees.status, clockMode: live.mode }; }

  /** Import the employee records now. */
  @Post('import')
  async importNow(@Req() req: HttpReq): Promise<{ ok: true; result: unknown }> {
    try {
      const result = await this.employees.importNow();
      await this.note(req, 'employees.import', null, { ...result });
      return { ok: true, result };
    } catch (err) {
      if (err instanceof SourceError) throw new ConflictException(err.message);
      throw err;
    }
  }
}
