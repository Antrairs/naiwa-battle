import { ARENA, BOUNDS, WALLS } from './config.js';

const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const blocked = (x, z, players, id) => WALLS.some(w => {
  const dx = x - clamp(x, w.x - w.w / 2, w.x + w.w / 2);
  const dz = z - clamp(z, w.z - w.d / 2, w.z + w.d / 2);
  return dx * dx + dz * dz < ARENA.radius ** 2;
}) || players.some(p => p.id !== id && p.hp > 0 && Math.hypot(p.x - x, p.z - z) < ARENA.radius * 2);

// Presentation prediction only; the server still owns collisions and all combat.
export function advance(position, vx, vz, dt, players = [], id = '') {
  const steps = Math.max(1, Math.ceil(Math.hypot(vx, vz) * dt / 0.1));
  let { x, z } = position;
  for (let i = 0; i < steps; i++) {
    const nx = clamp(x + vx * dt / steps, -BOUNDS.x + ARENA.radius, BOUNDS.x - ARENA.radius);
    if (!blocked(nx, z, players, id)) x = nx;
    const nz = clamp(z + vz * dt / steps, -BOUNDS.z + ARENA.radius, BOUNDS.z - ARENA.radius);
    if (!blocked(x, nz, players, id)) z = nz;
  }
  return { x, z };
}

export class Motion {
  constructor() { this.reset(); }
  reset() { this.samples = []; this.position = null; this.facing = null; this.correction = { x: 0, z: 0 }; this.round = 0; this.snapLocal = false; }
  push(snapshot, now, localId, latency = 0) {
    if (snapshot.round !== this.round) { this.reset(); this.round = snapshot.round; }
    this.samples.push({ snapshot, now });
    if (this.samples.length > 12) this.samples.shift();
    const p = snapshot.players.find(p => p.id === localId);
    if (!p) return;
    const active = snapshot.state === 'playing' && !snapshot.paused && p.hp > 0;
    const target = active ? advance(p, p.vx, p.vz, Math.min(0.1, latency), snapshot.players, p.id) : p;
    if (!this.position || this.snapLocal || !active || Math.hypot(target.x - this.position.x, target.z - this.position.z) > 1.5) {
      this.position = { x: target.x, z: target.z };
      this.facing = p.facing;
      this.correction = { x: 0, z: 0 }; this.snapLocal = false;
    } else this.correction = { x: target.x - this.position.x, z: target.z - this.position.z };
  }
  sample(now, dt, localId, movement) {
    const newest = this.samples.at(-1);
    if (!newest) return null;
    const latest = newest.snapshot;
    const active = latest.state === 'playing' && !latest.paused && now - newest.now < 300;
    const time = latest.time + Math.min(0.1, (now - newest.now) / 1000) - 0.07;
    let left = this.samples[0].snapshot, right = left;
    for (const sample of this.samples) {
      right = sample.snapshot;
      if (right.time >= time) break;
      left = right;
    }
    const t = clamp((time - left.time) / Math.max(0.0001, right.time - left.time), 0, 1);
    const blend = (a, b) => {
      if (!a || Math.hypot(b.x - a.x, b.z - a.z) > 1.5) return b;
      return { ...b, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y === undefined ? undefined : a.y + (b.y - a.y) * t };
    };
    const players = latest.players.map(p => {
      if (p.id !== localId || !this.position) {
        if (!active) return p;
        const b = right.players.find(x => x.id === p.id) || p;
        return { ...p, ...blend(left.players.find(x => x.id === p.id), b), hp: p.hp, shield: p.shield };
      }
      const speed = active && p.hp > 0 ? ARENA.speed * (p.slow ? 0.7 : 1) : 0;
      const vx = movement.x * speed, vz = movement.z * speed;
      this.position = advance(this.position, vx, vz, dt, latest.players, p.id);
      const fraction = 1 - Math.exp(-dt * 12);
      const cx = this.correction.x * fraction, cz = this.correction.z * fraction;
      this.position = advance(this.position, cx, cz, 1, latest.players, p.id);
      this.correction.x -= cx; this.correction.z -= cz;
      if (Math.hypot(vx, vz) > 0.1) this.facing = { ...movement };
      return { ...p, ...this.position, vx, vz, facing: this.facing || p.facing };
    });
    const projectiles = active ? right.projectiles.map(q => blend(left.projectiles.find(a => a.id === q.id), q)) : latest.projectiles;
    return { ...latest, players, projectiles };
  }
}
