import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../shared/simulation.js';
import { ARENA, BOUNDS, NAV, WALLS, SKILLS } from '../shared/config.js';

const members = [
  { id: 'p1', name: '蓝一', bot: false }, { id: 'p2', name: '蓝二', bot: false },
  { id: 'p3', name: '红一', bot: false }, { id: 'p4', name: '红二', bot: false }
];

test('match starts after the three second countdown', () => {
  const match = new Match(members, { random: () => 0.5 });
  match.step(2.9);
  assert.equal(match.state, 'countdown');
  match.step(0.2);
  assert.equal(match.state, 'playing');
});

test('skill cooldown rejects a second cast until it expires', () => {
  const match = new Match(members, { random: () => 0.5 });
  match.step(3.1);
  assert.equal(match.command('p1', 1, { x: -5, z: -5 }), null);
  match.step(0.05);
  assert.equal(match.command('p1', 1, { x: -5, z: -5 }), '技能正在冷却');
});

test('dash stops at the first high wall', () => {
  const match = new Match(members, { random: () => 0.5 });
  match.step(3.1);
  const p = match.players.find(item => item.id === 'p1');
  const wall = WALLS[0];
  p.body.position.set(wall.x - wall.w / 2 - ARENA.radius - 0.5, 0.45, wall.z);
  p.move = { x: 1, z: 0 };
  assert.equal(match.command('p1', 2, { x: 0, z: -2.2 }), null);
  match.step(1 / 60);
  assert.ok(p.body.position.x < wall.x - wall.w / 2, `dash crossed wall at ${p.body.position.x}`);
});

test('basic bullet deals 8 damage without splash', () => {
  const match = new Match(members, { random: () => 0.5 });
  match.step(3.1);
  const target = match.players.find(item => item.id === 'p3');
  target.body.position.set(-8, 0.45, -9);
  const shooter = match.players.find(item => item.id === 'p1');
  shooter.body.position.set(-14, 0.45, -9);
  const nearby = match.players[3]; nearby.body.position.set(-8, 0.45, -7.9);
  assert.equal(match.command('p1', 0, { x: -8, z: -9 }), null);
  for (let i = 0; i < 42; i++) match.step(1 / 60);
  assert.equal(target.hp, 92); assert.equal(nearby.hp, 100);
});

test('shotgun launches five equally spaced pellets with basic attack damage', () => {
  const match = new Match(members); match.step(3.1);
  const shooter = match.players[0], target = match.players[2];
  shooter.body.position.set(-14, 0.45, -9); target.body.position.set(-8, 0.45, -9);
  match.command(shooter.id, 1, { x: -8, z: -9 }); match.step(1 / 60);
  assert.equal(match.projectiles.length, 5);
  const angles = match.projectiles.map(q => Math.atan2(q.dir.z, q.dir.x));
  assert.ok(Math.abs(angles[4] - angles[0] - SKILLS[1].spread) < 1e-9);
  assert.ok(angles.every((a, i) => !i || Math.abs(a - angles[i - 1] - SKILLS[1].spread / 4) < 1e-9));
  for (let i = 0; i < 35; i++) match.step(1 / 60);
  assert.equal(target.hp, 100 - SKILLS[0].damage);
  assert.equal(match.events.find(e => e.type === 'shot').projectiles.length, 5);
});

test('close shotgun pellets hit independently, with no friendly fire', () => {
  const match = new Match(members); match.step(3.1);
  const shooter = match.players[0], target = match.players[2], ally = match.players[1];
  shooter.body.position.set(-14, 0.45, -9); target.body.position.set(-13, 0.45, -9); ally.body.position.set(-11, 0.45, -9);
  match.command(shooter.id, 1, { x: -8, z: -9 });
  for (let i = 0; i < 40; i++) match.step(1 / 60);
  assert.equal(target.hp, 60); assert.equal(ally.hp, 100); assert.equal(shooter.hp, 100);
});

test('basic cadence is server enforced and reset clears its cooldown', () => {
  const match = new Match(members); match.step(3.1);
  match.players[0].body.position.set(-14, 0.45, -9);
  assert.equal(match.command('p1', 0, { x: -8, z: -9 }), null);
  assert.equal(match.command('p1', 0, { x: -8, z: -9 }), '技能正在冷却');
  match.step(1 / 60);
  for (let i = 0; i < 13; i++) match.step(1 / 60);
  assert.equal(match.command('p1', 0, { x: -8, z: -9 }), '技能正在冷却');
  for (let i = 0; i < 2; i++) match.step(1 / 60);
  assert.equal(match.command('p1', 0, { x: -8, z: -9 }), null);
  match.reset(); assert.equal(match.players[0].cd[0], 0);
});

test('basic bullet uses full range and passes through allies', () => {
  const match = new Match(members); match.step(3.1);
  match.players[0].body.position.set(-14, 0.45, -9);
  match.players[1].body.position.set(-11, 0.45, -9);
  match.players[2].body.position.set(-6, 0.45, -9);
  match.command('p1', 0, { x: -13.5, z: -9 });
  for (let i = 0; i < 35; i++) match.step(1 / 60);
  assert.equal(match.players[1].hp, 100); assert.equal(match.players[2].hp, 92);
});

test('basic and shotgun hits apply freeze and consume the core', () => {
  for (const skill of [0, 1]) {
    const match = new Match(members); match.step(3.1);
    const p = match.players[0], target = match.players[2];
    p.body.position.set(-14, 0.45, -9); target.body.position.set(-8, 0.45, -9);
    p.buff = 'freeze'; p.buffUntil = 30; match.command(p.id, skill, { x: -8, z: -9 });
    for (let i = 0; i < 35; i++) match.step(1 / 60);
    assert.equal(p.buff, null); assert.ok(target.slowUntil > match.time);
  }
});

test('aim near arena edges preserves bullet direction and zero aim uses facing', () => {
  const match = new Match(members); match.step(3.1);
  const p = match.players[0]; p.body.position.set(16, 0.45, 9);
  match.command(p.id, 0, { x: 22, z: 15 }); match.step(1 / 60);
  const q = match.projectiles[0];
  assert.ok(Math.abs(q.dir.x - q.dir.z) < 1e-9);
  p.cd[0] = 0; p.lastMove = { x: -1, z: 0 };
  match.command(p.id, 0, { x: 16, z: 9 }); match.step(1 / 60);
  assert.deepEqual(match.projectiles.at(-1).dir, { x: -1, z: 0 });
});

test('grenade crosses low cover and applies center damage and a slow', () => {
  const match = new Match(members, { random: () => 0.5 }); match.step(3.1);
  const shooter = match.players[0], target = match.players[2];
  const wall = WALLS[13];
  shooter.body.position.set(wall.x, 0.45, wall.z - 2);
  target.body.position.set(wall.x, 0.45, wall.z + 2);
  match.command(shooter.id, 3, { x: wall.x, z: wall.z + 2 });
  for (let i = 0; i < 40; i++) match.step(1 / 30);
  assert.equal(target.hp, 65); assert.ok(target.slowUntil > 0);
});

test('basic and shotgun shots are intercepted by low cover', () => {
  for (const skill of [0, 1]) {
  const match = new Match(members, { random: () => 0.5 }); match.step(3.1);
  const shooter = match.players[0], target = match.players[2];
  const wall = WALLS[13];
  shooter.body.position.set(wall.x, 0.45, wall.z - 2);
  target.body.position.set(wall.x, 0.45, wall.z + 2);
  match.command(shooter.id, skill, { x: wall.x, z: wall.z + 2 });
  for (let i = 0; i < 30; i++) match.step(1 / 30);
  assert.equal(target.hp, 100);
  }
});

test('a launched grenade uses its fixed launch position when the shooter moves', () => {
  const match = new Match(members, { random: () => 0.5 }); match.step(3.1);
  const shooter = match.players[0]; shooter.body.position.set(0, 0.45, 0);
  match.command(shooter.id, 3, { x: 0, z: -2 }); match.step(1 / 30);
  shooter.body.position.set(12, 0.45, -5);
  for (let i = 0; i < 5; i++) match.step(1 / 30);
  assert.equal(match.projectiles[0].x, 0);
});

test('shield absorbs damage before health and expires', () => {
  const match = new Match(members, { random: () => 0.5 }); match.step(3.1);
  const target = match.players[2]; target.shield = 40; target.buff = 'shield'; target.buffUntil = 1;
  match.damage([{ target, amount: 22, owner: match.players[0], slow: 0 }]);
  assert.equal(target.shield, 18); assert.equal(target.hp, 100);
  match.time = 1; match.step(1 / 30);
  assert.equal(target.shield, 0); assert.equal(target.buff, null);
});

test('center pickup appears after 45 seconds and the timer restarts on pickup', () => {
  const match = new Match(members, { random: () => 0.5 }); match.step(3.1);
  match.lootTimer = 1 / 60; match.step(1 / 30);
  assert.ok(match.loot);
  match.players[0].body.position.set(0, 0.45, 0); match.step(1 / 30);
  assert.equal(match.loot, null); assert.equal(match.lootTimer, 45); assert.equal(match.players[0].buff, 'freeze');
});

test('timeout uses remaining health, then kills, then a draw', () => {
  for (const scenario of [{ health: 77, kills: 0, winner: 'red' }, { health: 100, kills: 1, winner: 'blue' }, { health: 100, kills: 0, winner: 'draw' }]) {
    const match = new Match(members, { random: () => 0.5 }); match.step(3.1);
    match.players[0].hp = scenario.health; match.players[0].kills = scenario.kills;
    match.time = 600; match.step(1 / 30); assert.equal(match.winner, scenario.winner);
  }
});

test('team elimination ends the match and dead players cannot cast', () => {
  const match = new Match(members, { random: () => 0.5 }); match.step(3.1);
  match.damage([{ target: match.players[2], amount: 100, owner: match.players[0], slow: 0 }]);
  assert.equal(match.command('p3', 1, { x: 0, z: 0 }), '你已出局，正在观战');
  match.damage([{ target: match.players[3], amount: 100, owner: match.players[1], slow: 0 }]);
  match.step(1 / 30); assert.equal(match.state, 'result'); assert.equal(match.winner, 'blue');
});

test('rematch restores health, shields, cooldowns, and a legal spawn', () => {
  const match = new Match(members, { random: () => 0.5 }); match.step(3.1);
  const p = match.players[0]; p.hp = 0; p.shield = 12; p.cd[3] = 8;
  match.reset();
  assert.equal(p.hp, 100); assert.equal(p.shield, 0); assert.equal(p.cd[3], 0);
  assert.equal(match.blocked(p.body.position.x, p.body.position.z), false);
  assert.equal(match.state, 'countdown');
});

test('the maze navigation grid connects every spawn to the center', () => {
  const match = new Match(members);
  for (const p of match.players) {
    const path = match.finder.findPath(Math.round((p.body.position.x + BOUNDS.x) / NAV.cellSize), Math.round((p.body.position.z + BOUNDS.z) / NAV.cellSize), BOUNDS.x / NAV.cellSize, BOUNDS.z / NAV.cellSize, match.nav.clone());
    assert.ok(path.length > 0);
  }
});

test('60 Hz movement uses the faster speed and preserves last movement facing', () => {
  const match = new Match(members); match.step(3.1);
  const p = match.players[0]; p.body.position.set(-14, 0.45, -9);
  match.input(p.id, { x: 1, z: 0, aim: { x: -18, z: 10 } });
  for (let i = 0; i < 30; i++) match.step(1 / 60);
  assert.ok(Math.abs(p.body.position.x - (-14 + ARENA.speed * 0.5)) < 0.01);
  assert.deepEqual(match.snapshot().players[0].facing, { x: 1, z: 0 });
  match.input(p.id, { x: 0, z: 0 }); match.step(1 / 60);
  assert.deepEqual(match.snapshot().players[0].facing, { x: 1, z: 0 });
});

test('new outer lanes are playable and arena edges remain solid', () => {
  const match = new Match(members); match.step(3.1);
  const p = match.players[0]; p.body.position.set(-17, 0.45, -9);
  assert.equal(match.blocked(-17, -9), false);
  match.input(p.id, { x: -1, z: -1 });
  for (let i = 0; i < 120; i++) match.step(1 / 60);
  assert.ok(p.body.position.x >= -BOUNDS.x + ARENA.radius - 0.001);
  assert.ok(p.body.position.z >= -BOUNDS.z + ARENA.radius - 0.001);
  assert.equal(match.blocked(BOUNDS.x, 0), true);
});

