import * as THREE from 'three';
import { ARENA, BOUNDS, WALLS, SPAWNS } from './shared/config.js';

export function buildFactory(view, { material, mesh, box, batchStatic }) {
  const group = new THREE.Group(); view.scene.add(group); view.environment = group;
  const geo = { sphere: new THREE.SphereGeometry(1, 10, 7), eye: new THREE.SphereGeometry(1, 20, 12), cylinder: new THREE.CylinderGeometry(1, 1, 1, 12) };
  const sphere = (parent, mat, x, y, z, sx, sy = sx, sz = sx) => mesh(parent, geo.sphere, mat, x, y, z, sx, sy, sz);
  const loader = new THREE.TextureLoader(view.loadingManager);
  view.environmentTextures = [];
  const texture = (url, x = 1, y = 1) => {
    const map = loader.load(url); map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(x, y);
    map.anisotropy = Math.min(8, view.renderer.capabilities.getMaxAnisotropy());
    view.environmentTextures.push(map); return map;
  };
  const p = {
    ivory: material('#fff3cf'), milk: material('#fffbe8'), gold: material('#eebc39', { metalness: 0.22, roughness: 0.42 }),
    trim: material('#b38930', { metalness: 0.35 }), teal: material('#3e8582'), dark: material('#365654'),
    steel: material('#b7c7b7', { metalness: 0.45, roughness: 0.4 }), green: material('#698f49'), leaf: material('#87aa4a'),
    blue: material('#2cadd0'), red: material('#e87a81'),
    tank: material('#f2c643', { roughness: 0.48 }), iris: material('#9cae70', { roughness: 0.3 }),
    pupil: material('#142019', { roughness: 0.16 }), glint: material('#fffef1', { roughness: 0.12 }),
    amber: material('#ffb332', { emissive: '#ff9f17', emissiveIntensity: 0.45, roughness: 0.35 }),
    lamp: material('#ffe7a0', { emissive: '#ffb524', emissiveIntensity: 0.8 }),
    panel: material('#ffffff', { map: texture('/assets/textures/factory-panel.webp'), roughness: 0.62 }),
    floor: material('#c0d6d0', { map: texture('/assets/textures/factory-floor.webp', 6, 3.667), roughness: 0.9 })
  };
  const cylinder = (parent, mat, x, y, z, radius, length, axis = 'y') => {
    const object = mesh(parent, geo.cylinder, mat, x, y, z, radius, length, radius);
    if (axis === 'x') object.rotation.z = Math.PI / 2;
    if (axis === 'z') object.rotation.x = Math.PI / 2;
    return object;
  };
  const pipe = (parent, points, radius, mat = p.gold) => mesh(parent,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v => new THREE.Vector3(...v))), Math.max(12, points.length * 5), radius, 10, false), mat);
  const beacon = (parent, x, y, z, scale = 1) => {
    cylinder(parent, p.dark, x, y, z, 0.19 * scale, 0.08 * scale);
    cylinder(parent, p.lamp, x, y + 0.16 * scale, z, 0.13 * scale, 0.25 * scale);
    sphere(parent, p.gold, x, y + 0.29 * scale, z, 0.18 * scale, 0.08 * scale, 0.18 * scale);
  };

  const outside = mesh(group, new THREE.PlaneGeometry(180, 150), material('#78b5b2'), 0, -2, 0);
  outside.rotation.x = -Math.PI / 2; outside.castShadow = false;
  box(group, p.teal, 0, -1.12, 0, ARENA.width + 3, 1.55, ARENA.depth + 3, 0.35);
  box(group, p.dark, 0, -0.48, 0, ARENA.width + 2.1, 0.22, ARENA.depth + 2.1);
  box(group, p.ivory, 0, -0.22, 0, ARENA.width + 1.6, 0.35, ARENA.depth + 1.6, 0.15);
  const floor = mesh(group, new THREE.PlaneGeometry(ARENA.width, ARENA.depth), p.floor, 0, 0, 0);
  floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
  for (const z of [-BOUNDS.z - 0.28, BOUNDS.z + 0.28]) {
    box(group, p.dark, 0, 0.03, z, ARENA.width + 1.25, 0.08, 0.76, 0.03);
    for (let x = -BOUNDS.x; x <= BOUNDS.x; x += 0.8) cylinder(group, p.steel, x, 0.12, z, 0.085, 0.48, 'z');
    for (const offset of [-0.32, 0.32]) box(group, p.gold, 0, 0.18, z + offset, ARENA.width + 1.3, 0.12, 0.13, 0.04);
    for (let x = -BOUNDS.x; x <= BOUNDS.x; x += 1.5) {
      box(group, p.ivory, x, -0.13, z + Math.sign(z) * 0.3, 0.16, 0.49, 0.12, 0.03);
      sphere(group, p.trim, x, 0.19, z + 0.31, 0.045);
    }
  }
  for (const x of [-BOUNDS.x - 0.28, BOUNDS.x + 0.28]) {
    box(group, p.ivory, x, 0.15, 0, 0.55, 0.3, ARENA.depth, 0.07);
    cylinder(group, x < 0 ? p.blue : p.red, x, 0.38, 0, 0.13, ARENA.depth + 0.55, 'z');
    for (let z = -BOUNDS.z + 1; z < BOUNDS.z; z += 2) {
      cylinder(group, p.ivory, x, 0.38, z, 0.19, 0.13, 'z');
      box(group, p.gold, x, -0.85, z, 0.17, 1.2, 0.22, 0.035);
    }
  }

  WALLS.forEach((w, index) => {
    const root = new THREE.Group(); root.position.set(w.x, 0, w.z); group.add(root);
    const length = Math.max(w.w, w.d), depth = Math.min(w.w, w.d);
    if (w.d > w.w) root.rotation.y = Math.PI / 2;
    if (w.h === 2) {
      root.userData.dynamicWall = true;
      box(root, p.teal, 0, 0.13, 0, length + 0.06, 0.26, depth + 0.06);
      box(root, p.panel, 0, 0.87, 0, length, 1.5, depth, 0.12);
      box(root, p.milk, 0, 1.56, 0, length + 0.02, 0.15, depth + 0.04, 0.07);
      const half = length / 2 - 0.3;
      pipe(root, [[-half, 0.98, 0], [-half, 1.63, 0], [-half + 0.3, 1.9, 0], [half - 0.3, 1.9, 0], [half, 1.63, 0], [half, 0.98, 0]], 0.24);
      for (let x = -half + 0.35; x <= half - 0.25; x += 1.25) {
        cylinder(root, p.ivory, x, 1.9, 0, 0.31, 0.14, 'x');
        for (const z of [-0.21, 0.21]) sphere(root, p.trim, x, 2.1, z, 0.045);
      }
      for (const x of [-length * 0.28, length * 0.28]) {
        for (const z of [-depth / 2 - 0.015, depth / 2 + 0.015]) {
          cylinder(root, p.ivory, x, 0.86, z, 0.23, 0.07, 'z');
          cylinder(root, p.dark, x, 0.86, z + Math.sign(z) * 0.04, 0.16, 0.035, 'z');
          const needle = box(root, p.lamp, x, 0.88, z + Math.sign(z) * 0.065, 0.035, 0.18, 0.02, 0.008); needle.rotation.z = -0.5;
          box(root, p.ivory, x + 0.26, 1.38, z, 0.13, 0.32, 0.025, 0.05);
          sphere(root, p.milk, x + 0.26, 1.21, z, 0.07, 0.12, 0.03);
        }
      }
      beacon(root, 0, 1.98, 0, 0.65);
      // Bake fitting colors into vertices so each wall fades independently with only three batches.
      const fittings = material('#ffffff', { vertexColors: true, roughness: 0.6, metalness: 0.12 });
      root.traverse(object => {
        if (!object.isMesh || object.material.map || object.material === p.lamp) return;
        object.geometry = object.geometry.clone();
        const colors = new Float32Array(object.geometry.attributes.position.count * 3), color = object.material.color;
        for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
        object.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); object.material = fittings;
      });
      const materials = new Map();
      root.traverse(object => {
        if (!object.isMesh) return;
        if (!materials.has(object.material)) { const clone = object.material.clone(); clone.transparent = true; materials.set(object.material, clone); }
        object.material = materials.get(object.material);
      });
      batchStatic(root, true); root.userData.fade = 1; root.userData.targetOpacity = 1; view.wallMeshes.push(root);
    } else {
      box(root, p.dark, 0, 0.12, 0, length, 0.24, depth);
      box(root, p.panel, 0, 0.54, 0, length, 0.82, depth, 0.11);
      box(root, p.ivory, 0, 0.98, 0, length + 0.04, 0.13, depth + 0.04, 0.05);
      box(root, index % 2 ? p.red : p.blue, 0, 1.052, 0, length * 0.38, 0.018, depth * 0.32, 0.01);
      for (const x of [-length * 0.32, length * 0.32]) {
        box(root, p.gold, x, 1.065, 0, 0.13, 0.035, depth * 0.94, 0.01);
        for (const z of [-depth * 0.33, depth * 0.33]) sphere(root, p.trim, x, 1.1, z, 0.045, 0.024, 0.045);
      }
    }
  });

  cylinder(group, p.teal, 0, 0.018, 0, 1.6, 0.035);
  const plazaRing = mesh(group, new THREE.RingGeometry(1.34, 1.44, 64), p.ivory, 0, 0.04, 0); plazaRing.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const mark = box(group, p.gold, Math.cos(angle) * 1.73, 0.022, Math.sin(angle) * 1.73, 0.25, 0.025, 0.07, 0.01); mark.rotation.y = -angle;
  }
  for (const [team, spawns] of Object.entries(SPAWNS)) for (const { x, z } of spawns) {
    const ring = mesh(group, new THREE.RingGeometry(0.78, 0.9, 32), team === 'blue' ? p.blue : p.red, x, 0.025, z); ring.rotation.x = -Math.PI / 2;
  }
  view.mapSign(group, 'MILK WORKS / 02', 0, 0.025, -BOUNDS.z + 0.65, '#dce5c7', 3.4, 0.45, '#527e70');
  view.mapSign(group, 'BOMBO / 2V2', 0, 0.025, BOUNDS.z - 0.65, '#dce5c7', 3.4, 0.45, '#527e70');
  for (const x of [-BOUNDS.x - 0.3, BOUNDS.x + 0.3]) for (const z of [-BOUNDS.z - 0.3, BOUNDS.z + 0.3]) {
    box(group, p.teal, x, 0.33, z, 0.7, 0.65, 0.7, 0.1); beacon(group, x, 0.69, z);
  }

  const tank = (x, z, radius, height) => {
    const root = new THREE.Group(); root.name = 'milk-tank'; root.position.set(x, -1.8, z);
    root.rotation.y = Math.atan2(-x, 23 - z); group.add(root);
    const profile = [[0,0],[0.81,0],[0.93,0.06],[0.99,0.15],[1.025,0.32],[1.025,0.64],[1.005,0.8],[0.96,0.89],[0.87,0.94],[0,0.94]];
    const bodyRadius = y => {
      for (let i = 1; i < profile.length; i++) if (y <= profile[i][1] * height) {
        const [ra, ya] = profile[i - 1], [rb, yb] = profile[i];
        return radius * THREE.MathUtils.lerp(ra, rb, (y / height - ya) / Math.max(0.0001, yb - ya));
      }
      return radius;
    };
    mesh(root, new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * radius, y * height)), 32), p.tank);
    cylinder(root, p.gold, 0, 0.1, 0, radius * 0.94, 0.2);
    const lid = [[0,0.87],[0.99,0.87],[1.04,0.89],[1.045,0.92],[1.025,0.96],[0.96,0.995],[0.82,1.015],[0,1.015]];
    mesh(root, new THREE.LatheGeometry(lid.map(([r, y]) => new THREE.Vector2(r * radius, y * height)), 32), p.milk);

    // The belly follows the barrel surface instead of floating in front like a flat sign.
    const vertices = [], indices = [], rows = 18, cols = 24;
    for (let row = 0; row <= rows; row++) {
      const v = row / rows * 2 - 1, y = height * (0.29 + v * 0.28), r = bodyRadius(y) + radius * 0.008;
      for (let col = 0; col <= cols; col++) {
        const angle = (col / cols * 2 - 1) * 0.8 * Math.sqrt(Math.max(0, 1 - v * v));
        vertices.push(Math.sin(angle) * r, y, Math.cos(angle) * r);
        if (row < rows && col < cols) {
          const a = row * (cols + 1) + col, b = a + cols + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const belly = new THREE.BufferGeometry(); belly.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    belly.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(vertices.length / 3 * 2), 2));
    belly.setIndex(indices); belly.computeVertexNormals(); mesh(root, belly, p.ivory);
    for (const side of [-1, 1]) {
      const angle = side * 0.5, y = height * 0.73, r = bodyRadius(y);
      const eye = new THREE.Group(); eye.position.set(Math.sin(angle) * r, y, Math.cos(angle) * r); eye.rotation.y = angle; root.add(eye);
      mesh(eye, geo.eye, p.iris, 0, 0, radius * 0.015, radius * 0.245, radius * 0.29, radius * 0.13);
      mesh(eye, geo.eye, p.pupil, -side * radius * 0.014, -radius * 0.012, radius * 0.12, radius * 0.155, radius * 0.205, radius * 0.07);
      sphere(eye, p.glint, -radius * 0.055, radius * 0.075, radius * 0.18, radius * 0.037, radius * 0.052, radius * 0.013);
      sphere(eye, p.glint, radius * 0.04, -radius * 0.075, radius * 0.18, radius * 0.015, radius * 0.022, radius * 0.008);
    }
    const mouth = [[-0.23,0.635],[-0.12,0.619],[0,0.614],[0.12,0.619],[0.23,0.635]].map(([u, v]) => {
      const x = u * radius, y = v * height, r = bodyRadius(y);
      return [x, y, Math.sqrt(r * r - x * x) + radius * 0.022];
    });
    pipe(root, mouth, radius * 0.025, p.pupil);
    for (const [x, y, z] of [mouth[0], mouth[mouth.length - 1]]) sphere(root, p.pupil, x, y, z, radius * 0.025);

    const roof = height * 1.015;
    for (const offset of [0.11, 0.38]) {
      const rail = mesh(root, new THREE.TorusGeometry(radius * 0.83, radius * 0.025, 6, 32), p.gold, 0, roof + radius * offset, 0); rail.rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      cylinder(root, p.gold, Math.cos(angle) * radius * 0.83, roof + radius * 0.19, Math.sin(angle) * radius * 0.83, radius * 0.022, radius * 0.39);
    }
    cylinder(root, p.ivory, 0, roof + radius * 0.05, 0, radius * 0.24, radius * 0.1);
    cylinder(root, p.gold, 0, roof + radius * 0.12, 0, radius * 0.22, radius * 0.08);
    cylinder(root, p.amber, 0, roof + radius * 0.31, 0, radius * 0.16, radius * 0.29);
    box(root, p.glint, 0, roof + radius * 0.31, radius * 0.159, radius * 0.11, radius * 0.18, radius * 0.014, radius * 0.02);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      cylinder(root, p.gold, Math.cos(a) * radius * 0.19, roof + radius * 0.31, Math.sin(a) * radius * 0.19, radius * 0.022, radius * 0.32);
    }
    sphere(root, p.gold, 0, roof + radius * 0.49, 0, radius * 0.24, radius * 0.09, radius * 0.24);
    sphere(root, p.gold, 0, roof + radius * 0.58, 0, radius * 0.055);

    pipe(root, [[radius * 0.88,height * 0.45,-radius * 0.15],[radius * 1.42,height * 0.45,-radius * 0.15],[radius * 1.7,height * 0.54,-radius * 0.15],[radius * 1.7,height * 0.91,-radius * 0.15],[radius * 1.7,height * 1.1,-radius * 0.15]], radius * 0.18);
    cylinder(root, p.ivory, radius * 1.08, height * 0.45, -radius * 0.15, radius * 0.29, radius * 0.13, 'x');
    cylinder(root, p.ivory, radius * 1.7, height * 0.9, -radius * 0.15, radius * 0.29, radius * 0.13);
    cylinder(root, p.gold, radius * 1.7, height * 1.1, -radius * 0.15, radius * 0.18, radius * 0.035);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      sphere(root, p.gold, radius * 1.16, height * 0.45 + Math.cos(a) * radius * 0.24, -radius * 0.15 + Math.sin(a) * radius * 0.24, radius * 0.035);
      sphere(root, p.gold, radius * (1.7 + Math.cos(a) * 0.24), height * 0.9 + radius * 0.08, radius * (-0.15 + Math.sin(a) * 0.24), radius * 0.035);
    }
  };
  for (const [x, z, radius, height] of [[-14.7,-14.5,1.45,4.9],[-6.7,-15.1,1.85,5.4],[6,-15.2,1.5,4.9],[14.8,-14.8,1.85,5.4],[-23,-5,1.7,4.8],[23,2,1.8,4.7]]) tank(x, z, radius, height);
  const pipeline = pipe(group, [[-20,-0.9,-16],[-20,1.5,-16],[-17,2.3,-16],[-4,2.3,-16],[-2,1.4,-16],[2,1.4,-16],[4,2.3,-16],[20,2.3,-16],[22,1.5,-16],[22,-0.9,-16]], 0.3);
  const centerline = pipeline.geometry.parameters.path;
  for (let i = 1; i < 16; i++) {
    const t = i / 16, position = centerline.getPointAt(t);
    const collar = cylinder(group, p.ivory, position.x, position.y, position.z, 0.39, 0.15);
    collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), centerline.getTangentAt(t));
  }
  const palm = (x, z, height) => {
    cylinder(group, p.trim, x, height / 2 - 1.8, z, 0.17, height);
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7;
      const leaf = sphere(group, i % 2 ? p.green : p.leaf, x + Math.cos(angle) * 0.67, height - 1.9, z + Math.sin(angle) * 0.67, 1.2, 0.14, 0.32);
      leaf.rotation.y = -angle; leaf.rotation.z = Math.cos(angle) * 0.2;
    }
    for (let i = 0; i < 4; i++) sphere(group, p.green, x + Math.sin(i * 2) * 0.5, -1.35, z + Math.cos(i * 2) * 0.5, 0.66, 0.5, 0.7);
  };
  for (const [x, z, h] of [[-21,-12,4.5],[21,-10,5],[-12,-20,5],[11,-21,4.7],[-23,6,3.6],[23,8,4.5]]) palm(x, z, h);
  batchStatic(group, true);
}
