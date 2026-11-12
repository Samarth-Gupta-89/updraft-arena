// Builds the visible world, tuned for speed: one floating arena under a cheap gradient sky.
// Static objects are merged into a handful of meshes so the GPU gets few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
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
    const NU = 84, NV = 58; // ~1.5 m squares: plenty for a flat yard and the pond banks
    const posArr = new Float32Array((NU + 1) * (NV + 1) * 3), uvArr = new Float32Array((NU + 1) * (NV + 1) * 2);
    const colors = new Float32Array((NU + 1) * (NV + 1) * 3);
    const C = {
      paveA: new THREE.Color(0xa29c90), paveB: new THREE.Color(0xb3ac9c), grass: new THREE.Color(0x58762f),
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
        // pale granite paving, like the temple yard
        col.copy(C.paveA).lerp(C.paveB, M.fbm(x * 0.05 + 100, z * 0.05, 4, 21));
        if (y < WATER_LEVEL + 0.45) col.lerp(C.sand, smooth((WATER_LEVEL + 0.45 - y) / 0.5));
        if (y < WATER_LEVEL - 0.2) col.lerp(C.mud, smooth((WATER_LEVEL - 0.2 - y) / 0.8));
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
    // the yard is flat, so its lighting is the same everywhere: a plain (unlit) material looks the same and costs less per pixel
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, map: TX.paving() });
    mat.color.setScalar(0.86);
    const ground = new THREE.Mesh(g, mat);
    ground.renderOrder = 2; // after the walls and cover: the pixels they hide are skipped
    scene.add(ground);
  }

  // ---------------------------------------------------------------- ponds (one sheet of water under both, the ground hides the rest)
  {
    // plain still water: ripples and highlights were worked out for every pixel of the ponds
    const mat = new THREE.MeshBasicMaterial({ color: 0x3a6a4c, transparent: true, opacity: 0.84 });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const k of M.PONDS) { x0 = Math.min(x0, k.x - k.rx); x1 = Math.max(x1, k.x + k.rx); z0 = Math.min(z0, k.z - k.rz); z1 = Math.max(z1, k.z + k.rz); }
    const water = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 4, z1 - z0 + 4), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((x0 + x1) / 2, WATER_LEVEL, (z0 + z1) / 2);
    scene.add(water);
    // lotus leaves and flowers floating on the two ponds
    const pads = [], blooms = [];
    for (let k = 0; k < 56; k++) {
      const pond = M.PONDS[k % 2];
      const a = M.noise2(k * 1.7, 3, 5) * Math.PI * 4, rr = Math.sqrt(M.noise2(k * 2.3, 9, 6)) * 0.8;
      const x = pond.x + Math.cos(a) * pond.rx * rr, z = pond.z + Math.sin(a) * pond.rz * rr;
      if (M.groundAt(x, z) > WATER_LEVEL - 0.5) continue;
      const r = 0.3 + M.noise2(k, 1, 7) * 0.35;
      pads.push(new THREE.CircleGeometry(r, 9, 0.4, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2).rotateY(k).translate(x, WATER_LEVEL + 0.03, z));
      if (k % 3 === 0) blooms.push(new THREE.ConeGeometry(0.16, 0.26, 6).rotateX(Math.PI).translate(x + r * 0.4, WATER_LEVEL + 0.17, z));
    }
    scene.add(merged(pads, new THREE.MeshLambertMaterial({ color: 0x3f8a3a })));
    scene.add(merged(blooms, new THREE.MeshLambertMaterial({ color: 0xf08ab4 })));
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
    scene.add(merged([deck, ...rails], new THREE.MeshLambertMaterial({ color: 0xf2ece0 })));
  }

  // ---------------------------------------------------------------- white compound wall along the outline, terracotta top, slab
  const concTex = TX.concrete();
  const plasterTex = TX.plaster();
  const tileTex = TX.roofTiles();
  {
    const T = ARENA.wallT, top = ARENA.wallH, bottom = -3;
    const walls = [], caps = [];
    for (const e of M.EDGES) {
      const ang = Math.atan2(-e.tz, e.tx);
      const mx = (e.ax + e.bx) / 2 - e.nx * T / 2, mz = (e.az + e.bz) / 2 - e.nz * T / 2;
      walls.push(tiledBox(e.len + T * 2.4, top - bottom, T, 4).rotateY(ang).translate(mx, (top + bottom) / 2, mz));
      caps.push(tiledBox(e.len + T * 2.4, 0.4, T + 0.3, 1.6).rotateY(ang).translate(mx, top - 0.1, mz));
    }
    scene.add(merged(walls, new THREE.MeshLambertMaterial({ map: plasterTex, color: 0xfff6e6 })));
    scene.add(merged(caps, new THREE.MeshLambertMaterial({ map: tileTex })));
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
        scene.add(new THREE.Mesh(n.body.translate(nx, c.base, nz), new THREE.MeshPhongMaterial({ color: 0x2b2e2d, specular: 0x5a554e, shininess: 22 })));
        scene.add(new THREE.Mesh(n.gold.translate(nx, c.base, nz), new THREE.MeshPhongMaterial({ color: 0xa87f3c, specular: 0xd8b060, shininess: 40 })));
      } else if (ref.type === 'rock') {
        rocks.push(rockGeometry(ref.w, ref.h, ref.d, rockSeed++).translate(x, c.base, z));
      } else if (ref.type === 'tree') {
        palm(trunks, leaves, x, z, c.base, c.base + 8);
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
    scene.add(merged(blocks, new THREE.MeshLambertMaterial({ map: plasterTex, color: 0xfff1dc }))); // white-washed walls
    scene.add(merged(stones, new THREE.MeshLambertMaterial({ map: concTex, color: 0x9a968e })));
    scene.add(merged(trunks, new THREE.MeshLambertMaterial({ map: TX.bark() })));
    scene.add(merged(leaves, new THREE.MeshLambertMaterial({ color: 0x4a7a30, flatShading: true, side: THREE.DoubleSide })));
  }

  buildSurroundings(scene, plasterTex, tileTex);

  // nothing built above ever moves, so three.js need not recompute its placement every frame
  for (const o of scene.children) if (o.isMesh || o.isInstancedMesh) { o.updateMatrix(); o.matrixAutoUpdate = false; }

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

// coconut palm: thin trunk from baseY up to topY, drooping fronds at the top
function palm(trunks, leaves, x, z, baseY, topY) {
  const h = topY - baseY;
  trunks.push(new THREE.CylinderGeometry(0.16, 0.28, h, 7).translate(x, baseY + h / 2, z));
  for (let i = 0; i < 8; i++) {
    const frond = new THREE.ConeGeometry(0.55, 3.6, 4).scale(1, 1, 0.22).rotateZ(-(Math.PI / 2 + 0.3 + (i % 2) * 0.25)).translate(1.6, -0.45 - (i % 2) * 0.35, 0);
    leaves.push(frond.rotateY((i / 8) * Math.PI * 2 + x).translate(x, topY + 0.1, z));
  }
}

// What you see over the wall, as at the Isha Yoga Center: the brick dome of the Dhyanalinga to the west,
// tile-roofed buildings, coconut groves all round and the Velliangiri hills behind. Scenery only (no collisions);
// it stands a few metres clear of the wall, so anyone pushed out still falls past it.
function buildSurroundings(scene, plasterTex, tileTex) {
  const DEEP = -40; // how far down the bases go
  const out = (edge, t, dist) => { const e = M.EDGES[edge]; return [e.ax + e.tx * e.len * t - e.nx * dist, e.az + e.tz * e.len * t - e.nz * dist, Math.atan2(-e.tz, e.tx)]; };
  const wallsG = [], roofsG = [], domeG = [], trunks = [], leaves = [], solid = [];
  const building = (x, z, ang, w, d, wallH, roofH) => {
    wallsG.push(tiledBox(w, wallH - DEEP, d, 3).rotateY(ang).translate(x, (wallH + DEEP) / 2, z));
    const k = 0.7071;
    roofsG.push(new THREE.ConeGeometry(1, roofH, 4, 1).rotateY(Math.PI / 4).scale((w / 2 + 1) / k, 1, (d / 2 + 1) / k).rotateY(ang).translate(x, wallH + roofH / 2, z));
    solid.push([x, z, Math.max(w, d) / 2 + 2]);
  };
  // the Dhyanalinga dome, beyond the west wall (the Nandi faces it)
  const [dx, dz] = out(3, 0.52, 30);
  domeG.push(new THREE.SphereGeometry(13, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1).translate(dx, 3, dz));
  domeG.push(new THREE.CylinderGeometry(13.2, 13.2, 3 - DEEP, 28).translate(dx, (3 + DEEP) / 2, dz));
  solid.push([dx, dz, 16]);
  { const [x, z, a] = out(3, 0.52, 12); building(x, z, a, 16, 7, 5.5, 2.6); }   // its entrance hall
  { const [x, z, a] = out(1, 0.55, 11); building(x, z, a, 44, 10, 6, 3.4); }    // long pavilion along the east side
  { const [x, z, a] = out(0, 0.25, 12); building(x, z, a, 26, 10, 5.5, 3); }    // north side
  { const [x, z, a] = out(0, 0.72, 13); building(x, z, a, 22, 11, 6.5, 3.2); }
  { const [x, z, a] = out(2, 0.3, 12); building(x, z, a, 24, 9, 5.5, 3); }      // south side
  { const [x, z, a] = out(2, 0.75, 14); building(x, z, a, 18, 10, 6, 3); }
  // coconut groves
  let n = 0;
  M.EDGES.forEach((e, edge) => {
    for (let s = 3; s < e.len; s += 3.2) {
      n++;
      const dist = 6 + M.noise2(n * 1.31, 7, 61) * 34;
      const [x, z] = out(edge, (s + (M.noise2(n * 0.77, 2, 62) - 0.5) * 3) / e.len, dist);
      if (solid.some(([bx, bz, r]) => Math.hypot(x - bx, z - bz) < r)) continue;
      palm(trunks, leaves, x, z, DEEP, 6 + M.noise2(n * 2.1, 4, 63) * 5);
    }
  });
  // drawn after the yard (renderOrder), so pixels hidden behind the wall are skipped instead of drawn twice
  const far = (mesh, order = 3) => { mesh.renderOrder = order; scene.add(mesh); };
  far(merged(wallsG, new THREE.MeshLambertMaterial({ map: plasterTex, color: 0xfff1dc })));
  far(merged(roofsG, new THREE.MeshLambertMaterial({ map: tileTex, flatShading: true })));
  far(merged(domeG, new THREE.MeshLambertMaterial({ color: 0xc46a3c })));
  far(merged(trunks, new THREE.MeshLambertMaterial({ color: 0x6b5a48 })));
  far(merged(leaves, new THREE.MeshLambertMaterial({ color: 0x4a7a30, flatShading: true, side: THREE.DoubleSide })));
  // the Velliangiri hills on the horizon
  const hills = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + 0.3, r = 600 + M.noise2(k, 5, 71) * 100, h = 70 + M.noise2(k, 8, 72) * 90;
    hills.push(new THREE.ConeGeometry(300 + M.noise2(k, 3, 73) * 140, h, 14, 1).translate(Math.cos(a) * r, h / 2 - 25, Math.sin(a) * r));
  }
  far(merged(hills, new THREE.MeshBasicMaterial({ color: 0x6d8f86, fog: false })), 4);
}

// The Nandi, taken from the Isha Vayu Racers project: its body parts are ellipsoids fused into one smooth
// sculpted surface (marching cubes), plus horns, tail, brass neck rings and bells.
// Returned facing -x, with the origin at the middle of its base.
function nandiGeometry() {
  const forms = [];
  const ell = (x, y, z, sx, sy, sz, rz = 0) => forms.push({ x, y, z, sx, sy, sz, rz });
  ell(0, 2.1, -0.9, 1.75, 1.35, 2.9); ell(0, 3.15, 1.1, 1.25, 1.85, 1.35); ell(0, 4.15, 2.25, 1, 1.4, 1.1); ell(0, 3.65, 3.35, 1, 0.65, 0.75);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [], gold = [];
  for (const side of [-1, 1]) {
    ell(side * 1.6, 1.05, 1.65, 0.55, 0.48, 1.9); ell(side * 1.7, 1.05, -2.15, 0.65, 0.5, 1.7);   // folded legs
    ell(side * 1.18, 4.4, 2.3, 0.85, 0.26, 0.5, side * 0.3);                                       // ears
    const horn = new THREE.CatmullRomCurve3([V(side * 0.7, 5.05, 2), V(side * 1.05, 5.8, 1.85), V(side * 0.82, 6.3, 1.7)]);
    parts.push(new THREE.TubeGeometry(horn, 12, 0.15, 8));
  }
  parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 2, -4), V(1, 1.2, -4.6), V(2, 0.9, -3.5)]), 16, 0.1, 6)); // tail
  // fuse the ellipsoids into one continuous surface
  const res = 42, mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 40000);
  mc.isolation = 0;
  const smin = (p, q, k = 0.38) => { const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (q - p)) / k)); return q + (p - q) * h - k * h * (1 - h); };
  for (let iz = 0; iz < res; iz++) for (let iy = 0; iy < res; iy++) for (let ix = 0; ix < res; ix++) {
    const x = (ix / res - 0.5) * 12, y = (iy / res - 0.5) * 12 + 3, z = (iz / res - 0.5) * 12;
    let dist = 100;
    for (const fm of forms) {
      const dx = x - fm.x, dy = y - fm.y, dz = z - fm.z, c = Math.cos(-fm.rz), sn = Math.sin(-fm.rz);
      const rx = dx * c - dy * sn, ry = dx * sn + dy * c;
      const q = Math.sqrt((rx / fm.sx) ** 2 + (ry / fm.sy) ** 2 + (dz / fm.sz) ** 2) - 1;
      dist = smin(dist, q * Math.min(fm.sx, fm.sy, fm.sz));
    }
    mc.field[iz * res * res + iy * res + ix] = -dist;
  }
  mc.update();
  const count = mc.geometry.drawRange.count, baked = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) baked.setAttribute(name, new THREE.BufferAttribute(mc.geometry.attributes[name].array.slice(0, count * 3), 3));
  baked.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  mc.geometry.dispose();
  parts.push(baked.scale(6, 6, 6).translate(0, 3, 0));
  for (const z of [1, 1.2, 1.4]) gold.push(new THREE.TorusGeometry(1.15, 0.05, 5, 22).rotateX(0.35).translate(0, 3, z)); // neck rings
  for (let i = 0; i < 11; i++) { const an = Math.PI * 0.08 + (i / 10) * Math.PI * 0.84; gold.push(new THREE.SphereGeometry(0.13, 6, 4).translate(Math.cos(an) * 1.3, 3 - Math.sin(an), 2)); } // bells
  const one = (list) => {
    const g = mergeGeometries(list.map((x) => { const n = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; }));
    return g.translate(0, -0.55, 0).scale(0.78, 0.78, 0.78).rotateY(-Math.PI / 2); // sit on the platform, face west
  };
  return { body: one(parts), gold: one(gold) };
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

// All pickups are drawn in a handful of calls: one instanced mesh for the rings, one per type for the
// floating cans, and a small icon only on the (rarer) air-dash ones.
class PickupVisuals {
  constructor(scene) {
    this.items = new Map();
    this.col = new THREE.Color();
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
    this.zero = new THREE.Vector3(0, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    const ringG = new THREE.TorusGeometry(0.62, 0.05, 4, 20);
    ringG.rotateX(Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringG, new THREE.MeshBasicMaterial({ toneMapped: false }), M.PICKUPS.length);
    this.rings.frustumCulled = false;
    scene.add(this.rings);
    const canG = new THREE.CylinderGeometry(0.18, 0.18, 0.5, 8);
    this.cans = {};
    for (const type of ['L', 'P', 'D']) {
      const n = M.PICKUPS.filter((p) => p.type === type).length;
      const im = new THREE.InstancedMesh(canG, new THREE.MeshBasicMaterial({ color: PICKUP_HEX[type], toneMapped: false }), n);
      im.frustumCulled = false;
      im.userData.n = 0;
      scene.add(im);
      this.cans[type] = im;
    }
    const dIcon = arrowIcon('D');
    let ri = 0;
    for (const p of M.PICKUPS) {
      const y = M.heightAt(p.x, p.z);
      this.rings.setMatrixAt(ri, this.m4.makeTranslation(p.x, y + 0.08, p.z));
      this.rings.setColorAt(ri, this.col.set(PICKUP_HEX[p.type]));
      let icon = null;
      if (p.type === 'D') {
        icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: dIcon, transparent: true, depthWrite: false }));
        icon.scale.setScalar(0.7);
        icon.position.set(p.x, y + 1.5, p.z);
        scene.add(icon);
      }
      this.items.set(p.id, { ...p, group: { position: new THREE.Vector3(p.x, y, p.z) }, icon, ring: ri++, can: this.cans[p.type].userData.n++, active: true, phase: p.id * 1.7 });
    }
  }
  setActive(id, a) {
    const it = this.items.get(id);
    if (!it) return;
    it.active = a;
    if (it.icon) it.icon.visible = a;
    this.rings.setColorAt(it.ring, this.col.set(a ? PICKUP_HEX[it.type] : 0x333333));
    this.rings.instanceColor.needsUpdate = true;
  }
  setAll(list) { for (const p of list) this.setActive(p.id, p.active); }
  update(t) {
    for (const it of this.items.values()) {
      const g = it.group.position, im = this.cans[it.type];
      // a taken pickup's can is shrunk to nothing until it comes back
      this.q.setFromAxisAngle(this.up, t * 1.6 + it.phase);
      this.v.set(g.x, g.y + 0.9 + Math.sin(t * 2.2 + it.phase) * 0.08, g.z);
      im.setMatrixAt(it.can, this.m4.compose(this.v, this.q, it.active ? this.one : this.zero));
    }
    for (const type of ['L', 'P', 'D']) this.cans[type].instanceMatrix.needsUpdate = true;
  }
}
