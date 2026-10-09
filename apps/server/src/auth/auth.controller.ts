import {
  CanActivate, Body, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Inject, Injectable, Post, Req, Res, UnsupportedMediaTypeException, UseGuards,
} from '@nestjs/common';
import { AuthError, publicAccount, type AuthService, type Context, type PublicAccount } from './auth.service';
import { AuthProvider } from './auth.provider';
import { SESSION_COOKIE, clearedCookie, clientAddress, header, isSecure, parseCookies, sessionCookie, type Req as HttpReq, type Res as HttpRes } from './http';

/**
 * Refuses a state-changing request that a browser says came from another site (its Origin is not our own host). Together with
 * SameSite=Strict on the cookie this closes cross-site request forgery.
 */
@Injectable()
export class SameOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<HttpReq>();
    // only JSON is accepted as a body: a plain HTML form (the easy way to forge a request from another site) is not
    const type = header(req, 'content-type');
    if (type && !type.toLowerCase().startsWith('application/json')) throw new UnsupportedMediaTypeException('send JSON');
    const origin = header(req, 'origin');
    if (!origin) return true; // not a browser form or fetch from a page (a script, a test)
    let host: string;
    try { host = new URL(origin).host; } catch { throw new ForbiddenException('bad origin'); }
    const own = header(req, 'x-forwarded-host') ?? header(req, 'host');
    if (host !== own) throw new ForbiddenException('cross-site request refused');
    return true;
  }
}

/** Requires a valid session cookie and attaches the account to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthProvider) private readonly auth: AuthProvider) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<HttpReq>();
    const token = parseCookies(header(req, 'cookie'))[SESSION_COOKIE];
    const account = await this.auth.require().authenticate(token);
    if (!account) throw new AuthError('unauthenticated', 'not logged in');
    req.account = account;
    req.sessionToken = token;
    return true;
  }
}

const context = (req: HttpReq): Context => ({ ip: clientAddress(req), userAgent: header(req, 'user-agent') ?? null });

@Controller('auth')
@UseGuards(SameOriginGuard)
export class AuthController {
  constructor(@Inject(AuthProvider) private readonly auth: AuthProvider) {}

  private svc(): AuthService { return this.auth.require(); }

  @Post('register')
  async register(@Body() body: Record<string, unknown> | undefined, @Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes): Promise<{ account: PublicAccount }> {
    const { account, token } = await this.svc().register({ username: body?.username, password: body?.password, signupCode: body?.signupCode }, context(req));
    res.setHeader('Set-Cookie', sessionCookie(token, isSecure(req)));
    return { account: publicAccount(account) };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: Record<string, unknown> | undefined, @Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes): Promise<{ account: PublicAccount }> {
    const { account, token } = await this.svc().login({ username: body?.username, password: body?.password }, context(req));
    res.setHeader('Set-Cookie', sessionCookie(token, isSecure(req)));
    return { account: publicAccount(account) };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: HttpReq, @Res({ passthrough: true }) res: HttpRes): Promise<{ ok: true }> {
    await this.svc().logout(parseCookies(header(req, 'cookie'))[SESSION_COOKIE]);
    res.setHeader('Set-Cookie', clearedCookie(isSecure(req)));
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() req: HttpReq): { account: PublicAccount } {
    return { account: publicAccount(req.account!) };
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async password(@Body() body: Record<string, unknown> | undefined, @Req() req: HttpReq): Promise<{ ok: true }> {
    await this.svc().changePassword(req.account!, req.sessionToken, body?.current, body?.next);
    return { ok: true };
  }
}

