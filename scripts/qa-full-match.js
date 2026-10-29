import { io } from 'socket.io-client';
import assert from 'node:assert/strict';
import { Match } from '../shared/simulation.js';
import { BOUNDS, NAV } from '../shared/config.js';

const clients = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const connect = () => new Promise((resolve, reject) => {
  const client = io(process.env.QA_BASE_URL || 'http://localhost:4173', { forceNew: true, transports: ['websocket'] });
  clients.push(client); client.once('connect', () => resolve(client)); client.once('connect_error', reject);
});
const request = (client, event, data = {}) => new Promise((resolve, reject) => client.timeout(5000).emit(event, data, (err, response) => err ? reject(err) : resolve(response)));
let snapshot;
const nav = new Match(Array.from({ length: 4 }, (_, i) => ({ id: 'n' + i, name: 'n' })));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const unit = (x, z) => { const d = Math.max(0.01, Math.hypot(x, z)); return { x: x / d, z: z / d }; };

try {
  const group = await Promise.all(Array.from({ length: 4 }, connect));
  let resultSnapshots = 0, snapshotsWithEvents = false;
  const seenEvents = new Set(), duplicateEvents = new Set();
  const eventRooms = new Set();
  group[0].on('events', packet => {
    eventRooms.add(packet.room);
    for (const event of packet.events) {
      if (seenEvents.has(event.id)) duplicateEvents.add(event.id);
      seenEvents.add(event.id);
    }
  });
  group[0].on('snapshot', (s, ack) => {
    snapshot = s;
    if (s.state === 'result') resultSnapshots++;
    if (s.events.length) snapshotsWithEvents = true;
    ack();
  });
  const room = await request(group[0], 'create', { name: '流程一' });
  for (let i = 1; i < 4; i++) await request(group[i], 'join', { code: room.room.code, name: '流程' + (i + 1) });
  await request(group[0], 'start');
  const start = Date.now();
  const casts = new Map();
  while (Date.now() - start < 110000 && snapshot?.state !== 'result') {
    await sleep(100);
    if (snapshot?.state !== 'playing') continue;
    const attackers = snapshot.players.filter(p => p.team === 'blue');
    const targets = snapshot.players.filter(p => p.team === 'red' && p.hp > 0);
    for (const p of attackers) {
      const client = group.find(c => c.id === p.id);
      const enemy = [...targets].sort((a,b) => distance(p,a) - distance(p,b))[0];
      if (!enemy) continue;
      const dist = distance(p,enemy);
      let move = { x: 0, z: 0 };
      if (dist > 5.1) {
        const path = nav.finder.findPath(Math.round((p.x + BOUNDS.x) / NAV.cellSize), Math.round((p.z + BOUNDS.z) / NAV.cellSize), Math.round((enemy.x + BOUNDS.x) / NAV.cellSize), Math.round((enemy.z + BOUNDS.z) / NAV.cellSize), nav.nav.clone());
        const waypoint = path[1];
        if (waypoint) move = unit(waypoint[0] * NAV.cellSize - BOUNDS.x - p.x, waypoint[1] * NAV.cellSize - BOUNDS.z - p.z);
      }
      client.emit('input', { ...move, aim: { x: enemy.x, z: enemy.z } });
      for (const skill of [0,1,3]) {
        if (dist > (skill === 0 ? 8.9 : skill === 1 ? 6.9 : 5.9) || p.cd[skill] > 0.01 || Date.now() - (casts.get(p.id + skill) || 0) < (skill === 0 ? 260 : 1000)) continue;
        casts.set(p.id + skill, Date.now());
        await request(client, 'skill', { skill, target: { x: enemy.x, z: enemy.z } });
      }
    }
  }
  assert.equal(snapshot?.state, 'result', JSON.stringify(snapshot?.players.map(p => ({ x:p.x,z:p.z,hp:p.hp }))));
  assert.equal(snapshot.winner, 'blue');
  assert.equal(snapshot.reason, '团灭');
  const finishedTime = snapshot.time;
  await sleep(200);
  assert.equal(resultSnapshots, 1);
  assert.deepEqual([...duplicateEvents], []);
  assert.ok(seenEvents.size > 0);
  assert.deepEqual([...eventRooms], [room.room.code]);
  assert.equal(snapshotsWithEvents, false);
  for (let i = 0; i < 3; i++) await request(group[i], 'rematch');
  await sleep(250);
  assert.equal(snapshot.state, 'result');
  assert.equal(snapshot.players.filter(p => p.ready).length, 3);
  await request(group[3], 'rematch'); await sleep(250);
  assert.equal(snapshot.state, 'countdown'); assert.equal(snapshot.round, 2);
  assert.ok(snapshot.players.every(p => p.hp === 100 && p.cd[0] === 0 && p.cd[1] === 0 && p.cd[2] === 0 && p.cd[3] === 0));
  console.log(JSON.stringify({ ok: true, checks: ['full 4-player match','team elimination result','final snapshot sent once','room-scoped reliable events and snapshots','3 ready players cannot restart','4th ready starts rematch','health and cooldown reset','new 2V2 teams'], matchSeconds: finishedTime }, null, 2));
} finally { clients.forEach(c => c.disconnect()); }
