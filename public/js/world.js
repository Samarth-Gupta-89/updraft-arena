// Builds the visible world, tuned for speed: one floating arena under a cheap gradient sky.
// Static objects are merged into a handful of meshes so the GPU gets few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as M from './shared/map.js';
import * as TX from './textures.js';

const { ARENA, WATER_LEVEL } = M;
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

// one mesh from many shapes (made un-indexed first, so any mix of shapes can be merged)
function merged(geos, mat) {
  if (!geos.length) return new THREE.Group();
  return new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
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

  // ---------------------------------------------------------------- terrain (a grid stretched over the four-sided yard)
  {
    const [A, B, Cc, D] = ARENA.poly;
    const NU = 132, NV = 92;
    const posArr = new Float32Array((NU + 1) * (NV + 1) * 3), uvArr = new Float32Array((NU + 1) * (NV + 1) * 2);
    const colors = new Float32Array((NU + 1) * (NV + 1) * 3);
    const C = {
      paveA: new THREE.Color(0xa6977a), paveB: new THREE.Color(0xbcab86), grass: new THREE.Color(0x58762f),
      dirt: new THREE.Color(0x7d6646), sand: new THREE.Color(0xa38f66), mud: new THREE.Color(0x4c4433), gravel: new THREE.Color(0x7f7970),
    };
    const col = new THREE.Color();
    let i = 0;
    for (let iv = 0; iv <= NV; iv++) {
      for (let iu = 0; iu <= NU; iu++, i++) {
        const u = iu / NU, v = iv / NV;
        const x = (1 - u) * (1 - v) * A[0] + u * (1 - v) * B[0] + u * v * Cc[0] + (1 - u) * v * D[0];
        const z = (1 - u) * (1 - v) * A[1] + u * (1 - v) * B[1] + u * v * Cc[1] + (1 - u) * v * D[1];
        const y = M.groundAt(x, z);
        posArr[i * 3] = x; posArr[i * 3 + 1] = y; posArr[i * 3 + 2] = z;
        uvArr[i * 2] = x / 104; uvArr[i * 2 + 1] = z / 80;
        // sandy paved yard with a few green patches
        col.copy(C.paveA).lerp(C.paveB, M.fbm(x * 0.05 + 100, z * 0.05, 4, 21));
        const n2 = M.fbm(x * 0.07, z * 0.07 + 50, 3, 22);
        if (n2 > 0.64) col.lerp(C.grass, Math.min(1, (n2 - 0.64) * 5));
        const n3 = M.fbm(x * 0.15, z * 0.15, 3, 23);
        if (n3 > 0.66) col.lerp(C.dirt, Math.min(1, (n3 - 0.66) * 4));
        if (y < WATER_LEVEL + 0.45) col.lerp(C.sand, smooth((WATER_LEVEL + 0.45 - y) / 0.5));
        if (y < WATER_LEVEL - 0.2) col.lerp(C.mud, smooth((WATER_LEVEL - 0.2 - y) / 0.8));
        const edge = M.edgeDist(x, z);
        if (edge < 1.6) col.lerp(C.gravel, 1 - edge / 1.6);
        colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
      }
    }
    const idx = [];
    for (let iv = 0; iv < NV; iv++) {
      for (let iu = 0; iu < NU; iu++) {
        const a = iv * (NU + 1) + iu, b = a + 1, c = a + NU + 1, d = c + 1;
        idx.push(a, c, b, b, c, d); // faces point up
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: TX.terrainDetail() });
    mat.color.setScalar(1.45);
    scene.add(new THREE.Mesh(g, mat));
  }

  // ---------------------------------------------------------------- ponds (one sheet of water under both, the ground hides the rest)
  {
    const wn = TX.waterNormal();
    const mat = new THREE.MeshPhongMaterial({
      color: 0x24606c, specular: 0xbfd8e6, shininess: 90, normalMap: wn, normalScale: new THREE.Vector2(0.5, 0.5),
      transparent: true, opacity: 0.82,
    });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const k of M.PONDS) { x0 = Math.min(x0, k.x - k.rx); x1 = Math.max(x1, k.x + k.rx); z0 = Math.min(z0, k.z - k.rz); z1 = Math.max(z1, k.z + k.rz); }
    const water = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 4, z1 - z0 + 4), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((x0 + x1) / 2, WATER_LEVEL, (z0 + z1) / 2);
    scene.add(water);
    updaters.push((t) => wn.offset.set(t * 0.011, t * 0.019));
  }

  // ---------------------------------------------------------------- arched stone bridge over the channel
  {
    const { x: bx, z: bz, halfLen: L, halfW: W, rise } = M.BRIDGE;
    const open = 4.2; // half-width of the arch the water runs through
    const side = new THREE.Shape();
    side.moveTo(-L, -1.5);
    for (let k = 0; k <= 24; k++) { const dx = -L + (2 * L * k) / 24; side.lineTo(dx, M.bridgeArch(dx)); }
    side.lineTo(L, -1.5); side.lineTo(open, -1.5);
    for (let k = 0; k <= 16; k++) { const dx = open - (2 * open * k) / 16; side.lineTo(dx, -0.75 + (rise - 0.35 + 0.75) * Math.cos((dx / open) * Math.PI / 2)); }
    side.lineTo(-open, -1.5); side.closePath();
    const deck = new THREE.ExtrudeGeometry(side, { depth: W * 2, bevelEnabled: false }).translate(bx, 0, bz - W);
    const rail = new THREE.Shape();
    for (let k = 0; k <= 24; k++) { const dx = -L + (2 * L * k) / 24; if (k) rail.lineTo(dx, M.bridgeArch(dx) - 0.05); else rail.moveTo(dx, M.bridgeArch(dx) - 0.05); }
    for (let k = 24; k >= 0; k--) { const dx = -L + (2 * L * k) / 24; rail.lineTo(dx, M.bridgeArch(dx) + 0.45); }
    rail.closePath();
    const rails = [-1, 1].map((s) => new THREE.ExtrudeGeometry(rail, { depth: 0.22, bevelEnabled: false }).translate(bx, 0, bz + s * (W + 0.11) - 0.11));
    scene.add(merged([deck, ...rails], new THREE.MeshLambertMaterial({ color: 0xe6dcc6 })));
  }

  // ---------------------------------------------------------------- boundary wall along the outline, hazard caps, slab
  const concTex = TX.concrete();
  {
    const T = ARENA.wallT, top = ARENA.wallH, bottom = -3;
    const walls = [], caps = [];
    for (const e of M.EDGES) {
      const ang = Math.atan2(-e.tz, e.tx);
      const mx = (e.ax + e.bx) / 2 - e.nx * T / 2, mz = (e.az + e.bz) / 2 - e.nz * T / 2;
      walls.push(tiledBox(e.len + T * 2.4, top - bottom, T, 4).rotateY(ang).translate(mx, (top + bottom) / 2, mz));
      caps.push(tiledBox(e.len + T * 2.4, 0.32, T + 0.04, 1.6).rotateY(ang).translate(mx, top - 0.15, mz));
    }
    scene.add(merged(walls, new THREE.MeshLambertMaterial({ map: concTex, color: 0xe2ded6 })));
    scene.add(merged(caps, new THREE.MeshLambertMaterial({ map: TX.hazard() })));
    // the slab the arena sits on (seen when falling out)
    const shape = new THREE.Shape();
    ARENA.poly.forEach(([x, z], k) => { const px = x * 1.03, pz = z * 1.03; if (k) shape.lineTo(px, pz); else shape.moveTo(px, pz); });
    shape.closePath();
    const slab = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, -2.95, 0);
    scene.add(new THREE.Mesh(slab, new THREE.MeshLambertMaterial({ color: 0x8a8780 })));
  }

  // ---------------------------------------------------------------- cover (merged per material)
  {
    const crates = [], conts = [], posts = [], barriers = [], rocks = [], trunks = [], leaves = [], blocks = [], stones = [];
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
      } else if (ref.type === 'stone') {
        stones.push(tiledBox(ref.w, ref.h + 1, ref.d, 2.5).translate(x, c.base + (ref.h - 1) / 2, z));
      } else if (ref.type === 'nandi') {
        const n = nandiGeometry();
        const nx = M.NANDI.x, nz = M.NANDI.z;
        scene.add(new THREE.Mesh(n.body.translate(nx, c.base, nz), new THREE.MeshPhongMaterial({ color: 0x1d1d21, specular: 0x55504a, shininess: 28 })));
        scene.add(new THREE.Mesh(n.gold.translate(nx, c.base, nz), new THREE.MeshLambertMaterial({ color: 0xc9a13c })));
      } else if (ref.type === 'rock') {
        rocks.push(rockGeometry(ref.w, ref.h, ref.d, rockSeed++).translate(x, c.base, z));
      } else if (ref.type === 'tree') {
        // coconut palm: thin trunk, drooping fronds at the top
        trunks.push(new THREE.CylinderGeometry(0.16, 0.28, 8, 7).translate(x, c.base + 4, z));
        for (let i = 0; i < 8; i++) {
          const frond = new THREE.ConeGeometry(0.55, 3.6, 4).scale(1, 1, 0.22).rotateZ(-(Math.PI / 2 + 0.3 + (i % 2) * 0.25)).translate(1.6, -0.45 - (i % 2) * 0.35, 0);
          leaves.push(frond.rotateY((i / 8) * Math.PI * 2 + x).translate(x, c.base + 8.1, z));
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
    const blockMat = new THREE.MeshLambertMaterial({ map: concTex, color: 0xe6d3ab });
    blockMat.color.multiplyScalar(1.5); // pale sandstone: brighter than the texture alone
    scene.add(merged(blocks, blockMat));
    scene.add(merged(stones, new THREE.MeshLambertMaterial({ map: concTex, color: 0x9a968e })));
    scene.add(merged(trunks, new THREE.MeshLambertMaterial({ map: TX.bark() })));
    scene.add(merged(leaves, new THREE.MeshLambertMaterial({ color: 0x4a7a30, flatShading: true, side: THREE.DoubleSide })));
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

// The Nandi: a big black reclining bull facing -x, built from stretched spheres. Origin = middle of its base.
function nandiGeometry() {
  const part = (sx, sy, sz, x, y, z, rz = 0) => new THREE.SphereGeometry(1, 16, 12).scale(sx, sy, sz).rotateZ(rz).translate(x, y, z);
  const body = [
    part(3.3, 1.45, 1.6, 0.3, 1.4, 0),            // body
    part(0.95, 0.85, 0.85, -1.6, 2.75, 0),        // hump
    part(1.0, 1.35, 0.9, -2.55, 2.3, 0, 0.35),    // neck
    part(0.85, 0.7, 0.62, -3.3, 3.05, 0, -0.3),   // head
    part(0.6, 0.45, 0.46, -3.95, 2.72, 0, -0.3),  // snout
    part(1.3, 1.1, 0.55, 2.0, 1.0, 1.3), part(1.3, 1.1, 0.55, 2.0, 1.0, -1.3),         // haunches
    part(1.15, 0.3, 0.32, -2.5, 0.3, 0.95), part(1.15, 0.3, 0.32, -2.5, 0.3, -0.95),   // folded front legs
    part(0.9, 0.28, 0.3, 1.6, 0.28, 1.75), part(0.9, 0.28, 0.3, 1.6, 0.28, -1.75),     // hind legs
    part(0.12, 0.2, 0.42, -3.0, 3.2, 0.78), part(0.12, 0.2, 0.42, -3.0, 3.2, -0.78),   // ears
    part(0.13, 0.95, 0.13, 3.5, 1.25, 0.35),      // tail
  ];
  for (const s of [-1, 1]) body.push(new THREE.ConeGeometry(0.15, 0.85, 8).rotateX(s * 0.3).translate(-3.1, 3.95, s * 0.42)); // horns
  const gold = [new THREE.TorusGeometry(1.08, 0.09, 6, 20).rotateY(Math.PI / 2).rotateZ(0.35).translate(-2.5, 2.05, 0)]; // bell garland
  for (let i = 0; i < 7; i++) { const a = Math.PI * (0.15 + (0.7 * i) / 6); gold.push(part(0.14, 0.17, 0.14, -2.2 - Math.cos(a - Math.PI / 2) * 0.0, 2.05 - Math.sin(a) * 1.08 - 0.12, Math.cos(a) * 1.08)); }
  gold.push(part(0.1, 0.22, 0.3, -4.05, 3.3, 0));            // forehead ornament
  gold.push(part(3.34, 0.5, 0.75, 0.3, 2.4, 0));             // cloth over the back
  const one = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
  return { body: one(body), gold: one(gold) };
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
