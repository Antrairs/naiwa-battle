import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { Match } from './shared/simulation.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 20000 });
const rooms = new Map();
const port = Number(process.env.PORT || 4173);
const cleanName = value => String(value || '').replace(/[^\p{L}\p{N}_· -]/gu, '').trim().slice(0, 12) || '球球';

app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
app.use('/vendor/lucide', express.static(path.join(root, 'node_modules/lucide')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/assets', express.static(path.join(root, 'assets')));
for (const name of ['index.html', 'styles.css', 'main.js', 'view.js', 'environment.js', 'audio.js', 'fullscreen.js', 'manifest.webmanifest']) app.get('/' + name, (_req, res) => res.sendFile(path.join(root, name)));
app.get('/', (_req, res) => res.sendFile(path.join(root, 'index.html')));
app.get('/health', (_req, res) => res.json({ ok: true, app: 'bombo-arena', rooms: rooms.size }));
app.get('/api/info', async (_req, res) => {
  const addresses = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => 'http://' + n.address + ':' + port);
  const url = addresses[0] || 'http://localhost:' + port;
  res.json({ addresses, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 256, color: { dark: '#285645', light: '#fafbf3' } }) });
});

function code() {
  let value;
  do { value = String(randomInt(1000, 10000)); } while (rooms.has(value));
  return value;
}
function summary(room) {
  return { code: room.code, host: room.host, training: room.training, state: room.match?.state || 'lobby',
    members: [...room.members.values()].map(p => ({ ...p })), max: 4 };
}
function lobby(room) { io.to(room.code).emit('room', summary(room)); }
function broadcastSnapshot(room) {
  const snapshot = room.match.snapshot(room.lastEventSent);
  room.lastEventSent = room.match.seq;
  if (snapshot.state === 'result') room.resultSent = true;
  io.to(room.code).emit('snapshot', snapshot);
}
function leave(socket) {
  const room = rooms.get(socket.data.room);
  if (!room) return;
  room.members.delete(socket.id);
  socket.leave(room.code); socket.data.room = null;
  if (room.training || ![...room.members.values()].some(p => !p.bot)) { rooms.delete(room.code); return; }
  if (room.match) {
    const player = room.match.players.find(p => p.id === socket.id);
    if (player) {
      player.bot = true; player.ready = true; player.name = player.name.slice(0, 9) + '·AI';
      room.members.set(player.id, { id: player.id, name: player.name, bot: true });
      room.match.event('disconnect', { player: player.id });
    }
  }
  if (room.host === socket.id) room.host = [...room.members.values()].find(p => !p.bot)?.id;
  lobby(room);
  if (room.match?.state === 'result') broadcastSnapshot(room);
}
function start(room) {
  if (room.members.size !== 4 || (room.match && room.match.state !== 'result')) return;
  const members = [...room.members.values()];
  if (!room.training) for (let i = members.length - 1; i > 0; i--) { const j = randomInt(i + 1); [members[i], members[j]] = [members[j], members[i]]; }
  room.match = new Match(members, { training: room.training });
  room.lastEventSent = 0;
  room.resultSent = false;
  lobby(room);
  broadcastSnapshot(room);
}
function enter(socket, room) { socket.data.room = room.code; socket.join(room.code); }
function create(socket, name, training) {
  leave(socket);
  const room = { code: code(), host: socket.id, training, members: new Map(), match: null, lastEventSent: 0, resultSent: false };
  room.members.set(socket.id, { id: socket.id, name: cleanName(name), bot: false });
  rooms.set(room.code, room); enter(socket, room);
  if (training) {
    ['布丁', '柚子', '小满'].forEach((name, i) => room.members.set('bot-' + i, { id: 'bot-' + i, name, bot: true }));
    start(room);
  }
  lobby(room); return room;
}
function current(socket) { return rooms.get(socket.data.room); }

io.on('connection', socket => {
  socket.on('latency', (_data, ack = () => {}) => ack({ ok: true }));
  socket.on('leave', (_data, ack = () => {}) => { leave(socket); ack({ ok: true }); });
  socket.on('training', (data = {}, ack = () => {}) => { const room = create(socket, data.name, true); ack({ ok: true, room: summary(room), playerId: socket.id }); });
  socket.on('create', (data = {}, ack = () => {}) => { const room = create(socket, data.name, false); ack({ ok: true, room: summary(room), playerId: socket.id }); });
  socket.on('join', (data = {}, ack = () => {}) => {
    const room = rooms.get(String(data.code || '').trim());
    if (!room || room.training) return ack({ ok: false, error: '找不到这个房间，请检查房间码' });
    if (room === current(socket)) return ack({ ok: true, room: summary(room), playerId: socket.id });
    if (room.match && room.match.state !== 'result') return ack({ ok: false, error: '该房间已经开赛' });
    if (room.members.size >= 4) return ack({ ok: false, error: '房间已满，最多 4 人' });
    leave(socket);
    room.members.set(socket.id, { id: socket.id, name: cleanName(data.name), bot: false });
    enter(socket, room); lobby(room);
    ack({ ok: true, room: summary(room), playerId: socket.id });
  });
  socket.on('fill', (_data, ack = () => {}) => {
    const room = current(socket);
    if (!room || room.host !== socket.id || room.match) return ack({ ok: false, error: '只有房主可在开赛前添加训练伙伴' });
    const names = ['布丁', '柚子', '小满'];
    let i = 0;
    while (room.members.size < 4) {
      const id = 'bot-' + Date.now() + '-' + i;
      room.members.set(id, { id, name: names[i++ % names.length], bot: true });
    }
    lobby(room); ack({ ok: true });
  });
  socket.on('start', (_data, ack = () => {}) => {
    const room = current(socket);
    if (!room || room.host !== socket.id) return ack({ ok: false, error: '等待房主开始对战' });
    if (room.members.size !== 4) return ack({ ok: false, error: '需要 4 位队员，可补齐训练伙伴' });
    start(room); ack({ ok: true });
  });
  socket.on('input', data => current(socket)?.match?.input(socket.id, data));
  socket.on('skill', (data = {}, ack = () => {}) => {
    const match = current(socket)?.match;
    const error = match ? match.command(socket.id, Number(data.skill), data.target) : '对局尚未开始';
    ack({ ok: !error, error });
  });
  socket.on('rematch', (_data, ack = () => {}) => {
    const room = current(socket), match = room?.match;
    if (!match || match.state !== 'result') return ack({ ok: false, error: '对局还没有结束' });
    const p = match.players.find(p => p.id === socket.id);
    if (p) p.ready = true;
    if (match.players.every(p => p.bot || p.ready)) {
      match.reset(true); room.resultSent = false; lobby(room);
    }
    ack({ ok: true });
    broadcastSnapshot(room);
  });
  socket.on('pause', (data = {}, ack = () => {}) => {
    const room = current(socket);
    if (!room?.training || !room.match) return ack({ ok: false, error: '联机对局会继续进行' });
    const paused = !!data.paused;
    if (room.match.paused !== paused) {
      room.match.paused = paused;
      broadcastSnapshot(room);
    }
    ack({ ok: true });
  });
  socket.on('disconnect', () => leave(socket));
});

const STEP = 1 / 60;
let previousTick = performance.now(), accumulator = 0, tick = 0;
setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(0.1, (now - previousTick) / 1000);
  previousTick = now;
  let updated = false;
  while (accumulator >= STEP) {
    for (const room of rooms.values()) {
      const match = room.match;
      if (!match || match.paused || match.state === 'result') continue;
      match.step(STEP);
    }
    accumulator -= STEP;
    tick++;
    if (tick % 2 === 0) updated = true;
  }
  if (!updated) return;
  for (const room of rooms.values()) {
    const match = room.match;
    if (!match || match.paused) continue;
    if (match.state === 'result') {
      if (!room.resultSent) broadcastSnapshot(room);
      continue;
    }
    broadcastSnapshot(room);
  }
}, 1000 / 60);
server.listen(port, '0.0.0.0', () => {
  console.log('BOMBO Carnival Arena: http://localhost:' + port);
  for (const n of Object.values(os.networkInterfaces()).flat()) if (n?.family === 'IPv4' && !n.internal) console.log('LAN: http://' + n.address + ':' + port);
});
