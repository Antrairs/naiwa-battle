import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA, BOUNDS, SKILLS } from './shared/config.js';
import { buildFactory } from './environment.js';

const UP = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();
const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...extra });
const M = {
  skin: material('#f6c844'), belly: material('#f8df97'), olive: material('#6e733c'),
  eye: material('#91b855', { roughness: 0.35 }), pupil: material('#172824', { roughness: 0.2 }),
  white: material('#fff9d9'), dark: material('#30443e'), metal: material('#60786b', { metalness: 0.35, roughness: 0.45 }),
  blue: material('#249fbe'), red: material('#e16b78'), floor: material('#87b8a3'),
  ivory: material('#edf0dc'), wall: material('#b5c6bc'), cap: material('#f3f3e1'),
  coral: material('#dc967e'), gold: material('#f3c348'), purple: material('#bca6d4'),
  bullet: new THREE.MeshBasicMaterial({ color: '#fffbd0' }),
  tracerBlue: new THREE.MeshBasicMaterial({ color: '#20d9f3' }), tracerRed: new THREE.MeshBasicMaterial({ color: '#ff5766' }),
  grenade: new THREE.MeshBasicMaterial({ color: '#ffb52e' })
};
const geo = {
  sphere: new THREE.SphereGeometry(1, 16, 10), limb: new THREE.CapsuleGeometry(0.13, 0.1, 4, 10),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 16), particle: new THREE.IcosahedronGeometry(1, 0)
};
const sharedGeometries = new Set(Object.values(geo));
const sharedMaterials = new Set(Object.values(M));
function releaseTree(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(object => {
    if (!object.isMesh) return;
    if (!sharedGeometries.has(object.geometry)) geometries.add(object.geometry);
    if (!sharedMaterials.has(object.material)) materials.add(object.material);
  });
  root.removeFromParent();
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(mat => mat.dispose());
}
function mesh(group, geometry, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const object = new THREE.Mesh(geometry, mat);
  object.position.set(x, y, z); object.scale.set(sx, sy, sz);
  object.castShadow = true; object.receiveShadow = true; group.add(object); return object;
}
function box(group, mat, x, y, z, w, h, d, radius = 0.08) {
  return mesh(group, new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, w / 3, h / 3, d / 3)), mat, x, y, z);
}
function sphere(group, mat, x, y, z, sx, sy = sx, sz = sx) { return mesh(group, geo.sphere, mat, x, y, z, sx, sy, sz); }
function segment(object, a, b, radius) {
  object.position.copy(a).add(b).multiplyScalar(0.5);
  direction.subVectors(b, a);
  const length = direction.length();
  object.quaternion.setFromUnitVectors(UP, direction.normalize());
  object.scale.set(radius, length, radius);
}
function batchStatic(group, recursive = false) {
  group.updateWorldMatrix(true, true);
  const inverse = group.matrixWorld.clone().invert(), batches = new Map(), objects = [];
  const collect = object => {
    if (!object.isMesh || object.userData.dynamicWall) return;
    let parent = object.parent;
    while (parent && parent !== group) { if (parent.userData.dynamicWall) return; parent = parent.parent; }
    const key = object.material.uuid;
    if (!batches.has(key)) batches.set(key, { material: object.material, parts: [] });
    let geometry = object.geometry.clone();
    if (geometry.index) { const flat = geometry.toNonIndexed(); geometry.dispose(); geometry = flat; }
    geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    batches.get(key).parts.push(geometry); objects.push(object);
  };
  if (recursive) group.traverse(collect); else [...group.children].forEach(collect);
  for (const { material, parts } of batches.values()) {
    const geometry = mergeGeometries(parts, false);
    if (geometry) mesh(group, geometry, material);
    parts.forEach(part => part.dispose());
  }
  objects.forEach(object => object.removeFromParent());
}
function labelTexture(text, background, color = '#fff8de', width = 512, height = 128) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.font = `900 ${height * 0.62}px Bahnschrift, Microsoft YaHei, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, width / 2, height * 0.53, width - 28);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ArenaView {
  constructor(canvas) {
    this.canvas = canvas;
    this.loadingManager = new THREE.LoadingManager();
    this.ready = new Promise((resolve, reject) => {
      this.loadingManager.onLoad = resolve;
      this.loadingManager.onError = url => reject(new Error(`场景素材加载失败：${url}`));
    });
    this.mobile = matchMedia('(pointer:coarse)').matches;
    this.baseRatio = Math.min(devicePixelRatio, this.mobile ? 1.25 : 1.5);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.baseRatio);
    this.renderer.shadowMap.enabled = !this.mobile;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#78b5b2');
    this.camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 0.1, 100);
    this.focus = new THREE.Vector3(0, 0, 0);
    this.actors = new Map(); this.shots = new Map(); this.effects = []; this.floaters = [];
    this.wallMeshes = []; this.elapsed = 0; this.shake = 0; this.snapCamera = true;
    this.pointer = new THREE.Vector2(); this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(UP, 0);
    this.scene.add(new THREE.HemisphereLight('#f5fffa', '#849e81', 1.7));
    const sun = new THREE.DirectionalLight('#fff0cc', 2.3);
    sun.position.set(-12, 24, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -27; sun.shadow.camera.right = 27;
    sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25; sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.035; sun.shadow.radius = 4; this.scene.add(sun);
    this.scene.add(new THREE.DirectionalLight('#d5f5fb', 0.7));
    this.buildMap(); this.buildAim();
    this.resize(); window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.width = innerWidth; this.height = innerHeight;
    const aspect = this.width / this.height;
    this.follow = this.mobile || aspect < 1.15;
    this.cameraHeight = this.mobile ? 34 : 27;
    this.groundProjection = this.cameraHeight / Math.hypot(this.cameraHeight, 25);
    const span = this.follow ? (aspect > 1 ? 20 : 24) : Math.max(29, (ARENA.width + 8) / aspect);
    this.camera.left = -span * aspect / 2; this.camera.right = span * aspect / 2;
    this.camera.top = span / 2; this.camera.bottom = -span / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.cameraHalfX = span * aspect / 2;
    this.cameraHalfZ = span / 2 / this.groundProjection;
    this.snapCamera = true;
  }

  quality(value) {
    this.qualityMode = value; this.resolutionScale = 1; this.frameAverage = 1 / 60; this.tuningTimer = 0; this.tuningWarmup = 3;
    this.baseRatio = Math.min(devicePixelRatio, value === 'high' ? 1.5 : 1);
    this.renderer.setPixelRatio(this.baseRatio);
    this.renderer.shadowMap.enabled = value === 'high';
    this.renderer.shadowMap.needsUpdate = true;
  }

  buildMap() {
    buildFactory(this, { material, mesh, box, sphere, batchStatic, geo });
    this.lootRoot = new THREE.Group(); this.scene.add(this.lootRoot);
    this.lootRoot.visible = false;
    this.lootCore = mesh(this.lootRoot, new THREE.OctahedronGeometry(0.37, 0), M.gold, 0, 0.95, 0);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#ffdb6b', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    mesh(this.lootRoot, new THREE.CylinderGeometry(0.28, 0.65, 3.7, 24, 1, true), beamMat, 0, 1.9, 0);
    this.lootRing = mesh(this.lootRoot, new THREE.TorusGeometry(0.72, 0.025, 8, 40), M.gold, 0, 0.08, 0); this.lootRing.rotation.x = Math.PI / 2;
  }

  mapSign(group, text, x, y, z, background, width, height, color) {
    const sign = mesh(group, new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: labelTexture(text, background, color) }), x, y, z);
    sign.rotation.x = -Math.PI / 2; sign.castShadow = false; return sign;
  }

  buildActor(player, localId) {
    const root = new THREE.Group(); this.scene.add(root);
    root.scale.setScalar(0.76);
    const legs = new THREE.Group(); root.add(legs);
    const torso = new THREE.Group(); root.add(torso);
    const teamMat = player.team === 'blue' ? M.blue : M.red;
    const points = [[0,0.62],[0.33,0.65],[0.57,0.82],[0.67,1.07],[0.65,1.38],[0.55,1.7],[0.44,1.94],[0.42,2.18],[0.3,2.36],[0,2.4]].map(([r,y]) => new THREE.Vector2(r,y));
    const body = mesh(torso, new THREE.LatheGeometry(points, 32), M.skin);
    const belly = sphere(torso, M.belly, 0, 1.12, -0.47, 0.48, 0.51, 0.21);
    const head = new THREE.Group(); head.position.y = 2.01; torso.add(head);
    for (const side of [-1, 1]) {
      sphere(head, M.eye, side * 0.25, 0.12, -0.34, 0.155, 0.165, 0.12);
      sphere(head, M.pupil, side * 0.25, 0.11, -0.436, 0.082, 0.112, 0.04);
      sphere(head, M.white, side * 0.25 - 0.025, 0.151, -0.47, 0.025, 0.033, 0.012);
    }
    const muzzle = sphere(head, M.skin, 0, -0.09, -0.42, 0.23, 0.08, 0.15);
    const mouthPoints = [new THREE.Vector3(-0.17,-0.11,-0.51),new THREE.Vector3(0,-0.12,-0.56),new THREE.Vector3(0.17,-0.11,-0.51)];
    mesh(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mouthPoints), 10, 0.012, 5, false), M.olive);
    batchStatic(head, true);
    const belt = mesh(torso, new THREE.TorusGeometry(0.59, 0.075, 8, 32), teamMat, 0, 0.87, 0.02); belt.rotation.x = Math.PI / 2; belt.scale.y = 0.88;
    box(torso, teamMat, 0, 1.43, 0.53, 0.55, 0.55, 0.25);
    box(torso, M.dark, 0, 1.43, 0.68, 0.41, 0.17, 0.08, 0.03);
    for (const side of [-1, 1]) {
      const strap = box(torso, teamMat, side * 0.36, 1.32, -0.425, 0.075, 0.68, 0.055, 0.02); strap.rotation.z = side * 0.17;
    }
    const legParts = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(side * 0.29, 0.8, 0.01); legs.add(hip);
      sphere(hip, M.skin, 0, -0.2, 0, 0.23, 0.34, 0.23);
      const knee = new THREE.Group(); knee.position.set(0, -0.4, 0); hip.add(knee);
      sphere(knee, M.skin, 0, -0.11, 0, 0.155, 0.22, 0.16);
      const foot = new THREE.Group(); foot.position.set(0, -0.24, -0.12); knee.add(foot);
      sphere(foot, M.olive, 0, 0.02, -0.03, 0.23, 0.105, 0.32);
      for (let toe = -1; toe <= 1; toe++) sphere(foot, M.olive, toe * 0.115, 0.0, -0.25 - (toe === 0 ? 0.035 : 0), 0.077, 0.085, 0.12);
      batchStatic(hip); batchStatic(foot);
      legParts.push({ hip, knee, foot });
    }
    const gun = new THREE.Group(); gun.position.set(0.15, 1.37, -0.72); torso.add(gun);
    box(gun, M.dark, 0, 0, 0.05, 0.29, 0.3, 0.55, 0.045);
    const drum = mesh(gun, new THREE.CylinderGeometry(0.205, 0.205, 0.36, 12), M.metal, 0.02, -0.11, -0.05); drum.rotation.z = Math.PI / 2;
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; const shell = mesh(gun, new THREE.CylinderGeometry(0.05, 0.05, 0.37, 8), M.gold, 0.02, -0.11 + Math.cos(a) * 0.155, -0.05 + Math.sin(a) * 0.155); shell.rotation.z = Math.PI / 2; }
    const barrel = mesh(gun, new THREE.CylinderGeometry(0.115, 0.15, 0.7, 16), M.dark, 0, 0.05, -0.5); barrel.rotation.x = Math.PI / 2;
    const rim = mesh(gun, new THREE.TorusGeometry(0.12, 0.04, 8, 16), teamMat, 0, 0.05, -0.86);
    const bore = mesh(gun, new THREE.CircleGeometry(0.092, 16), M.pupil, 0, 0.05, -0.871); bore.rotation.y = Math.PI;
    box(gun, M.olive, 0, -0.23, 0.2, 0.13, 0.28, 0.16, 0.035);
    box(gun, teamMat, 0, 0.23, -0.1, 0.08, 0.08, 0.1, 0.02);
    const muzzlePoint = new THREE.Object3D(); muzzlePoint.position.set(0, 0.05, -0.94); gun.add(muzzlePoint);
    batchStatic(gun, true);
    batchStatic(torso);
    const arms = [-1, 1].map(side => {
      const upper = mesh(torso, geo.cylinder, M.skin), lower = mesh(torso, geo.cylinder, M.skin), hand = sphere(torso, M.olive, 0, 0, 0, 0.13, 0.12, 0.145);
      return { side, upper, lower, hand, shoulder: new THREE.Vector3(side * 0.55, 1.52, -0.04), grip: new THREE.Vector3(), elbow: new THREE.Vector3() };
    });
    for (const side of [-1, 1]) sphere(torso, M.skin, side * 0.54, 1.55, -0.03, 0.2, 0.22, 0.2);
    const localRing = mesh(this.scene, new THREE.RingGeometry(0.6, 0.65, 48), new THREE.MeshBasicMaterial({ color: player.id === localId ? '#fff4b3' : player.team === 'blue' ? '#4ed9e3' : '#f58a84', side: THREE.DoubleSide, transparent: true, opacity: player.id === localId ? 1 : 0.55 }), 0, 0.025, 0); localRing.rotation.x = -Math.PI / 2;
    const shield = mesh(root, new THREE.SphereGeometry(1.0, 24, 16), new THREE.MeshBasicMaterial({ color: '#c6b6ee', transparent: true, opacity: 0.18, depthWrite: false, wireframe: true }), 0, 1.17, 0, 0.88, 1.16, 0.88); shield.visible = false;
    const label = document.createElement('div'); label.className = 'character-label';
    const name = document.createElement('span'); name.textContent = player.name + (player.id === localId ? ' · 你' : ''); label.appendChild(name);
    const bar = document.createElement('div'); bar.className = 'bar'; const fill = document.createElement('i'); bar.appendChild(fill); label.appendChild(bar);
    const shieldBar = document.createElement('i'); shieldBar.className = 'shield'; label.appendChild(shieldBar);
    document.querySelector('#labels').appendChild(label);
    root.position.set(player.x, 0, player.z);
    const actor = { root, torso, legs, head, body, gun, muzzlePoint, legParts, arms, ring: localRing, shield, label, fill, shieldBar, phase: 0, shotAt: -10, shotSkill: 1, hitAt: -10, dead: 0, heading: player.team === 'blue' ? -Math.PI / 2 : Math.PI / 2, lastHp: 100 };
    this.actors.set(player.id, actor); return actor;
  }

  buildAim() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(35 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(35), 1).setUsage(THREE.DynamicDrawUsage));
    this.aimLine = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: '#fff9c8', dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.9, depthTest: false }));
    this.aimLine.frustumCulled = false;
    this.scene.add(this.aimLine);
    this.aimRing = mesh(this.scene, new THREE.RingGeometry(0.44, 0.52, 40), new THREE.MeshBasicMaterial({ color: '#fff8c7', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }), 0, 0.06, 0); this.aimRing.rotation.x = -Math.PI / 2;
    this.aimCenter = mesh(this.scene, new THREE.CircleGeometry(0.06, 16), new THREE.MeshBasicMaterial({ color: '#fff8d4', side: THREE.DoubleSide, depthTest: false }), 0, 0.061, 0); this.aimCenter.rotation.x = -Math.PI / 2;
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 34 * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.aimRibbon = new THREE.Mesh(ribbon, new THREE.MeshBasicMaterial({ color: '#fff9b6', transparent: true, opacity: 0.82, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.aimRibbon.frustumCulled = false; this.aimRibbon.renderOrder = 8; this.scene.add(this.aimRibbon);
    this.aimOutline = new THREE.Mesh(ribbon.clone(), new THREE.MeshBasicMaterial({ color: '#246c73', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.aimOutline.frustumCulled = false; this.aimOutline.renderOrder = 7; this.scene.add(this.aimOutline);
    const cone = new THREE.BufferGeometry(); cone.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 9), 3).setUsage(THREE.DynamicDrawUsage));
    this.aimArea = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: '#46e0ec', transparent: true, opacity: 0.2, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.aimArea.frustumCulled = false; this.aimArea.renderOrder = 7; this.scene.add(this.aimArea);
    this.aimFill = mesh(this.scene, new THREE.CircleGeometry(1.9, 40), new THREE.MeshBasicMaterial({ color: '#ffca4d', transparent: true, opacity: 0.2, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.aimFill.rotation.x = -Math.PI / 2;
    this.aimBorder = mesh(this.scene, new THREE.RingGeometry(0.42, 0.55, 40), new THREE.MeshBasicMaterial({ color: '#246c73', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    this.aimBorder.rotation.x = -Math.PI / 2; this.aimBorder.renderOrder = 8; this.aimRing.renderOrder = 9; this.aimCenter.renderOrder = 10;
  }

  screenPoint(x, y) {
    this.pointer.set(x / this.width * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.plane, hit); return { x: hit.x, z: hit.z };
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15 };
  }

  reset() {
    for (const object of [this.aimLine, this.aimRing, this.aimCenter, this.aimRibbon, this.aimOutline, this.aimBorder, this.aimArea, this.aimFill]) object.visible = false;
    for (const a of this.actors.values()) { releaseTree(a.root); releaseTree(a.ring); a.label.remove(); }
    for (const shot of this.shots.values()) releaseTree(shot);
    for (const effect of this.effects) releaseTree(effect.object);
    this.effects = [];
    this.shots.clear(); this.actors.clear(); this.snapCamera = true;
    for (const f of this.floaters) f.el.remove(); this.floaters = [];
  }

  onEvent(event, snapshot, localId) {
    const actor = this.actors.get(event.player);
    if (event.type === 'shot' && actor) {
      actor.shotAt = this.elapsed; actor.shotSkill = event.skill;
      actor.shotTarget = event.target;
      const pos = new THREE.Vector3(); actor.muzzlePoint.getWorldPosition(pos);
      const size = event.skill === 1 ? 0.44 : event.skill === 3 ? 0.35 : 0.25;
      const flash = mesh(this.scene, geo.particle, new THREE.MeshBasicMaterial({ color: event.skill === 3 ? '#ffd55c' : '#ffffda', transparent: true }), pos.x, pos.y, pos.z, size, size, size);
      this.effects.push({ object: flash, age: 0, life: 0.13, type: 'flash' });
    }
    if (event.type === 'impact') {
      const color = event.hit ? '#fff6b1' : event.team === 'blue' ? '#51e1f1' : '#ff8596';
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2 + Math.random();
        const spark = mesh(this.scene, geo.particle, new THREE.MeshBasicMaterial({ color, transparent: true }), event.x, 0.62, event.z, 0.09, 0.09, 0.09);
        this.effects.push({ object: spark, age: 0, life: 0.18, type: 'particle', vx: Math.cos(angle) * 2.5, vz: Math.sin(angle) * 2.5, vy: 1.5 });
      }
    }
    if (event.type === 'blast') {
      const color = event.skill === 3 ? '#f6bd4b' : event.team === 'blue' ? '#82e6e1' : '#ff9990';
      const ring = mesh(this.scene, new THREE.RingGeometry(0.3, 0.45, 40), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }), event.x, 0.06, event.z); ring.rotation.x = -Math.PI / 2;
      this.effects.push({ object: ring, age: 0, life: 0.5, type: 'ring', range: event.skill === 3 ? 4.5 : 2.3 });
      for (let i = 0; i < (event.skill === 3 ? 15 : 8); i++) {
        const angle = i * 2.4; const speed = 1 + Math.random() * 3;
        const p = mesh(this.scene, geo.particle, new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? '#ffecd0' : color, transparent: true }), event.x, 0.25, event.z, 0.13, 0.13, 0.13);
        this.effects.push({ object: p, age: 0, life: 0.4 + Math.random() * 0.3, type: 'particle', vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed, vy: 1.4 + Math.random() * 2 });
      }
      this.shake = Math.max(this.shake, event.skill === 3 ? 0.07 : 0.025);
      const core = mesh(this.scene, geo.sphere, new THREE.MeshBasicMaterial({ color: '#fff0ac', transparent: true }), event.x, 0.45, event.z, 0.65, 0.5, 0.65);
      this.effects.push({ object: core, age: 0, life: 0.22, type: 'burst' });
    }
    if (event.type === 'damage' && actor) {
      actor.hitAt = this.elapsed;
      const el = document.createElement('span'); el.className = `floating-number${event.absorbed && !event.amount ? ' shielded' : ''}`; el.textContent = event.amount ? `−${event.amount}` : `盾 −${event.absorbed}`;
      document.querySelector('#labels').appendChild(el);
      this.floaters.push({ el, x: actor.root.position.x, z: actor.root.position.z, age: 0 });
    }
    if (event.type === 'dash') {
      for (let i = 0; i < 8; i++) {
        const t = i / 8; const object = mesh(this.scene, new THREE.TorusGeometry(0.3, 0.025, 6, 16), new THREE.MeshBasicMaterial({ color: '#e4d6ff', transparent: true }), event.from.x + (event.to.x - event.from.x) * t, 0.28, event.from.z + (event.to.z - event.from.z) * t);
        object.rotation.x = -Math.PI / 2; this.effects.push({ object, age: 0, life: 0.4, type: 'flash' });
      }
    }
    if (event.type === 'finish' && event.winner !== 'draw') {
      const local = snapshot.players.find(p => p.id === localId);
      if (local?.team === event.winner) for (let i = 0; i < 65; i++) {
        const object = mesh(this.scene, new THREE.BoxGeometry(0.12, 0.03, 0.18), new THREE.MeshBasicMaterial({ color: ['#eebc4e','#f3948f','#79c9b8','#f7f2db'][i % 4], transparent: true }), local.x + (Math.random() - 0.5) * 8, 4 + Math.random() * 4, local.z + (Math.random() - 0.5) * 6);
        this.effects.push({ object, age: 0, life: 3 + Math.random(), type: 'confetti', vx: (Math.random() - 0.5), vz: (Math.random() - 0.5), vy: -0.6 });
      }
    }
  }

  updateActor(p, actor, dt, localId, localTeam, aim) {
    actor.root.position.x = p.x;
    actor.root.position.z = p.z;
    const run = Math.min(1, Math.hypot(p.vx, p.vz) / ARENA.speed);
    actor.phase += dt * (3 + run * 10);
    const facing = p.facing || { x: p.vx, z: p.vz };
    const angle = Math.hypot(facing.x, facing.z) > 0.1 ? Math.atan2(-facing.x, -facing.z) : actor.heading;
    actor.heading += Math.atan2(Math.sin(angle - actor.heading), Math.cos(angle - actor.heading)) * (1 - Math.exp(-dt * 28));
    actor.torso.rotation.y = actor.heading;
    actor.legs.rotation.y = actor.heading;
    actor.legParts.forEach((leg, i) => {
      const phase = actor.phase + i * Math.PI;
      leg.hip.rotation.x = Math.sin(phase) * 0.65 * run;
      leg.knee.rotation.x = -Math.max(0, Math.sin(phase - 0.5)) * 0.8 * run;
      leg.foot.rotation.x = Math.sin(phase + 0.5) * 0.15 * run;
    });
    const shotTime = this.elapsed - actor.shotAt;
    const target = actor.shotTarget || (p.id === localId ? aim : p.aim);
    const weaponAngle = Math.atan2(-(target.x - p.x), -(target.z - p.z)) - actor.heading;
    const weaponTurn = Math.atan2(Math.sin(weaponAngle), Math.cos(weaponAngle));
    actor.gun.rotation.y = shotTime < 0.45 ? weaponTurn * Math.max(0, 1 - Math.max(0, shotTime - 0.2) / 0.25) : 0;
    const recoil = Math.exp(-shotTime * (actor.shotSkill === 1 ? 10 : 16)) * (actor.shotSkill === 1 ? 1.8 : 1);
    const lob = actor.shotSkill === 3 && shotTime < 0.65 ? Math.sin(Math.min(1, shotTime / 0.65) * Math.PI) : 0;
    actor.gun.rotation.x = (actor.shotSkill === 3 ? 0.85 * lob : 0.09 * recoil);
    actor.gun.position.set(0.15, 1.37 + lob * 0.1 + Math.sin(actor.phase) * run * 0.025, -0.72 + recoil * 0.17);
    actor.gun.updateMatrix();
    for (const arm of actor.arms) {
      const shoulder = arm.shoulder;
      const hand = arm.grip.set(arm.side === -1 ? -0.12 : 0.09, arm.side === -1 ? -0.1 : -0.24, arm.side === -1 ? -0.39 : 0.2).applyMatrix4(actor.gun.matrix);
      const elbow = arm.elbow.copy(shoulder).lerp(hand, 0.5);
      elbow.x += arm.side * 0.16; elbow.y -= 0.2 + lob * 0.05; elbow.z += 0.05;
      segment(arm.upper, shoulder, elbow, 0.17); segment(arm.lower, elbow, hand, 0.145); arm.hand.position.copy(hand);
    }
    actor.torso.position.y = run * Math.abs(Math.sin(actor.phase)) * 0.045 + Math.sin(this.elapsed * 2.1) * 0.012;
    actor.torso.rotation.z = Math.sin(actor.phase) * run * 0.025;
    actor.head.scale.y = Math.sin(this.elapsed * 1.11 + p.x) > 0.998 ? 0.92 : 1;
    actor.shield.visible = p.shield > 0;
    actor.shield.rotation.y += dt * 0.2;
    actor.ring.position.set(actor.root.position.x, 0.025, actor.root.position.z);
    actor.ring.visible = p.hp > 0;
    if (p.hp <= 0) {
      actor.dead = Math.min(1, actor.dead + dt * 2.5);
      actor.root.rotation.z = actor.dead * 1.35;
      actor.root.position.y = -0.08;
      actor.root.scale.setScalar(0.76 * (1 - actor.dead * 0.08));
    }
    actor.label.classList.toggle('enemy', p.team !== localTeam);
    actor.label.classList.toggle('local', p.id === localId);
    const screen = this.project(actor.root.position.x, 2.12, actor.root.position.z);
    actor.label.style.transform = `translate3d(${screen.x}px,${screen.y}px,0) translate(-50%,-100%)`;
    actor.label.style.display = p.hp > 0 && screen.visible ? '' : 'none';
    actor.fill.style.width = `${p.hp}%`; actor.shieldBar.style.width = `${p.shield}%`;
  }

  render(snapshot, localId, dt, aim, skill = 1, guide = true) {
    this.elapsed += dt;
    if (this.qualityMode === 'standard' && !document.hidden) {
      this.tuningWarmup -= dt;
      this.frameAverage += (dt - this.frameAverage) * 0.04;
      if (this.tuningWarmup <= 0) this.tuningTimer += dt;
      // Only the 3D canvas changes resolution; HUD text and touch targets stay native-sharp.
      if (this.tuningTimer > 2) {
        if (this.frameAverage > 0.0175 && this.resolutionScale > 0.77) {
          this.resolutionScale = Math.max(0.76, this.resolutionScale - 0.08);
          this.renderer.setPixelRatio(this.baseRatio * this.resolutionScale);
        }
        this.tuningTimer = 0; this.frameAverage = 1 / 60;
      }
    }
    const local = snapshot?.players.find(p => p.id === localId);
    if (local && this.follow) {
      const target = local.hp > 0 ? local : snapshot.players.find(p => p.team === local.team && p.hp > 0) || local;
      const maxX = Math.max(0, BOUNDS.x + 1.8 - this.cameraHalfX);
      const maxZ = Math.max(0, BOUNDS.z + 1.8 - this.cameraHalfZ);
      const desired = new THREE.Vector3(THREE.MathUtils.clamp(target.x, -maxX, maxX), 0, THREE.MathUtils.clamp(target.z, -maxZ, maxZ));
      if (this.mobile) {
        // Keep the local character between the two thumb-control regions.
        const left = Math.min(this.width * 0.38, this.width < 700 ? 205 : 250);
        const right = this.width - Math.min(this.width * 0.47, this.width < 700 ? 270 : 304);
        const unitsPerPixel = this.cameraHalfX * 2 / this.width;
        desired.x = THREE.MathUtils.clamp(desired.x, target.x - (right - this.width / 2) * unitsPerPixel, target.x - (left - this.width / 2) * unitsPerPixel);
      }
      this.focus.lerp(desired, this.snapCamera ? 1 : Math.min(1, dt * 7));
    } else this.focus.set(0, 0, 0);
    this.snapCamera = false;
    this.shake *= Math.exp(-dt * 12);
    this.camera.position.copy(this.focus).add(new THREE.Vector3(Math.sin(this.elapsed * 80) * this.shake, this.cameraHeight, 25));
    this.camera.lookAt(this.focus.x, 0, this.focus.z - (this.follow ? 0.5 : 0.5));
    this.camera.updateMatrixWorld();
    if (snapshot) {
      for (const p of snapshot.players) {
        const actor = this.actors.get(p.id) || this.buildActor(p, localId);
        this.updateActor(p, actor, dt, localId, local?.team, aim);
      }
      const shotIds = new Set(snapshot.projectiles.map(q => q.id));
      for (const [id, shot] of this.shots) if (!shotIds.has(id)) { releaseTree(shot); this.shots.delete(id); }
      for (const q of snapshot.projectiles) {
        let shot = this.shots.get(q.id);
        if (!shot) {
          shot = new THREE.Group(); this.scene.add(shot);
          if (q.skill === 3) {
            sphere(shot, M.grenade, 0, 0, 0, q.powered ? 0.27 : 0.21);
            sphere(shot, M.bullet, 0, 0.05, -0.05, 0.12);
            const band = mesh(shot, new THREE.TorusGeometry(0.29, 0.035, 6, 16), M.grenade); band.rotation.x = Math.PI / 2;
            for (let i = 1; i <= 3; i++) sphere(shot, M.grenade, 0, -i * 0.05, -i * 0.21, 0.15 / i);
          } else {
            sphere(shot, q.team === 'blue' ? M.tracerBlue : M.tracerRed, 0, 0, -0.3, 0.12, 0.12, 0.65);
            sphere(shot, M.bullet, 0, 0.01, -0.08, 0.065, 0.065, 0.4);
          }
          shot.traverse(object => { object.castShadow = false; object.receiveShadow = false; });
          shot.position.set(q.x, q.y, q.z); this.shots.set(q.id, shot);
        }
        shot.position.set(q.x, q.y, q.z); shot.rotation.y = Math.atan2(q.dir?.x || 0, q.dir?.z || 1);
      }
      this.lootRoot.visible = !!snapshot.loot;
      if (snapshot.loot) {
        this.lootCore.rotation.y = this.elapsed * 1.9; this.lootCore.rotation.z = this.elapsed * 0.5;
        this.lootCore.position.y = 1.05 + Math.sin(this.elapsed * 3) * 0.15;
        this.lootCore.material = snapshot.loot.type === 'mega' ? M.gold : snapshot.loot.type === 'freeze' ? M.blue : M.purple;
      }
    }
    const aimVisible = !!local && local.hp > 0 && guide && snapshot.state === 'playing' && skill !== 2;
    this.aimLine.visible = this.aimRing.visible = this.aimCenter.visible = this.aimRibbon.visible = this.aimOutline.visible = this.aimBorder.visible = aimVisible;
    this.aimArea.visible = aimVisible && skill === 1; this.aimFill.visible = aimVisible && skill === 3;
    if (aimVisible) {
      const dx = (skill === 3 ? THREE.MathUtils.clamp(aim.x, -BOUNDS.x, BOUNDS.x) : aim.x) - local.x, dz = (skill === 3 ? THREE.MathUtils.clamp(aim.z, -BOUNDS.z, BOUNDS.z) : aim.z) - local.z;
      const distance = Math.max(0.01, Math.hypot(dx, dz)); const range = skill === 3 ? Math.min(SKILLS[skill].range, distance) : SKILLS[skill].range;
      const tx = local.x + dx / distance * range, tz = local.z + dz / distance * range;
      const count = skill === 3 ? 35 : 2;
      const positions = this.aimLine.geometry.attributes.position, distances = this.aimLine.geometry.attributes.lineDistance;
      let lineDistance = 0, px = 0, py = 0, pz = 0;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const x = local.x + (tx - local.x) * t, y = skill === 3 ? 1.1 * (1 - t) + 3.4 * 4 * t * (1 - t) : 0.08, z = local.z + (tz - local.z) * t;
        if (i) lineDistance += Math.hypot(x - px, y - py, z - pz);
        positions.setXYZ(i, x, y, z); distances.setX(i, lineDistance); px = x; py = y; pz = z;
      }
      positions.needsUpdate = true; distances.needsUpdate = true;
      this.aimLine.geometry.setDrawRange(0, count);
      this.aimRing.position.set(tx, 0.065, tz); this.aimCenter.position.set(tx, 0.07, tz); this.aimRing.scale.setScalar(skill === 3 ? 3.65 : 1);
      this.aimBorder.position.copy(this.aimRing.position); this.aimBorder.scale.copy(this.aimRing.scale);
      this.aimLine.material.color.set(skill === 3 ? '#ffdf78' : '#f5ffdf'); this.aimRing.material.color.copy(this.aimLine.material.color);
      this.aimRibbon.material.color.copy(this.aimLine.material.color); this.aimFill.position.set(tx, 0.05, tz);
      const ribbon = this.aimRibbon.geometry.attributes.position, outline = this.aimOutline.geometry.attributes.position, area = this.aimArea.geometry.attributes.position;
      let vertex = 0;
      const rays = skill === 1 ? 5 : 1;
      for (let ray = 0; ray < rays; ray++) {
        const angle = (ray / 4 - 0.5) * SKILLS[1].spread * (skill === 1 ? 1 : 0);
        const ux = dx / distance * Math.cos(angle) - dz / distance * Math.sin(angle), uz = dx / distance * Math.sin(angle) + dz / distance * Math.cos(angle);
        const half = skill === 3 ? 0.07 : 0.06, sx = -uz * half, sz = ux * half;
        for (let step = 0; step < count - 1; step++) {
          const a = step / (count - 1), b = (step + 1) / (count - 1);
          const ay = skill === 3 ? 1.1 * (1 - a) + 13.6 * a * (1 - a) : 0.08;
          const by = skill === 3 ? 1.1 * (1 - b) + 13.6 * b * (1 - b) : 0.08;
          const ax = local.x + ux * range * a, az = local.z + uz * range * a, bx = local.x + ux * range * b, bz = local.z + uz * range * b;
          ribbon.setXYZ(vertex++, ax - sx, ay, az - sz); ribbon.setXYZ(vertex++, ax + sx, ay, az + sz); ribbon.setXYZ(vertex++, bx + sx, by, bz + sz);
          ribbon.setXYZ(vertex++, ax - sx, ay, az - sz); ribbon.setXYZ(vertex++, bx + sx, by, bz + sz); ribbon.setXYZ(vertex++, bx - sx, by, bz - sz);
          const edge = half + 0.055, ox = -uz * edge, oz = ux * edge, start = vertex - 6;
          outline.setXYZ(start, ax - ox, ay, az - oz); outline.setXYZ(start + 1, ax + ox, ay, az + oz); outline.setXYZ(start + 2, bx + ox, by, bz + oz);
          outline.setXYZ(start + 3, ax - ox, ay, az - oz); outline.setXYZ(start + 4, bx + ox, by, bz + oz); outline.setXYZ(start + 5, bx - ox, by, bz - oz);
        }
        if (skill === 1 && ray < 4) {
          const next = angle + SKILLS[1].spread / 4, nx = dx / distance * Math.cos(next) - dz / distance * Math.sin(next), nz = dx / distance * Math.sin(next) + dz / distance * Math.cos(next);
          area.setXYZ(ray * 3, local.x, 0.07, local.z); area.setXYZ(ray * 3 + 1, local.x + ux * range, 0.07, local.z + uz * range); area.setXYZ(ray * 3 + 2, local.x + nx * range, 0.07, local.z + nz * range);
        }
      }
      ribbon.needsUpdate = true; outline.needsUpdate = true; area.needsUpdate = true; this.aimRibbon.geometry.setDrawRange(0, vertex); this.aimOutline.geometry.setDrawRange(0, vertex);
    }
    this.effects = this.effects.filter(e => {
      e.age += dt; const t = e.age / e.life;
      if (t >= 1) { releaseTree(e.object); return false; }
      e.object.material.opacity = 1 - t;
      if (e.type === 'ring') e.object.scale.setScalar(1 + t * e.range);
      if (e.type === 'burst') e.object.scale.setScalar(0.65 + t * 1.8);
      if (e.type === 'particle' || e.type === 'confetti') {
        e.object.position.x += e.vx * dt; e.object.position.z += e.vz * dt; e.object.position.y += e.vy * dt;
        e.vy -= dt * (e.type === 'confetti' ? 0.5 : 8);
        e.object.rotation.x += dt * 4; e.object.rotation.z += dt * 3;
        if (e.object.position.y < 0.06) e.object.position.y = 0.06;
      }
      return true;
    });
    this.floaters = this.floaters.filter(f => {
      f.age += dt;
      if (f.age > 0.9) { f.el.remove(); return false; }
      const screen = this.project(f.x, 2 + f.age * 1.7, f.z);
      f.el.style.left = `${screen.x}px`; f.el.style.top = `${screen.y}px`; f.el.style.opacity = `${Math.min(1, (0.9 - f.age) * 3)}`; return true;
    });
    this.occlusionTimer = (this.occlusionTimer || 0) + dt;
    if (snapshot && this.occlusionTimer > 0.12) {
      this.occlusionTimer = 0;
      for (const wall of this.wallMeshes) wall.userData.targetOpacity = 1;
      for (const p of snapshot.players) {
        if (p.hp <= 0) continue;
        const target = new THREE.Vector3(p.x, 0.9, p.z);
        const direction = target.clone().sub(this.camera.position);
        this.raycaster.set(this.camera.position, direction.clone().normalize());
        this.raycaster.far = direction.length();
        for (const hit of this.raycaster.intersectObjects(this.wallMeshes, true)) {
          let wall = hit.object;
          while (wall.parent && !this.wallMeshes.includes(wall)) wall = wall.parent;
          if (this.wallMeshes.includes(wall)) wall.userData.targetOpacity = 0.35;
        }
      }
      this.raycaster.far = Infinity;
    }
    for (const wall of this.wallMeshes) {
      wall.userData.fade = THREE.MathUtils.lerp(wall.userData.fade, wall.userData.targetOpacity, Math.min(1, dt * 10));
      wall.traverse(object => { if (object.isMesh) object.material.opacity = wall.userData.fade; });
    }
    this.renderer.render(this.scene, this.camera);
  }
}
