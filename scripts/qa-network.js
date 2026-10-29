import { io } from 'socket.io-client';
import assert from 'node:assert/strict';

const clients = [];
const connect = () => new Promise((resolve, reject) => {
  const client = io(process.env.QA_BASE_URL || 'http://localhost:4173', { forceNew: true, transports: ['websocket'], timeout: 5000 });
  clients.push(client); client.once('connect', () => resolve(client)); client.once('connect_error', reject);
});
const request = (client, event, data = {}) => new Promise((resolve, reject) => client.timeout(5000).emit(event, data, (error, response) => error ? reject(error) : resolve(response)));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const next = (client, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { client.off('snapshot', listener); reject(new Error('Snapshot timeout')); }, 12000);
  const listener = snapshot => { if (predicate(snapshot)) { clearTimeout(timer); client.off('snapshot', listener); resolve(snapshot); } };
  client.on('snapshot', listener);
});

try {
  const [a,b,c,d,outsider] = await Promise.all(Array.from({ length: 5 }, connect));
  const seenEvents = new Map(clients.map(client => [client.id, new Set()]));
  const eventRooms = new Map(clients.map(client => [client.id, new Set()]));
  const duplicateEvents = new Set();
  const trainingSnapshots = [];
  const snapshotsWithEvents = [];
  for (const client of clients) {
    client.on('events', packet => {
      const seen = seenEvents.get(client.id);
      eventRooms.get(client.id).add(packet.room);
      for (const event of packet.events) {
        if (seen.has(event.id)) duplicateEvents.add(`${client.id}:${event.id}`);
        seen.add(event.id);
      }
    });
    client.on('snapshot', snapshot => {
      if (client === outsider) trainingSnapshots.push(snapshot);
      if (snapshot.events.length) snapshotsWithEvents.push(snapshot);
    });
  }
  const created = await request(a, 'create', { name: '甲' });
  assert.equal(created.ok, true); assert.match(created.room.code, /^\d{4}$/);
  for (const [client,name] of [[b,'乙'],[c,'丙'],[d,'丁']]) assert.equal((await request(client, 'join', { name, code: created.room.code })).ok, true);
  assert.equal((await request(outsider, 'join', { code: created.room.code })).ok, false);
  assert.equal((await request(b, 'start')).ok, false);
  const matchStarted = next(a, s => s.state === 'playing');
  assert.equal((await request(a, 'start')).ok, true);
  const first = await matchStarted;
  assert.deepEqual(first.events, []);
  assert.ok(seenEvents.get(a.id).size > 0, 'match events arrive on their reliable channel');
  assert.equal(first.room, created.room.code);
  assert.ok(eventRooms.get(a.id).has(created.room.code));
  assert.equal(first.players.length, 4); assert.equal(first.players.filter(p => p.team === 'blue').length, 2);
  const initial = first.players.find(p => p.id === a.id);
  a.emit('input', { x: initial.team === 'blue' ? 1 : -1, z: 0, aim: { x: 0, z: initial.z } });
  const moved = await next(a, s => Math.abs(s.players.find(p => p.id === a.id).x - initial.x) > 0.5);
  a.emit('input', { x: 0, z: 0, aim: { x: 0, z: 0 } });
  assert.equal((await request(a, 'skill', { skill: 1, target: { x: 0, z: 0 } })).ok, true);
  await next(a, s => s.players.find(p => p.id === a.id).cd[1] > 4);
  assert.equal((await request(a, 'skill', { skill: 1, target: { x: 0, z: 0 } })).ok, false);
  const isolated = await request(outsider, 'training', { name: '另一个房间' });
  assert.notEqual(isolated.room.code, created.room.code);
  const training = await next(outsider, s => s.state === 'playing');
  assert.equal(training.players.filter(p => p.bot).length, 3);
  assert.equal(training.room, isolated.room.code);
  assert.ok(eventRooms.get(outsider.id).has(isolated.room.code));
  assert.ok(!training.players.some(p => p.id === a.id));
  const pausedSnapshot = next(outsider, snapshot => snapshot.paused);
  assert.equal((await request(outsider, 'pause', { paused: true })).ok, true);
  await pausedSnapshot;
  await sleep(180);
  assert.equal(trainingSnapshots.filter(snapshot => snapshot.paused).length, 1);
  const resumedSnapshot = next(outsider, snapshot => !snapshot.paused);
  assert.equal((await request(outsider, 'pause', { paused: false })).ok, true);
  await resumedSnapshot;
  c.disconnect();
  const replaced = await next(a, s => s.players.some(p => p.bot));
  assert.equal(replaced.players.length, 4);
  const left = next(a, s => s.players.find(p => p.id === b.id)?.bot);
  assert.equal((await request(b, 'leave')).ok, true);
  await left;
  assert.equal((await request(b, 'skill', { skill: 0, target: { x: 0, z: 0 } })).ok, false);
  assert.equal((await request(outsider, 'leave')).ok, true);
  assert.deepEqual([...duplicateEvents], []);
  assert.deepEqual(snapshotsWithEvents, []);
  console.log(JSON.stringify({ ok: true, checks: ['4 digit code','4 player capacity','host start permission','2V2 teams','authoritative movement without snapshot ACKs','cooldown rejection','isolated parallel room','3 training bots','reliable pause transition','reliable room-scoped event channel','disconnect takeover','leave room and revoke skill access'], moved: Math.abs(moved.players.find(p => p.id === a.id).x - initial.x), room: created.room.code }, null, 2));
} finally { clients.forEach(c => c.disconnect()); }
