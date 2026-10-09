import { Inject, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { DecodeError, HAZEL_NAME, PROTOCOL_VERSION, addLog, decodeClient, encode, people, sim, simEvents, type ClientMessage } from '@office/shared';
import { addressKey } from '../auth/http';
import { parseTrustProxy } from '../app.config';
import { AuthProvider } from '../auth/auth.provider';
import type { SessionEnd } from '../auth/auth.service';
import { TicketService } from '../auth/tickets';
import { ChatService, type SayResult } from '../play/chat';
import { EmoteService } from '../play/emotes';
import { PlayService } from '../play/play.service';
import { RageService } from '../play/shared-events';
import { WorldService } from '../world/world.service';
import { Broadcaster } from './broadcaster';

/** The one Socket.IO event both sides use; its payload is always one binary protocol message. */
export const WIRE_EVENT = 'm';
const PLAYING = 'playing';

export interface GatewayOptions {
  /** A client must say hello (with a valid ticket) within this long or it is dropped. */
  helloTimeoutMs: number;
  maxClients: number;
  /** How many connections from one address may be waiting to say hello at once (a flood of silent sockets is the cheap attack). */
  maxUnjoinedPerAddress: number;
  /** How often open connections have their session checked again (a session can expire or be ended while connected). */
  sweepMs: number;
  /** Messages per second a client that has not said hello may send before it is dropped. */
  maxMessagesPerSecond: number;
  /** The same for a client that is playing: inputs come about 20 times a second, plus the occasional sit, stand and ping. */
  maxJoinedMessagesPerSecond: number;
}
export const gatewayOptions = (env: Record<string, string | undefined>): GatewayOptions => ({
  helloTimeoutMs: Number(env.HELLO_TIMEOUT_MS) || 5000,
  maxClients: Number(env.MAX_CLIENTS) || 200,
  maxUnjoinedPerAddress: Number(env.MAX_UNJOINED_PER_ADDRESS) || 20,
  sweepMs: Number(env.SESSION_SWEEP_MS) || 60_000,
  maxMessagesPerSecond: Number(env.MAX_MESSAGES_PER_SECOND) || 20,
  maxJoinedMessagesPerSecond: Number(env.MAX_JOINED_MESSAGES_PER_SECOND) || 60,
});

// websocket only (no HTTP long-polling), no per-message compression (the payload is already compact), small input limit
@WebSocketGateway({
  path: '/socket.io',
  transports: ['websocket'],
  perMessageDeflate: false,
  maxHttpBufferSize: 8 * 1024,
  cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : false,
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger('Gateway');
  private broadcaster!: Broadcaster;
  private readonly options = gatewayOptions(process.env);
  /** The one live connection of each account. */
  private readonly byAccount = new Map<number, Socket>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(WorldService) private readonly worlds: WorldService,
    @Inject(AuthProvider) private readonly auth: AuthProvider,
    @Inject(TicketService) private readonly tickets: TicketService,
    @Inject(PlayService) private readonly players: PlayService,
  ) {}

  private chat!: ChatService;
  private emotes!: EmoteService;
  private rage!: RageService;

  afterInit(): void {
    const world = this.worlds.world;
    this.rage = new RageService({ hazelPresent: () => people.some(p => p.name === HAZEL_NAME && p.state !== 'away') });
    this.emotes = new EmoteService({ personOf: id => this.players.manager().speaker(id)?.personId ?? null });
    this.chat = new ChatService({
      speaker: id => this.players.manager().speaker(id),
      hearers: () => this.players.manager().hearers(),
      muted: async id => (await this.auth.require().accountById(id))?.muted ?? false,
    });
    this.broadcaster = new Broadcaster({ tickRate: world.options.tickRate });
    simEvents.on('personAdded', p => this.broadcast(this.broadcaster.joined(p)));
    simEvents.on('personRemoved', p => this.broadcast(this.broadcaster.left(p.id)));
    simEvents.on('personUpdated', p => this.broadcast(this.broadcaster.joined(p))); // who drives them, their name or look changed
    this.players.onKick((accountId, reason) => this.kickAccount(accountId, reason));
    simEvents.on('announce', text => this.broadcast(encode({ type: 'event', kind: 'announce', simTime: sim.t, text })));
    this.auth.onSessionEnd(e => this.onSessionEnd(e));
    this.sweepTimer = setInterval(() => { void this.sweep(); }, this.options.sweepMs);
    this.sweepTimer.unref();
    world.onTick(tick => {
      if (this.server.sockets.adapter.rooms.get(PLAYING)?.size) {
        this.server.to(PLAYING).volatile.emit(WIRE_EVENT, this.broadcaster.snapshot(tick)); // a client that is behind skips it
        this.sendAcks(tick);
      } else this.broadcaster.snapshot(tick); // keep change tracking moving even with nobody watching
      for (const e of this.broadcaster.events()) this.broadcast(e);
    });
  }

  handleConnection(socket: Socket): void {
    if (this.server.engine.clientsCount > this.options.maxClients) { this.kick(socket, 'the server is full'); return; }
    const address = this.addressOf(socket);
    socket.data.address = address;
    if (this.unjoinedFrom(address) > this.options.maxUnjoinedPerAddress) { this.kick(socket, 'too many connections from your address'); return; }
    const timer = setTimeout(() => this.kick(socket, 'no hello'), this.options.helloTimeoutMs);
    socket.once('disconnect', () => clearTimeout(timer));
    socket.data.timer = timer;
    socket.on(WIRE_EVENT, (data: unknown) => this.onMessage(socket, data));
  }

  handleDisconnect(socket: Socket): void {
    const id = socket.data.accountId as number | undefined;
    if (id !== undefined && this.byAccount.get(id) === socket) {
      this.byAccount.delete(id);
      if (socket.data.joined) { this.players.manager().detach(id); addLog(`${socket.data.username} left`); } // (everybody sees it in the activity log); their person stays for the grace period, then goes back to autopilot
    }
  }

  /** Disconnect an account's connection, with the reason (an admin changed its desk, for example). */
  kickAccount(accountId: number, reason: string): void {
    const socket = this.byAccount.get(accountId);
    if (socket) this.kick(socket, reason);
  }

  private onMessage(socket: Socket, data: unknown): void {
    try {
      if (this.tooFast(socket)) { this.kick(socket, 'too many messages'); return; }
      let msg: ClientMessage;
      try {
        if (!(data instanceof Uint8Array)) throw new DecodeError('messages are binary');
        msg = decodeClient(data);
      } catch (err) {
        this.kick(socket, err instanceof DecodeError ? `bad message: ${err.message}` : 'bad message');
        return;
      }
      this.handle(socket, msg);
    } catch (err) {
      // whatever went wrong, it must never take the server down
      this.log.error(`message handler failed: ${err instanceof Error ? err.message : String(err)}`);
      this.kick(socket, 'server error');
    }
  }

  /** A one-second window counter per client. */
  private tooFast(socket: Socket): boolean {
    const now = Date.now(), w = socket.data.window as { start: number; n: number } | undefined;
    if (!w || now - w.start >= 1000) { socket.data.window = { start: now, n: 1 }; return false; }
    return ++w.n > (socket.data.joined ? this.options.maxJoinedMessagesPerSecond : this.options.maxMessagesPerSecond);
  }

  private handle(socket: Socket, msg: ClientMessage): void {
    switch (msg.type) {
      case 'hello':
        void this.join(socket, msg.version, msg.ticket);
        return;
      case 'ping':
        socket.emit(WIRE_EVENT, encode({ type: 'pong', ts: msg.ts }));
        return;
      case 'input':
        if (!socket.data.joined) { this.kick(socket, 'say hello first'); return; }
        this.players.manager().setInput(socket.data.accountId, msg, this.worlds.world.tick);
        return;
      case 'say':
        if (!socket.data.joined) { this.kick(socket, 'say hello first'); return; }
        void this.say(socket, msg.text);
        return;
      case 'rage': {
        if (!socket.data.joined) { this.kick(socket, 'say hello first'); return; }
        if (this.byAccount.get(socket.data.accountId) !== socket) return;
        const r = this.rage.trigger();
        if (r.ok) { this.broadcast(encode({ type: 'event', kind: 'rage', simTime: sim.t, text: '' })); return; } // everybody, at the same moment
        const notice = r.reason === 'away' ? "Hazel isn't in the office right now." : `Hazel is still calming down. Try again in ${r.secondsLeft} s.`;
        socket.emit(WIRE_EVENT, encode({ type: 'event', kind: 'notice', simTime: sim.t, text: notice }));
        return;
      }
      case 'emote': {
        if (!socket.data.joined) { this.kick(socket, 'say hello first'); return; }
        if (this.byAccount.get(socket.data.accountId) !== socket) return;
        const r = this.emotes.play(socket.data.accountId, msg.kind);
        if (r.ok) this.broadcast(encode({ type: 'emoted', from: r.from, kind: r.kind })); // everybody who is playing sees it
        return;
      }
      case 'act':
        if (!socket.data.joined) { this.kick(socket, 'say hello first'); return; }
        this.players.manager().act(socket.data.accountId, msg.kind, this.worlds.world.tick, this.worlds.world.options.tickRate);
        return;
      default:
        this.kick(socket, 'unexpected message');
    }
  }

  /** Admit a client that has said hello: right version, a valid one-time ticket, a live session, an enabled account. */
  private async join(socket: Socket, version: number, ticket: string): Promise<void> {
    if (socket.data.joined || socket.data.joining) return;
    socket.data.joining = true;
    let attachedId: number | undefined;
    try {
      if (version !== PROTOCOL_VERSION) { this.kick(socket, `protocol version ${version}, the server speaks ${PROTOCOL_VERSION}`); return; }
      if (!this.auth.available) { this.kick(socket, 'accounts are not available on this server'); return; }
      const redeemed = this.tickets.redeem(ticket); // used up now, whatever happens next
      if (!redeemed) { this.kick(socket, 'invalid or expired ticket'); return; }
      // From here on this socket belongs to that account and session, so a logout that lands while we are still checking
      // (the awaits below) can find it and end it.
      socket.data.accountId = redeemed.accountId;
      socket.data.sessionHash = redeemed.sessionHash;
      const auth = this.auth.require();
      if (!(await auth.sessionAlive(redeemed.sessionHash))) { this.kick(socket, 'your session has ended; log in again'); return; }
      const account = await auth.accountById(redeemed.accountId);
      if (!account || account.disabled) { this.kick(socket, 'your session has ended; log in again'); return; }
      if (account.mustChangePassword) { this.kick(socket, 'choose your own password first'); return; } // (a ticket minted before an admin reset the password)
      if (!socket.connected || socket.data.ended) { if (socket.connected) this.kick(socket, 'you have been logged out'); return; } // they left, or were logged out, while we were checking

      // one connection per account: a second login takes over, so nobody drives a character from two tabs
      const old = this.byAccount.get(account.id);
      if (old && old !== socket) { this.byAccount.delete(account.id); this.kick(old, 'you logged in from somewhere else'); }
      socket.data.username = account.username;

      // take over the account's person (or make a guest). A reconnect within the grace period gets the same person back.
      const person = await this.players.manager().attach(account);
      attachedId = account.id;
      if (!socket.connected || socket.data.ended) { this.players.manager().detach(account.id); if (socket.connected) this.kick(socket, 'you have been logged out'); return; }
      // the check above ran before the wait: two connections admitted at the same moment both found nobody here. Whoever finishes
      // last wins; the one that was already in is dropped, so an account never has two live connections.
      const prior = this.byAccount.get(account.id);
      if (prior && prior !== socket) { this.byAccount.delete(account.id); this.kick(prior, 'you logged in from somewhere else'); }
      this.byAccount.set(account.id, socket);
      clearTimeout(socket.data.timer);
      socket.data.joined = true;
      socket.join(PLAYING);
      socket.emit(WIRE_EVENT, this.broadcaster.welcome(this.worlds.world.tick, person.id));
      addLog(`${account.username} joined`); // (everybody sees it in the activity log)
    } catch (err) {
      this.log.error(`joining failed: ${err instanceof Error ? err.message : String(err)}`);
      if (attachedId !== undefined && this.byAccount.get(attachedId) !== socket) this.players.manager().detach(attachedId); // do not leave a session with nobody behind it
      this.kick(socket, 'server error');
    } finally {
      socket.data.joining = false;
    }
  }

  private readonly lastAck = new Map<number, { seq: number; x: number; z: number }>();

  /**
   * Tell each player where their own person is and which of their inputs the server has used (for prediction). Sent when something
   * changed, and once a second otherwise, so a player who stands still still hears from the server.
   */
  private sendAcks(tick: number): void {
    const manager = this.players.manager();
    for (const [accountId, socket] of this.byAccount) {
      if (!socket.data.joined) continue;
      const a = manager.ackFor(accountId);
      if (!a) continue;
      const last = this.lastAck.get(accountId);
      const changed = !last || last.seq !== a.seq || last.x !== a.x || last.z !== a.z;
      if (!changed && tick % this.worlds.world.options.tickRate !== 0) continue;
      this.lastAck.set(accountId, { seq: a.seq, x: a.x, z: a.z });
      socket.emit(WIRE_EVENT, encode({ type: 'ack', tick, ...a })); // (not volatile: right after the snapshot write the transport is busy and a volatile message would be dropped)
    }
    if (this.lastAck.size > this.byAccount.size + 50) for (const id of this.lastAck.keys()) if (!this.byAccount.has(id)) this.lastAck.delete(id);
  }

  /** A chat line: sent to the speaker and whoever is within range; a refusal is explained to the speaker alone. */
  private async say(socket: Socket, text: string): Promise<void> {
    if (this.byAccount.get(socket.data.accountId) !== socket) return; // (a connection that has been taken over or is going away is not heard)
    let result: SayResult;
    try { result = await this.chat.say(socket.data.accountId, text); } catch (err) { this.log.error(`chat failed: ${err instanceof Error ? err.message : String(err)}`); return; }
    if (!result.ok) {
      const notice = result.reason === 'rate' ? 'You are chatting too fast. Wait a few seconds.' : result.reason === 'muted' ? 'An admin has muted you: nobody can see what you type.' : null;
      if (notice && socket.connected) socket.emit(WIRE_EVENT, encode({ type: 'event', kind: 'notice', simTime: sim.t, text: notice }));
      return;
    }
    const bytes = encode({ type: 'chat', from: result.from, name: result.name, text: result.text });
    for (const accountId of result.to) { const s = this.byAccount.get(accountId); if (s && s.data.joined) s.emit(WIRE_EVENT, bytes); }
  }

  /** A logout, a password change or a disabled account ends the connections that session opened. */
  private onSessionEnd(e: SessionEnd): void {
    // every socket of the account, including one that is still being admitted
    for (const socket of this.server.sockets.sockets.values()) {
      if (socket.data.accountId !== e.accountId) continue;
      const mine = socket.data.sessionHash as string | undefined;
      const affected = e.hash !== undefined ? mine === e.hash : e.except !== undefined ? mine !== e.except : true;
      if (!affected) continue;
      socket.data.ended = true;
      if (socket.data.joined) this.kick(socket, 'you have been logged out');
    }
  }

  /**
   * Check every open connection's session again, and drop the ones that have ended (expired, or the account was disabled).
   * Runs every minute; also callable directly.
   */
  async sweep(): Promise<number> {
    if (!this.auth.available) return 0;
    const auth = this.auth.require();
    let dropped = 0;
    for (const socket of [...this.server.sockets.sockets.values()]) {
      const hash = socket.data.sessionHash as string | undefined;
      if (!socket.data.joined || !hash) continue;
      try {
        if (!(await auth.sessionAlive(hash))) { this.kick(socket, 'your session has ended; log in again'); dropped++; }
      } catch { /* a database hiccup must not drop anyone: try again next time */ }
    }
    return dropped;
  }

  /** The address a connection really comes from: with proxies in front (TRUST_PROXY), the one the nearest proxy reports. */
  private addressOf(socket: Socket): string {
    const trust = parseTrustProxy(process.env.TRUST_PROXY);
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (typeof trust === 'number' && trust > 0 && typeof forwarded === 'string') {
      const hops = forwarded.split(',').map(s => s.trim()).filter(Boolean);
      const at = hops[hops.length - trust];
      if (at) return addressKey(at);
    }
    return addressKey(socket.handshake.address);
  }

  private unjoinedFrom(address: string): number {
    let n = 0;
    for (const s of this.server.sockets.sockets.values()) if (!s.data.joined && s.data.address === address) n++;
    return n;
  }

  /** How many accounts are connected (used by tests and the status page). */
  get connectedAccounts(): number { return this.byAccount.size; }

  /** Stop the periodic check (the app is shutting down). */
  onModuleDestroy(): void { if (this.sweepTimer) clearInterval(this.sweepTimer); }

  private broadcast(bytes: Uint8Array): void { this.server.to(PLAYING).emit(WIRE_EVENT, bytes); }

  private kick(socket: Socket, reason: string): void {
    this.log.debug(`kick: ${reason}`);
    socket.emit(WIRE_EVENT, encode({ type: 'kick', reason }));
    socket.disconnect(true);
  }
}
