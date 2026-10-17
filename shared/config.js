export const ARENA = { width: 36, depth: 22, radius: 0.43, speed: 5.2, limit: 600 };
export const BOUNDS = { x: ARENA.width / 2, z: ARENA.depth / 2 };
export const NAV = { cellSize: 0.5, cols: ARENA.width * 2 + 1, rows: ARENA.depth * 2 + 1 };
export const MAP_SCALE = 1.25;
export const SKILLS = {
  0: { name: '普攻', cooldown: 0.24, range: 9, damage: 8, speed: 19 },
  1: { name: '散弹齐射', cooldown: 5, range: 7, damage: 8, speed: 18, pellets: 5, spread: Math.PI / 4 },
  2: { name: '闪步位移', cooldown: 6, range: 3, damage: 0 },
  3: { name: '抛物榴弹', cooldown: 9, range: 6, damage: 35 }
};
export const WALLS = [
  { x: -7.3, z: -2.2, w: 1.1, d: 5.4, h: 2 },
  { x: 7.3, z: 2.2, w: 1.1, d: 5.4, h: 2 },
  { x: -10.6, z: 1.7, w: 3.3, d: 1.1, h: 2 },
  { x: 10.6, z: -1.7, w: 3.3, d: 1.1, h: 2 },
  { x: -2.7, z: -4.8, w: 5.2, d: 1.1, h: 2 },
  { x: 2.7, z: 4.8, w: 5.2, d: 1.1, h: 2 },
  { x: -2.7, z: 1.6, w: 1.05, d: 3.3, h: 2 },
  { x: 2.7, z: -1.6, w: 1.05, d: 3.3, h: 2 },
  { x: -10.5, z: -5.8, w: 2.3, d: 1.1, h: 1 },
  { x: 10.5, z: 5.8, w: 2.3, d: 1.1, h: 1 },
  { x: -4.8, z: 5.6, w: 2.7, d: 1.1, h: 1 },
  { x: 4.8, z: -5.6, w: 2.7, d: 1.1, h: 1 },
  { x: -5.1, z: -0.5, w: 1.9, d: 1.05, h: 1 },
  { x: 5.1, z: 0.5, w: 1.9, d: 1.05, h: 1 },
  { x: -0.1, z: -2.8, w: 1.6, d: 0.9, h: 1 },
  { x: 0.1, z: 2.8, w: 1.6, d: 0.9, h: 1 }
].map(w => ({ ...w, x: w.x * MAP_SCALE, z: w.z * MAP_SCALE, w: w.w * MAP_SCALE, d: w.d * MAP_SCALE }));
export const SPAWNS = {
  blue: [{ x: -15, z: 7.3 }, { x: -15, z: -4.5 }],
  red: [{ x: 15, z: -7.3 }, { x: 15, z: 4.5 }]
};
export const BUFFS = {
  mega: { name: '巨爆弹', duration: 30, color: '#f9c54f' },
  freeze: { name: '急冻核心', duration: 30, color: '#63dce9' },
  shield: { name: '护盾发生器', duration: 20, color: '#b59bea' }
};
