import { Server } from 'socket.io';

// A simple office chat over Socket.IO, attached to the same HTTP server as the app (production: server/index.js;
// development: the Vite dev server, vite.config.js). Everyone in the room sees every message.
// The last messages are kept in memory for people who join later; they are gone when the server restarts.
const HISTORY = 50;          // messages a newcomer receives
const MAX_TEXT = 500;        // characters per message
const MAX_NAME = 40;         // characters per display name
const RATE = { count: 5, perMs: 10000 }; // at most 5 messages per 10 seconds per connection

// Trim, drop control characters, collapse whitespace runs; empty when nothing is left.
const clean = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

function attachChat(httpServer) {
  const io = new Server(httpServer, { path: '/socket.io', maxHttpBufferSize: 4096, serveClient: false });
  const history = [];
  let nextId = 1;
  const presence = () => io.emit('chat:presence', { online: io.of('/').sockets.size });

  io.on('connection', socket => {
    socket.emit('chat:history', history);
    presence();
    const sent = [];
    socket.on('chat:send', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const name = clean(msg?.name, MAX_NAME), text = clean(msg?.text, MAX_TEXT);
      if (!name || !text) return reply({ ok: false, error: 'Enter a name and a message' });
      const now = Date.now();
      while (sent.length && now - sent[0] > RATE.perMs) sent.shift();
      if (sent.length >= RATE.count) return reply({ ok: false, error: 'Slow down a little' });
      sent.push(now);
      const message = { id: nextId++, name, text, at: new Date(now).toISOString() };
      history.push(message); if (history.length > HISTORY) history.shift();
      io.emit('chat:message', message);
      reply({ ok: true });
    });
    socket.on('disconnect', presence);
  });
  return io;
}

export { attachChat, clean };
