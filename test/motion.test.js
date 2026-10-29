import test from 'node:test';
import assert from 'node:assert/strict';
import { Motion, advance } from '../shared/motion.js';
import { ARENA, BOUNDS, WALLS } from '../shared/config.js';

const snapshot = (time, x = -14) => ({ round: 1, state: 'playing', paused: false, time, players: [
  { id: 'local', x, z: -9, vx: ARENA.speed, vz: 0, hp: 100, facing: { x: 1, z: 0 } },
  { id: 'remote', x: time * ARENA.speed, z: -9, vx: ARENA.speed, vz: 0, hp: 100, facing: { x: 1, z: 0 } }
], projectiles: [] });

test('local movement responds before the next snapshot and keeps stopped heading', () => {
  const motion = new Motion(); motion.push(snapshot(1), 1000, 'local');
  let result = motion.sample(1016, 1 / 60, 'local', { x: 0, z: 1 });
  assert.ok(result.players[0].z > -9);
  assert.deepEqual(result.players[0].facing, { x: 0, z: 1 });
  result = motion.sample(1032, 1 / 60, 'local', { x: 0, z: 0 });
  assert.deepEqual(result.players[0].facing, { x: 0, z: 1 });
});

test('remote movement is interpolated between authoritative samples', () => {
  const motion = new Motion();
  motion.push(snapshot(1), 1000, 'local'); motion.push(snapshot(1.1), 1100, 'local');
  const result = motion.sample(1150, 1 / 60, 'local', { x: 0, z: 0 });
  assert.ok(Math.abs(result.players[1].x - 1.05 * ARENA.speed) < 0.0001);
});

test('remote movement remains frame-smooth at 90ms snapshot intervals', () => {
  const motion = new Motion();
  let previousX, maxStep = 0;
  const sampleAt = now => {
    const x = motion.sample(now, 1 / 60, 'local', { x: 0, z: 0 }).players[1].x;
    if (previousX !== undefined) maxStep = Math.max(maxStep, Math.abs(x - previousX));
    previousX = x;
  };
  for (let i = 0; i <= 20; i++) {
    const arrival = 1000 + i * 90;
    if (i) for (let now = arrival - 90 + 1000 / 60; now < arrival; now += 1000 / 60) sampleAt(now);
    motion.push(snapshot(i * 0.09), arrival, 'local');
    sampleAt(arrival);
  }
  assert.ok(maxStep <= ARENA.speed / 60 + 0.005, `largest frame step was ${maxStep}`);
});

test('prediction respects walls, players and expanded arena edges', () => {
  const wall = WALLS[0], x = wall.x - wall.w / 2 - ARENA.radius - 0.1;
  assert.ok(advance({ x, z: wall.z }, 20, 0, 0.5).x <= wall.x - wall.w / 2 - ARENA.radius + 0.001);
  assert.ok(advance({ x: -16, z: -9 }, -20, -20, 0.5).x >= -BOUNDS.x + ARENA.radius);
  assert.ok(advance({ x: -16, z: -9 }, 20, 0, 0.5, [{ id: 'other', hp: 100, x: -14, z: -9 }], 'local').x < -14 - ARENA.radius * 2);
});

test('pause, death and stale network snapshots stop prediction', () => {
  for (const mode of ['paused', 'dead', 'stale']) {
    const motion = new Motion(), s = snapshot(1);
    if (mode === 'paused') s.paused = true;
    if (mode === 'dead') s.players[0].hp = 0;
    motion.push(s, 1000, 'local');
    const result = motion.sample(mode === 'stale' ? 1400 : 1016, 1 / 60, 'local', { x: 1, z: 0 });
    assert.equal(result.players[0].x, -14);
    assert.equal(result.players[0].vx, 0);
  }
});

test('dash corrections snap once instead of interpolating through walls', () => {
  const motion = new Motion(); motion.push(snapshot(1), 1000, 'local');
  motion.snapLocal = true; motion.push(snapshot(1.033, -11), 1033, 'local');
  assert.equal(motion.position.x, -11);
  assert.equal(motion.snapLocal, false);
});
