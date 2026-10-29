import * as CANNON from 'cannon-es';
import PF from 'pathfinding';
import { ARENA, BOUNDS, NAV, SKILLS, WALLS, SPAWNS, BUFFS } from './config.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const unit = (x, z) => { const len = Math.hypot(x, z); return len > 0.0001 ? { x: x / len, z: z / len } : { x: 0, z: -1 }; };
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const { cellSize } = NAV;
const blockedAt = (x, z, radius = ARENA.radius) => {
  if (Math.abs(x) > BOUNDS.x - radius || Math.abs(z) > BOUNDS.z - radius) return true;
  return WALLS.some(w => Math.abs(x - w.x) < w.w / 2 + radius && Math.abs(z - w.z) < w.d / 2 + radius);
};
// Pathfinding mutates grids, so callers must search on clones of this shared base.
const NAV_GRID = new PF.Grid(NAV.cols, NAV.rows);
for (let z = 0; z < NAV.rows; z++) for (let x = 0; x < NAV.cols; x++) {
  NAV_GRID.setWalkableAt(x, z, !blockedAt(x * cellSize - BOUNDS.x, z * cellSize - BOUNDS.z, ARENA.radius + 0.07));
}


export class Match {
  constructor(members, { training = false, random = Math.random } = {}) {
    this.training = training;
    this.random = random;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
    this.rayFrom = new CANNON.Vec3();
    this.rayTo = new CANNON.Vec3();
    this.rayResult = new CANNON.RaycastResult();
    this.rayOptions = { collisionFilterMask: 3, skipBackfaces: true, checkCollisionResponse: false };
    this.sightRayOptions = { collisionFilterGroup: -1, collisionFilterMask: 1, skipBackfaces: true, checkCollisionResponse: false };
    this.world.defaultContactMaterial.friction = 0;
    this.world.defaultContactMaterial.restitution = 0;
    this.world.solver.iterations = 12;
    this.events = [];
    this.seq = 0;
    this.projectileSeq = 0;
    this.round = 0;
    this.paused = false;
    this.players = [];
    this.walls = [...WALLS,
      { x: -BOUNDS.x - 0.3, z: 0, w: 0.6, d: ARENA.depth + 1, h: 2 },
      { x: BOUNDS.x + 0.3, z: 0, w: 0.6, d: ARENA.depth + 1, h: 2 },
      { x: 0, z: -BOUNDS.z - 0.3, w: ARENA.width + 1, d: 0.6, h: 2 },
      { x: 0, z: BOUNDS.z + 0.3, w: ARENA.width + 1, d: 0.6, h: 2 }
    ];
    for (const w of this.walls) {
      const body = new CANNON.Body({ mass: 0, collisionFilterGroup: 1, collisionFilterMask: -1 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(w.w / 2, w.h / 2, w.d / 2)));
      body.position.set(w.x, w.h / 2, w.z);
      this.world.addBody(body);
    }
    this.nav = NAV_GRID;
    this.finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
    members.forEach((m, i) => {
      const body = new CANNON.Body({ mass: 1, fixedRotation: true, linearDamping: 0, collisionFilterGroup: 2, collisionFilterMask: 3 });
      body.addShape(new CANNON.Sphere(ARENA.radius));
      body.linearFactor.set(1, 0, 1);
      this.world.addBody(body);
      this.players.push({ id: m.id, name: m.name, bot: !!m.bot, team: i < 2 ? 'blue' : 'red', body });
    });
    this.reset(false);
  }

  event(type, data = {}) {
    this.events.push({ id: ++this.seq, type, ...data });
    if (this.events.length > 100) this.events.shift();
  }

  reset(shuffle = true) {
    this.round++;
    this.state = 'countdown';
    this.countdown = 3;
    this.time = 0;
    this.projectiles = [];
    this.loot = null;
    this.lootTimer = 45;
    this.winner = null;
    this.reason = '';
    this.paused = false;
    const order = [...this.players];
    if (shuffle) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    order.forEach((p, i) => {
      p.team = i < 2 ? 'blue' : 'red';
      const spawn = SPAWNS[p.team][i % 2];
      p.body.position.set(spawn.x, 0.45, spawn.z);
      p.body.velocity.setZero();
      p.body.collisionResponse = true;
      p.hp = 100;
      p.shield = 0;
      p.buff = null;
      p.buffUntil = 0;
      p.slowUntil = 0;
      p.kills = 0;
      p.damage = 0;
      p.cd = { 0: 0, 1: 0, 2: 0, 3: 0 };
      p.move = { x: 0, z: 0 };
      p.lastMove = { x: p.team === 'blue' ? 1 : -1, z: 0 };
      p.aim = { x: 0, z: 0 };
      p.queue = [];
      p.path = [];
      p.nextThink = 0;
      p.nextShot = 0.4 + this.random();
      p.ready = p.bot;
    });
    this.event('round', { round: this.round });
  }

  input(id, data = {}) {
    const p = this.players.find(x => x.id === id);
    if (!p || p.bot || this.state !== 'playing' || this.paused || p.hp <= 0) return;
    const x = clamp(finite(data.x), -1, 1), z = clamp(finite(data.z), -1, 1);
    const length = Math.max(1, Math.hypot(x, z));
    p.move = { x: x / length, z: z / length };
    if (data.aim && Number.isFinite(data.aim.x) && Number.isFinite(data.aim.z)) {
      p.aim = { x: clamp(data.aim.x, -BOUNDS.x, BOUNDS.x), z: clamp(data.aim.z, -BOUNDS.z, BOUNDS.z) };
    }
  }

  command(id, skill, target) {
    const p = this.players.find(x => x.id === id);
    if (!p) return '玩家不在本场对局';
    if (!SKILLS[skill]) return '技能不存在';
    if (this.state !== 'playing' || this.paused) return '对局尚未开始或已暂停';
    if (p.hp <= 0) return '你已出局，正在观战';
    if (p.cd[skill] > 0 || p.queue.some(q => q.skill === skill)) return '技能正在冷却';
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return '瞄准点无效';
    const margin = Number(skill) === 3 ? 0 : SKILLS[skill].range;
    p.queue.push({ skill: Number(skill), target: { x: clamp(target.x, -BOUNDS.x - margin, BOUNDS.x + margin), z: clamp(target.z, -BOUNDS.z - margin, BOUNDS.z + margin) } });
    return null;
  }

  blocked(x, z, radius = ARENA.radius) {
    return blockedAt(x, z, radius);
  }

  ray(from, to, filter) {
    let closest = null;
    this.rayFrom.set(from.x, from.y, from.z);
    this.rayTo.set(to.x, to.y, to.z);
    this.world.raycastAll(this.rayFrom, this.rayTo, this.rayOptions, result => {
      if (filter && !filter(result.body)) return;
      if (!closest || result.distance < closest.distance) closest = { distance: result.distance, point: { ...result.hitPointWorld }, body: result.body };
    });
    return closest;
  }

  sight(a, b) {
    this.rayFrom.set(a.x, 0.65, a.z);
    this.rayTo.set(b.x, 0.65, b.z);
    return !this.world.raycastAny(this.rayFrom, this.rayTo, this.sightRayOptions, this.rayResult);
  }

  dash(p, target) {
    const from = { x: p.body.position.x, z: p.body.position.z };
    const dir = Math.hypot(p.move.x, p.move.z) > 0.1 ? unit(p.move.x, p.move.z) : p.lastMove;
    for (let i = 1; i <= 60; i++) {
      const x = from.x + dir.x * i * 0.05, z = from.z + dir.z * i * 0.05;
      const occupied = this.players.some(other => other !== p && other.hp > 0 && Math.hypot(other.body.position.x - x, other.body.position.z - z) < ARENA.radius * 2);
      if (this.blocked(x, z) || occupied) break;
      p.body.position.x = x; p.body.position.z = z;
    }
    p.cd[2] = 6;
    this.event('dash', { player: p.id, from, to: { x: p.body.position.x, z: p.body.position.z } });
  }

  shoot(p, skill, target) {
    const pos = p.body.position;
    const dir = distance(pos, target) < 0.001 ? p.lastMove : unit(target.x - pos.x, target.z - pos.z);
    const spec = SKILLS[skill], range = skill === 3 ? Math.min(spec.range, distance(pos, target)) : spec.range;
    const projectiles = [];
    for (let i = 0; i < (spec.pellets || 1); i++) {
      const angle = spec.pellets ? (i / (spec.pellets - 1) - 0.5) * spec.spread : 0;
      const direction = { x: dir.x * Math.cos(angle) - dir.z * Math.sin(angle), z: dir.x * Math.sin(angle) + dir.z * Math.cos(angle) };
      const projectile = {
        id: ++this.projectileSeq, skill, owner: p.id, team: p.team, age: 0,
        start: { x: pos.x, z: pos.z }, dir: direction, range, speed: spec.speed,
        target: { x: clamp(pos.x + dir.x * range, -BOUNDS.x + 0.2, BOUNDS.x - 0.2), z: clamp(pos.z + dir.z * range, -BOUNDS.z + 0.2, BOUNDS.z - 0.2) },
        x: pos.x, y: skill === 3 ? 1.1 : 0.62, z: pos.z,
        duration: skill === 3 ? 0.8 + range * 0.035 : range / spec.speed,
        powered: skill === 3 && p.buff === 'mega', freeze: skill !== 3 && p.buff === 'freeze'
      };
      this.projectiles.push(projectile); projectiles.push(projectile.id);
    }
    p.cd[skill] = spec.cooldown;
    p.aim = target;
    this.event('shot', { player: p.id, skill, target, projectiles, powered: skill === 3 && p.buff === 'mega', dir });
  }

  think(p, dt) {
    const enemies = this.players.filter(x => x.team !== p.team && x.hp > 0);
    if (!enemies.length) return;
    const pos = p.body.position;
    enemies.sort((a, b) => distance(pos, a.body.position) - distance(pos, b.body.position));
    const enemy = enemies[0];
    const ep = enemy.body.position;
    const dist = distance(pos, ep);
    p.aim = { x: ep.x + enemy.move.x * 0.35, z: ep.z + enemy.move.z * 0.35 };
    if (this.time > p.nextThink) {
      p.nextThink = this.time + 0.35 + this.random() * 0.2;
      let goal = ep;
      if (this.loot && distance(pos, this.loot) < 5 && !p.buff) goal = this.loot;
      const sx = clamp(Math.round((pos.x + BOUNDS.x) / cellSize), 0, NAV.cols - 1), sz = clamp(Math.round((pos.z + BOUNDS.z) / cellSize), 0, NAV.rows - 1);
      const gx = clamp(Math.round((goal.x + BOUNDS.x) / cellSize), 0, NAV.cols - 1), gz = clamp(Math.round((goal.z + BOUNDS.z) / cellSize), 0, NAV.rows - 1);
      if (this.nav.isWalkableAt(sx, sz) && this.nav.isWalkableAt(gx, gz)) p.path = this.finder.findPath(sx, sz, gx, gz, this.nav.clone()).slice(1);
    }
    const visible = this.sight(pos, ep);
    if (dist < 6.6 && visible) {
      const direction = unit(ep.x - pos.x, ep.z - pos.z);
      const strafe = Math.sin(this.time * 0.9 + this.players.indexOf(p) * 2) * 0.65;
      const forward = dist < 3.2 ? -0.8 : dist > 5.5 ? 0.4 : 0;
      p.move = { x: direction.x * forward - direction.z * strafe, z: direction.z * forward + direction.x * strafe };
    } else if (p.path.length) {
      const [cx, cz] = p.path[0];
      const goal = { x: cx * cellSize - BOUNDS.x, z: cz * cellSize - BOUNDS.z };
      if (distance(pos, goal) < 0.24) p.path.shift();
      p.move = unit(goal.x - pos.x, goal.z - pos.z);
    } else p.move = { x: 0, z: 0 };
    if (this.time > p.nextShot) {
      const spread = this.training && p.team !== this.players[0].team ? 4.4 : 3.4;
      const target = { x: p.aim.x + (this.random() - 0.5) * spread, z: p.aim.z + (this.random() - 0.5) * spread };
      if (dist < 8.9 && visible && p.cd[0] <= 0) this.command(p.id, 0, target);
      if (dist < 6.8 && visible && p.cd[1] <= 0) this.command(p.id, 1, target);
      if (dist < 6 && p.cd[3] <= 0 && this.random() < 0.65) this.command(p.id, 3, target);
      if (dist < 2.8 && p.cd[2] <= 0 && this.random() < 0.3) this.command(p.id, 2, target);
      p.nextShot = this.time + 0.4 + this.random() * 0.55;
    }
  }

  blast(q, point, damage) {
    const radius = 1.9;
    this.event('blast', { x: point.x, z: point.z, skill: q.skill, team: q.team, powered: q.powered });
    const owner = this.players.find(x => x.id === q.owner);
    let hit = false;
    for (const p of this.players) {
      if (p.hp <= 0 || p.team === q.team) continue;
      const dist = distance(point, p.body.position);
      if (dist > radius + ARENA.radius * 0.3) continue;
      const amount = dist <= 0.85 ? (q.powered ? 52 : 35) : 18;
      damage.push({ target: p, amount, owner, slow: q.skill === 3 ? 1 : q.freeze ? 1.5 : 0 });
      hit = true;
    }
    if (hit && owner && ((q.powered && owner.buff === 'mega') || (q.freeze && owner.buff === 'freeze'))) {
      owner.buff = null; owner.buffUntil = 0;
    }
  }

  damage(hits) {
    for (const hit of hits) {
      const p = hit.target;
      if (p.hp <= 0) continue;
      const absorbed = Math.min(p.shield, hit.amount);
      p.shield -= absorbed;
      const dealt = Math.min(p.hp, hit.amount - absorbed);
      p.hp -= dealt;
      if (hit.owner) hit.owner.damage += dealt;
      if (hit.slow) p.slowUntil = this.time + hit.slow;
      this.event('damage', { player: p.id, amount: dealt, absorbed, owner: hit.owner?.id });
      if (p.hp <= 0) {
        p.body.collisionResponse = false;
        p.body.velocity.setZero();
        p.buff = null;
        p.shield = 0;
        if (hit.owner) hit.owner.kills++;
        this.event('down', { player: p.id, owner: hit.owner?.id });
      }
    }
  }

  finish(winner, reason) {
    if (this.state === 'result') return;
    this.state = 'result';
    this.winner = winner;
    this.reason = reason;
    this.projectiles = [];
    this.players.forEach(p => { p.body.velocity.setZero(); p.move = { x: 0, z: 0 }; });
    this.event('finish', { winner, reason });
  }

  step(dt) {
    if (this.paused || this.state === 'result') return;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.state = 'playing'; this.event('start'); }
      return;
    }
    this.time += dt;
    for (const p of this.players) {
      for (const k of [0, 1, 2, 3]) p.cd[k] = Math.max(0, p.cd[k] - dt);
      if (p.buff && this.time >= p.buffUntil) { p.buff = null; p.shield = 0; }
      if (p.bot && p.hp > 0) this.think(p, dt);
    }
    // A frame always resolves dashes before projectiles and damage.
    for (const p of this.players) for (const cmd of p.queue) if (cmd.skill === 2 && p.hp > 0) this.dash(p, cmd.target);
    for (const p of this.players) {
      for (const cmd of p.queue) if (cmd.skill !== 2 && p.hp > 0) this.shoot(p, cmd.skill, cmd.target);
      p.queue = [];
      if (Math.hypot(p.move.x, p.move.z) > 0.1) p.lastMove = unit(p.move.x, p.move.z);
      const speed = p.hp <= 0 ? 0 : ARENA.speed * (p.slowUntil > this.time ? 0.7 : 1);
      p.body.velocity.set(p.move.x * speed, 0, p.move.z * speed);
    }
    this.world.step(dt);
    for (const p of this.players) {
      p.body.position.x = clamp(p.body.position.x, -BOUNDS.x + ARENA.radius, BOUNDS.x - ARENA.radius);
      p.body.position.z = clamp(p.body.position.z, -BOUNDS.z + ARENA.radius, BOUNDS.z - ARENA.radius);
    }
    const hits = [];
    this.projectiles = this.projectiles.filter(q => {
      const old = { x: q.x, y: q.y, z: q.z };
      q.age += dt;
      const t = Math.min(1, q.age / q.duration);
      if (q.skill !== 3) {
        q.x = q.start.x + q.dir.x * Math.min(q.range, q.age * q.speed);
        q.z = q.start.z + q.dir.z * Math.min(q.range, q.age * q.speed);
      } else {
        q.x = q.start.x + (q.target.x - q.start.x) * t;
        q.z = q.start.z + (q.target.z - q.start.z) * t;
        q.y = 1.1 * (1 - t) + 3.4 * 4 * t * (1 - t);
      }
      const rayHit = this.ray(old, q, body => body.mass === 0 || (q.skill !== 3 && this.players.some(p => p.body === body && p.team !== q.team && p.hp > 0)));
      if (rayHit || t >= 1) {
        const point = rayHit ? rayHit.point : q;
        if (q.skill === 3) this.blast(q, point, hits);
        else {
          const target = rayHit && this.players.find(p => p.body === rayHit.body && p.hp > 0 && p.team !== q.team);
          this.event('impact', { x: point.x, z: point.z, skill: q.skill, team: q.team, hit: !!target });
          if (target) {
            const owner = this.players.find(p => p.id === q.owner);
            hits.push({ target, amount: SKILLS[0].damage, owner, slow: q.freeze ? 1.5 : 0 });
            if (q.freeze && owner?.buff === 'freeze') { owner.buff = null; owner.buffUntil = 0; }
          }
        }
        return false;
      }
      return true;
    });
    this.damage(hits);
    if (!this.loot) {
      this.lootTimer -= dt;
      if (this.lootTimer <= 0) {
        const types = ['mega', 'freeze', 'shield'];
        this.loot = { x: 0, z: 0, type: types[Math.floor(this.random() * 3)] };
        this.event('lootSpawn', { buff: this.loot.type });
      }
    } else {
      const p = this.players.find(p => p.hp > 0 && distance(p.body.position, this.loot) < 0.8);
      if (p) {
        p.buff = this.loot.type;
        p.buffUntil = this.time + BUFFS[p.buff].duration;
        p.shield = p.buff === 'shield' ? 40 : 0;
        this.event('pickup', { player: p.id, buff: p.buff });
        this.loot = null; this.lootTimer = 45;
      }
    }
    const blue = this.players.filter(p => p.team === 'blue');
    const red = this.players.filter(p => p.team === 'red');
    const alive = team => team.some(p => p.hp > 0);
    if (!alive(blue) || !alive(red)) this.finish(alive(blue) ? 'blue' : alive(red) ? 'red' : 'draw', '团灭');
    else if (this.time >= ARENA.limit) {
      const health = team => team.reduce((sum, p) => sum + p.hp, 0);
      const kills = team => team.reduce((sum, p) => sum + p.kills, 0);
      const delta = health(blue) - health(red) || kills(blue) - kills(red);
      this.finish(delta > 0 ? 'blue' : delta < 0 ? 'red' : 'draw', '时间到');
    }
  }

  snapshot(afterEventId = null) {
    return {
      state: this.state, round: this.round, time: this.time, countdown: this.countdown, paused: this.paused,
      training: this.training, winner: this.winner, reason: this.reason, loot: this.loot, lootTimer: this.lootTimer,
      players: this.players.map(p => ({
        id: p.id, name: p.name, team: p.team, bot: p.bot, hp: p.hp, shield: p.shield, buff: p.buff,
        buffRemaining: Math.max(0, p.buffUntil - this.time), slow: p.slowUntil > this.time,
        x: p.body.position.x, z: p.body.position.z, vx: p.body.velocity.x, vz: p.body.velocity.z,
        facing: { ...p.lastMove }, aim: p.aim, cd: { ...p.cd }, kills: p.kills, damage: p.damage, ready: p.ready
      })),
      projectiles: this.projectiles.map(q => ({ id: q.id, skill: q.skill, team: q.team, owner: q.owner, x: q.x, y: q.y, z: q.z, dir: q.dir, powered: q.powered })),
      events: afterEventId === null ? this.events.slice(-50) : this.events.filter(event => event.id > afterEventId)
    };
  }
}
