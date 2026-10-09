import { Inject, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { DecodeError, NONE, PROTOCOL_VERSION, decode, encode, simEvents, type Message } from '@office/shared';
import { WorldService } from '../world/world.service';
import { Broadcaster } from './broadcaster';

/** The one Socket.IO event both sides use; its payload is always one binary protocol message. */
export const WIRE_EVENT = 'm';
const PLAYING = 'playing';

export interface GatewayOptions {
  /** A client must say hello within this long or it is dropped. */
  helloTimeoutMs: number;
  maxClients: number;
}
export const gatewayOptions = (env: Record<string, string | undefined>): GatewayOptions => ({
  helloTimeoutMs: Number(env.HELLO_TIMEOUT_MS) || 5000,
  maxClients: Number(env.MAX_CLIENTS) || 200,
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

  constructor(@Inject(WorldService) private readonly worlds: WorldService) {}

  afterInit(): void {
    const world = this.worlds.world;
    this.broadcaster = new Broadcaster({ tickRate: world.options.tickRate });
    simEvents.on('personAdded', p => this.broadcast(this.broadcaster.joined(p)));
    simEvents.on('personRemoved', p => this.broadcast(this.broadcaster.left(p.id)));
    world.onTick(tick => {
      if (this.server.sockets.adapter.rooms.get(PLAYING)?.size) {
        this.server.to(PLAYING).volatile.emit(WIRE_EVENT, this.broadcaster.snapshot(tick)); // a client that is behind skips it
      } else this.broadcaster.snapshot(tick); // keep change tracking moving even with nobody watching
      for (const e of this.broadcaster.events()) this.broadcast(e);
    });
  }

  handleConnection(socket: Socket): void {
    if (this.server.engine.clientsCount > this.options.maxClients) { this.kick(socket, 'the server is full'); return; }
    const timer = setTimeout(() => this.kick(socket, 'no hello'), this.options.helloTimeoutMs);
    socket.once('disconnect', () => clearTimeout(timer));
    socket.data.timer = timer;
    socket.on(WIRE_EVENT, (data: unknown) => this.onMessage(socket, data));
  }

  handleDisconnect(): void { /* nothing to clean up: a viewer has no state on the server */ }

  private onMessage(socket: Socket, data: unknown): void {
    let msg: Message;
    try {
      if (!(data instanceof Uint8Array)) throw new DecodeError('messages are binary');
      msg = decode(data);
    } catch (err) {
      this.kick(socket, err instanceof DecodeError ? `bad message: ${err.message}` : 'bad message');
      return;
    }
    switch (msg.type) {
      case 'hello':
        if (socket.data.joined) return;
        if (msg.version !== PROTOCOL_VERSION) { this.kick(socket, `protocol version ${msg.version}, the server speaks ${PROTOCOL_VERSION}`); return; }
        clearTimeout(socket.data.timer);
        socket.data.joined = true;
        socket.join(PLAYING);
        socket.emit(WIRE_EVENT, this.broadcaster.welcome(this.worlds.world.tick, NONE));
        return;
      case 'ping':
        socket.emit(WIRE_EVENT, encode({ type: 'pong', ts: msg.ts }));
        return;
      default:
        this.kick(socket, 'unexpected message');
    }
  }

  private broadcast(bytes: Uint8Array): void { this.server.to(PLAYING).emit(WIRE_EVENT, bytes); }

  private kick(socket: Socket, reason: string): void {
    this.log.debug(`kick: ${reason}`);
    socket.emit(WIRE_EVENT, encode({ type: 'kick', reason }));
    socket.disconnect(true);
  }
}
