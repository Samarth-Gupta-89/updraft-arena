// Builds the visible world, tuned for speed: one floating arena under a cheap gradient sky.
// Static objects are merged into a handful of meshes so the GPU gets few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as M from './shared/map.js';
import * as TX from './textures.js';

const { ARENA, WATER_LEVEL, POND } = M;
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// Box whose UVs tile every `tile` metres instead of stretching one texture over each face.
function tiledBox(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
    }
  }
  return g;
}

function merged(geos, mat) {
  return new THREE.Mesh(mergeGeometries(geos), mat);
}

function withColor(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

export function buildWorld(renderer, scene) {
  const colliders = M.buildColliders();
  const updaters = [];
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 40), THREE.MathUtils.degToRad(145));

  // ---------------------------------------------------------------- sky + light
  scene.add(buildSky(sunDir));
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x6e6a4c, 1.0));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
  sun.position.copy(sunDir).multiplyScalar(120); // no shadows: they were the biggest GPU cost
  scene.add(sun, sun.target);

  // ---------------------------------------------------------------- terrain
  {
    const X = ARENA.halfX, Z = ARENA.halfZ;
    const g = new THREE.PlaneGeometry(X * 2, Z * 2, 126, 96);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const C = {
      grassA: new THREE.Color(0x4f7030), grassB: new THREE.Color(0x7f9a47), dry: new THREE.Color(0xa0965c),
      dirt: new THREE.Color(0x7d6646), sand: new THREE.Color(0xa38f66), mud: new THREE.Color(0x4c4433), gravel: new THREE.Color(0x7f7970),
    };
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = M.heightAt(x, z);
      pos.setY(i, y);
      col.copy(C.grassA).lerp(C.grassB, M.fbm(x * 0.05 + 100, z * 0.05, 4, 21));
      const n2 = M.fbm(x * 0.09, z * 0.09 + 50, 3, 22);
      if (n2 > 0.58) col.lerp(C.dry, Math.min(1, (n2 - 0.58) * 3));
      const n3 = M.fbm(x * 0.15, z * 0.15, 3, 23);
      if (n3 > 0.64) col.lerp(C.dirt, Math.min(1, (n3 - 0.64) * 4));
      if (y < WATER_LEVEL + 0.45) col.lerp(C.sand, smooth((WATER_LEVEL + 0.45 - y) / 0.5));
      if (y < WATER_LEVEL - 0.2) col.lerp(C.mud, smooth((WATER_LEVEL - 0.2 - y) / 0.8));
      const edge = Math.min(X - Math.abs(x), Z - Math.abs(z));
      if (edge < 1.6) col.lerp(C.gravel, 1 - edge / 1.6);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: TX.terrainDetail() });
    mat.color.setScalar(1.45);
    scene.add(new THREE.Mesh(g, mat));
  }

  // ---------------------------------------------------------------- pond
  {
    const wn = TX.waterNormal();
    const mat = new THREE.MeshPhongMaterial({
      color: 0x24606c, specular: 0xbfd8e6, shininess: 90, normalMap: wn, normalScale: new THREE.Vector2(0.5, 0.5),
      transparent: true, opacity: 0.82,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(POND.rx * 2 + 4, POND.rz * 2 + 4), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(POND.x, WATER_LEVEL, POND.z);
    scene.add(water);
    updaters.push((t) => wn.offset.set(t * 0.011, t * 0.019));
  }

  // ---------------------------------------------------------------- platform, walls, hazard caps
  const concTex = TX.concrete();
  {
    const T = ARENA.wallT, X = ARENA.halfX + T, Z = ARENA.halfZ + T;
    const walls = [], caps = [];
    for (const c of colliders) {
      if (c.type !== 'wall') continue;
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      const top = c.maxY, bottom = -3;
      const g = tiledBox(w, top - bottom, d, 4);
      g.translate((c.minX + c.maxX) / 2, (top + bottom) / 2, (c.minZ + c.maxZ) / 2);
      walls.push(g);
      const cg = tiledBox(w + 0.04, 0.32, d + 0.04, 1.6);
      cg.translate((c.minX + c.maxX) / 2, top - 0.15, (c.minZ + c.maxZ) / 2);
      caps.push(cg);
    }
    scene.add(merged(walls, new THREE.MeshLambertMaterial({ map: concTex, color: 0xe2ded6 })));
    scene.add(merged(caps, new THREE.MeshLambertMaterial({ map: TX.hazard() })));
    // the slab the arena sits on (seen when falling out)
    const slab = tiledBox(X * 2, 3, Z * 2, 6);
    slab.translate(0, -4.45, 0);
    scene.add(merged([slab], new THREE.MeshLambertMaterial({ map: concTex, color: 0x8a8780 })));
  }

  // ---------------------------------------------------------------- cover (merged per material)
  {
    const crates = [], conts = [], posts = [], barriers = [], rocks = [], trunks = [], leaves = [], blocks = [];
    const CONT_COLORS = [0x9b3b2b, 0x2f5f8f, 0x3f7350, 0xb98a35];
    let rockSeed = 1;
    for (const c of colliders) {
      const ref = c.ref;
      if (!ref) continue;
      const { x, z } = ref;
      if (ref.type === 'crate') {
        crates.push(new THREE.BoxGeometry(ref.w, ref.h, ref.d).translate(x, c.base + ref.h / 2, z));
      } else if (ref.type === 'container') {
        conts.push(withColor(new THREE.BoxGeometry(ref.w, ref.h, ref.d), CONT_COLORS[ref.color % 4]).translate(x, c.base + ref.h / 2, z));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          posts.push(new THREE.BoxGeometry(0.16, ref.h + 0.02, 0.16).translate(x + sx * (ref.w / 2 - 0.07), c.base + ref.h / 2, z + sz * (ref.d / 2 - 0.07)));
        }
      } else if (ref.type === 'barrier') {
        const s = new THREE.Shape();
        const W = 0.35, Hh = ref.h;
        s.moveTo(-W, 0); s.lineTo(W, 0); s.lineTo(W, 0.08); s.lineTo(0.17, 0.3); s.lineTo(0.11, Hh);
        s.lineTo(-0.11, Hh); s.lineTo(-0.17, 0.3); s.lineTo(-W, 0.08); s.closePath();
        const len = Math.max(ref.w, ref.d);
        const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
        g.translate(0, 0, -len / 2);
        if (ref.w > ref.d) g.rotateY(Math.PI / 2);
        g.translate(x, c.base - 0.02, z);
        barriers.push(g);
      } else if (ref.type === 'block') {
        // room / hiding wall: starts 1 m under the ground so it never floats above a dip
        blocks.push(tiledBox(ref.w, ref.h + 1, ref.d, 2.5).translate(x, c.base + (ref.h - 1) / 2, z));
      } else if (ref.type === 'rock') {
        rocks.push(rockGeometry(ref.w, ref.h, ref.d, rockSeed++).translate(x, c.base, z));
      } else if (ref.type === 'tree') {
        trunks.push(new THREE.CylinderGeometry(0.17, 0.3, 9, 7).translate(x, c.base + 4.5, z));
        for (let i = 0; i < 4; i++) {
          const t = i / 3;
          leaves.push(new THREE.ConeGeometry(2.5 - t * 1.6, 3.2 - t * 0.6, 8).translate(x, c.base + 3.4 + t * 5.8, z));
        }
      }
    }
    const barTex = concTex.clone();
    barTex.repeat.set(0.5, 0.5);
    barTex.needsUpdate = true;
    scene.add(merged(crates, new THREE.MeshLambertMaterial({ map: TX.crate() })));
    scene.add(merged(conts, new THREE.MeshLambertMaterial({ map: TX.container(1), vertexColors: true })));
    scene.add(merged(posts, new THREE.MeshLambertMaterial({ color: 0x2a2a2a })));
    scene.add(merged(barriers, new THREE.MeshLambertMaterial({ map: barTex, color: 0xe8e4dc })));
    scene.add(merged(rocks, new THREE.MeshLambertMaterial({ map: TX.rock(), color: 0xcfc6b8 })));
    scene.add(merged(blocks, new THREE.MeshLambertMaterial({ map: concTex, color: 0xd9a877 })));
    scene.add(merged(trunks, new THREE.MeshLambertMaterial({ map: TX.bark() })));
    scene.add(merged(leaves, new THREE.MeshLambertMaterial({ color: 0x35582f, flatShading: true })));
  }

  const pickups = new PickupVisuals(scene);

  return {
    colliders, sunDir, pickups, sun,
    update(t) {
      for (const u of updaters) u(t);
      pickups.update(t);
    },
  };
}

// ==================================================================== helpers

function buildSky(sunDir) {
  const grp = new THREE.Group();
  const R = 900;
  const g = new THREE.SphereGeometry(R, 32, 16);
  const pos = g.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x3b74bd), hor = new THREE.Color(0xd5e4f1), bot = new THREE.Color(0x92b2d0), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / R;
    if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.55));
    else c.copy(hor).lerp(bot, Math.min(1, -y * 2.5));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
  sky.renderOrder = 5; // drawn after the arena, so only the pixels that actually show sky are filled
  grp.add(sky);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow(), color: 0xfff4dc, depthWrite: false, fog: false, toneMapped: false, transparent: true }));
  sunSprite.position.copy(sunDir).multiplyScalar(R * 0.9);
  sunSprite.scale.setScalar(110);
  grp.add(sunSprite);
  return grp;
}

function rockGeometry(w, h, d, seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = M.noise2(v.x * 1.6 + v.y * 2.1 + seed * 7, v.z * 1.6 - v.y * 1.3, seed) * 0.5
      + M.noise2(v.x * 4 + seed, v.z * 4 + v.y * 3, seed + 3) * 0.15;
    v.multiplyScalar(0.8 + n * 0.5);
    const yy = v.y < 0 ? v.y * 0.35 : v.y;
    p.setXYZ(i, v.x * w / 2, yy * h * 0.95, v.z * d / 2);
  }
  g.computeVertexNormals();
  return g;
}

// ==================================================================== pickups

const PICKUP_HEX = { L: 0x5ff3ff, P: 0xffb02e, D: 0x7dff6a };
const PICKUP_CSS = { L: '#5ff3ff', P: '#ffb02e', D: '#7dff6a' };

function arrowIcon(type) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = PICKUP_CSS[type];
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 4;
  g.beginPath();
  if (type === 'D') { g.moveTo(6, 10); g.lineTo(30, 32); g.lineTo(6, 54); g.lineTo(20, 54); g.lineTo(44, 32); g.lineTo(20, 10); g.closePath(); g.stroke(); g.fill(); g.beginPath(); g.moveTo(28, 10); g.lineTo(52, 32); g.lineTo(28, 54); g.lineTo(40, 54); g.lineTo(62, 32); g.lineTo(40, 10); }
  else if (type === 'L') { g.moveTo(32, 6); g.lineTo(56, 34); g.lineTo(42, 34); g.lineTo(42, 58); g.lineTo(22, 58); g.lineTo(22, 34); g.lineTo(8, 34); }
  else { g.moveTo(58, 32); g.lineTo(30, 8); g.lineTo(30, 22); g.lineTo(6, 22); g.lineTo(6, 42); g.lineTo(30, 42); g.lineTo(30, 56); }
  g.closePath();
  g.stroke();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class PickupVisuals {
  constructor(scene) {
    this.items = new Map();
    const ringG = new THREE.TorusGeometry(0.62, 0.05, 6, 32);
    ringG.rotateX(Math.PI / 2);
    const canG = new THREE.CylinderGeometry(0.18, 0.18, 0.5, 12);
    const canMat = {
      L: new THREE.MeshBasicMaterial({ color: PICKUP_HEX.L, toneMapped: false }),
      P: new THREE.MeshBasicMaterial({ color: PICKUP_HEX.P, toneMapped: false }),
      D: new THREE.MeshBasicMaterial({ color: PICKUP_HEX.D, toneMapped: false }),
    };
    const icons = { L: arrowIcon('L'), P: arrowIcon('P'), D: arrowIcon('D') };
    for (const p of M.PICKUPS) {
      const g = new THREE.Group();
      g.position.set(p.x, M.heightAt(p.x, p.z), p.z);
      const ringMat = new THREE.MeshBasicMaterial({ color: PICKUP_HEX[p.type], toneMapped: false });
      const ring = new THREE.Mesh(ringG, ringMat);
      ring.position.y = 0.08;
      g.add(ring);
      const can = new THREE.Group();
      can.add(new THREE.Mesh(canG, canMat[p.type]));
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: icons[p.type], transparent: true, depthWrite: false }));
      icon.scale.setScalar(p.type === 'D' ? 0.7 : 0.4);
      icon.position.y = 0.6;
      can.add(icon);
      can.position.y = 0.9;
      g.add(can);
      scene.add(g);
      this.items.set(p.id, { ...p, group: g, can, ringMat, active: true, phase: p.id * 1.7 });
    }
  }
  setActive(id, a) {
    const it = this.items.get(id);
    if (!it) return;
    it.active = a;
    it.can.visible = a;
    it.ringMat.color.set(a ? PICKUP_HEX[it.type] : 0x333333);
  }
  setAll(list) { for (const p of list) this.setActive(p.id, p.active); }
  update(t) {
    for (const it of this.items.values()) {
      if (!it.active) continue;
      it.can.rotation.y = t * 1.6 + it.phase;
      it.can.position.y = 0.9 + Math.sin(t * 2.2 + it.phase) * 0.08;
    }
  }
}
