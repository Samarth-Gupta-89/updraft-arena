// First-person guns (rendered in their own pass so they never clip into walls) + shot effects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

export const GUN_COLOR = { L: new THREE.Color(0x5ff3ff), P: new THREE.Color(0xffb02e) };

// Bake a group of small meshes into one mesh per material (fewer draw calls).
function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const byMat = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) out.add(new THREE.Mesh(mergeGeometries(geos), mat));
  out.userData = group.userData;
  return out;
}

function part(group, geo, mat, x, y, z, rx = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  group.add(m);
  return m;
}

function buildLifter(M) {
  const g = new THREE.Group();
  const glow = new THREE.MeshBasicMaterial({ color: 0x5ff3ff, toneMapped: false });
  part(g, new THREE.BoxGeometry(0.07, 0.085, 0.34), M.metal, 0, 0, 0);
  part(g, new THREE.BoxGeometry(0.05, 0.03, 0.26), M.dark, 0, 0.055, -0.02);
  part(g, new THREE.CylinderGeometry(0.018, 0.022, 0.26, 10), M.metal, 0, 0.01, -0.28, Math.PI / 2);
  for (let i = 0; i < 3; i++) part(g, new THREE.TorusGeometry(0.03, 0.007, 6, 16), glow, 0, 0.01, -0.2 - i * 0.06);
  part(g, new THREE.CylinderGeometry(0.02, 0.02, 0.12, 10), glow, 0, 0.075, 0.05, Math.PI / 2);
  part(g, new THREE.BoxGeometry(0.05, 0.13, 0.06), M.dark, 0, -0.09, 0.09, 0.25);
  part(g, new THREE.BoxGeometry(0.072, 0.01, 0.2), glow, 0, -0.02, -0.04);
  g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.42);
  return mergeByMaterial(g);
}

function buildShover(M) {
  const g = new THREE.Group();
  const glow = new THREE.MeshBasicMaterial({ color: 0xffb02e, toneMapped: false });
  const orange = new THREE.MeshLambertMaterial({ color: 0xc8701e });
  part(g, new THREE.BoxGeometry(0.1, 0.1, 0.3), orange, 0, 0, 0);
  part(g, new THREE.BoxGeometry(0.106, 0.04, 0.2), M.dark, 0, 0, -0.02);
  part(g, new THREE.CylinderGeometry(0.038, 0.038, 0.16, 12), M.metal, 0, 0.015, -0.22, Math.PI / 2);
  part(g, new THREE.CylinderGeometry(0.065, 0.04, 0.1, 14), M.metal, 0, 0.015, -0.34, -Math.PI / 2);
  part(g, new THREE.CircleGeometry(0.06, 14), glow, 0, 0.015, -0.392);
  for (let i = 0; i < 3; i++) part(g, new THREE.BoxGeometry(0.108, 0.012, 0.03), glow, 0, 0.035, 0.02 + i * 0.04);
  part(g, new THREE.BoxGeometry(0.055, 0.14, 0.065), M.dark, 0, -0.1, 0.07, 0.25);
  g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.4);
  return mergeByMaterial(g);
}

// A round, solid, domed shield: blue rings around a pale centre boss. It faces -Z and its rim has radius 1.
export function shieldGeometry() {
  const END = 0.56; // how far round the ball the dome reaches (radians from its tip)
  const bands = [[0, 0.16, 0xdfeeff], [0.16, 0.3, 0x1f5fd0], [0.3, 0.44, 0x7fc4ff], [0.44, END, 0x123a8c]];
  const geos = bands.map(([a, b, hex]) => {
    const g = new THREE.SphereGeometry(1, 28, 2, 0, Math.PI * 2, a, b - a).toNonIndexed();
    const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const k = 1 / Math.sin(END);
  return mergeGeometries(geos).translate(0, -Math.cos(END), 0).rotateX(-Math.PI / 2).scale(k, k, k);
}
export const shieldMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

export class Weapons {
  constructor(worldScene) {
    this.world = worldScene;
    // ---- viewmodel pass
    this.vScene = new THREE.Scene();
    this.vCam = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.vScene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a4a3a, 1.1));
    this.vSun = new THREE.DirectionalLight(0xfff0d6, 1.7);
    this.vScene.add(this.vSun, this.vSun.target);
    const mats = {
      metal: new THREE.MeshLambertMaterial({ color: 0x4a5059 }),
      dark: new THREE.MeshLambertMaterial({ color: 0x1d1f23 }),
    };
    this.guns = { L: buildLifter(mats), P: buildShover(mats) };
    this.base = { L: new THREE.Vector3(-0.17, -0.155, -0.4), P: new THREE.Vector3(0.18, -0.16, -0.4) };
    this.guns.L.rotation.y = 0.06;
    this.guns.P.rotation.y = -0.06;
    for (const k of ['L', 'P']) {
      this.guns[k].scale.setScalar(0.62);
      this.guns[k].position.copy(this.base[k]);
      this.vScene.add(this.guns[k]);
    }
    // the shield takes the right gun's place while F is held
    this.shield = new THREE.Mesh(shieldGeometry(), shieldMaterial());
    this.shield.scale.setScalar(0.42);
    this.shield.rotation.set(0.12, 0.3, 0);
    // the right hand and forearm holding it from behind (sizes are in shield units: its rim radius is 1)
    const skin = new THREE.MeshLambertMaterial({ color: 0xc48a5a });
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skin);
    fist.position.set(0, 0, 0.16);
    const elbow = new THREE.Vector3(0.75, -0.95, 1.5), wrist = new THREE.Vector3(0, 0, 0.2);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, elbow.distanceTo(wrist), 2, 8), skin);
    arm.position.copy(elbow).add(wrist).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), elbow.clone().sub(wrist).normalize());
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.05), mats.dark);
    strap.position.set(0, 0, 0.08);
    this.shield.add(fist, arm, strap);
    this.shield.visible = false;
    this.vScene.add(this.shield);
    this.shieldUp = false; // set by the game
    this.shieldT = 0;      // 0 = down, 1 = fully raised
    this.charge = 0;       // 0..1, how charged the SHOVER is (set by the game)
    this.kickAmt = { L: 0, P: 0 };
    this.bobT = 0;
    this.visible = true;

    // muzzle flashes (viewmodel space)
    const glowTex = TX.glow();
    this.flash = {};
    for (const k of ['L', 'P']) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: GUN_COLOR[k], blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
      sp.scale.setScalar(0.14);
      sp.visible = false;
      sp.position.copy(this.guns[k].userData.muzzle);
      this.guns[k].add(sp);
      this.flash[k] = { sp, t: 0 };
    }

    // ---- world effects
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    tg.translate(0, 0.5, 0);
    tg.rotateX(Math.PI / 2); // along +Z
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const m = new THREE.Mesh(tg, mat);
      m.visible = false;
      m.frustumCulled = false;
      worldScene.add(m);
      this.tracers.push({ m, life: 0, max: 0.12 });
    }
    this.rings = [];
    const rg = new THREE.RingGeometry(0.75, 1, 24);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const m = new THREE.Mesh(rg, mat);
      m.visible = false;
      worldScene.add(m);
      this.rings.push({ m, life: 0, max: 0.35 });
    }
    // sparks: one point cloud used as a ring buffer
    this.NP = 400;
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(this.NP * 3);
    this.pCol = new Float32Array(this.NP * 3);
    this.pVel = new Float32Array(this.NP * 3);
    this.pLife = new Float32Array(this.NP);
    this.pBase = new Float32Array(this.NP * 3);
    for (let i = 0; i < this.NP; i++) this.pPos[i * 3 + 1] = -9999;
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.12, map: glowTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.points.frustumCulled = false;
    worldScene.add(this.points);
    this.pNext = 0;
    this.pAlive = 0;
    this.tmp = new THREE.Vector3();
    this.tmpQ = new THREE.Quaternion();
  }

  resize(aspect) { this.vCam.aspect = aspect; this.vCam.updateProjectionMatrix(); }

  muzzleWorld(g, camera, out) {
    // map the viewmodel muzzle into world space using the main camera's transform
    const gun = this.guns[g];
    out.copy(gun.userData.muzzle).multiply(gun.scale).applyEuler(gun.rotation).add(gun.position);
    return camera.localToWorld(out);
  }

  kick(g) {
    this.kickAmt[g] = 1;
    this.flash[g].t = 0.06;
    this.flash[g].sp.material.rotation = Math.random() * 6;
  }

  tracer(from, to, g, wide = false) {
    const tr = this.tracers.find((t) => t.life <= 0) || this.tracers[0];
    const len = from.distanceTo(to);
    if (len < 0.01) return;
    tr.m.position.copy(from);
    tr.m.lookAt(to);
    const w = g === 'P' ? 0.035 : 0.018;
    tr.m.scale.set(wide ? w * 2 : w, wide ? w * 2 : w, len);
    tr.m.material.color.copy(GUN_COLOR[g]);
    tr.m.material.opacity = 1;
    tr.m.visible = true;
    tr.max = g === 'P' ? 0.14 : 0.1;
    tr.life = tr.max;
  }

  ring(pos, normal, g, size = 1) {
    const r = this.rings.find((x) => x.life <= 0) || this.rings[0];
    r.m.position.copy(pos);
    r.m.lookAt(this.tmp.copy(pos).add(normal));
    r.m.material.color.copy(GUN_COLOR[g]);
    r.m.visible = true;
    r.size = size;
    r.life = r.max;
  }

  sparks(pos, g, count = 14, speed = 4, up = 1) {
    const c = GUN_COLOR[g];
    for (let n = 0; n < count; n++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % this.NP;
      this.pPos[i * 3] = pos.x; this.pPos[i * 3 + 1] = pos.y; this.pPos[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1;
      const s = speed * (0.4 + Math.random() * 0.8);
      const ce = Math.sqrt(1 - e * e);
      this.pVel[i * 3] = Math.cos(a) * ce * s;
      this.pVel[i * 3 + 1] = Math.abs(e) * s * up + (g === 'L' ? 3 : 0);
      this.pVel[i * 3 + 2] = Math.sin(a) * ce * s;
      this.pLife[i] = 0.35 + Math.random() * 0.3;
      this.pBase[i * 3] = c.r; this.pBase[i * 3 + 1] = c.g; this.pBase[i * 3 + 2] = c.b;
    }
    this.pAlive = 1;
  }

  // shot visuals at the impact point
  impact(point, dir, g, hitPlayer) {
    this.sparks(point, g, hitPlayer ? 22 : 10, hitPlayer ? 6 : 3.5);
    if (hitPlayer) this.ring(point, this.tmp.copy(dir).negate(), g, g === 'P' ? 1.6 : 1.1);
  }

  update(dt, camera, sunDir, moveSpeed, onGround) {
    // viewmodel sun follows the world sun in camera space
    this.vSun.position.copy(sunDir).applyQuaternion(this.tmpQ.copy(camera.quaternion).invert()).multiplyScalar(5);
    const bobOn = onGround ? Math.min(1, moveSpeed / 7) : 0;
    this.bobT += dt * (4 + moveSpeed * 0.9);
    const bx = Math.sin(this.bobT) * 0.012 * bobOn, by = Math.abs(Math.cos(this.bobT)) * 0.012 * bobOn;
    for (const k of ['L', 'P']) {
      this.kickAmt[k] = Math.max(0, this.kickAmt[k] - dt * (k === 'P' ? 5 : 9));
      const kk = this.kickAmt[k];
      const gun = this.guns[k];
      gun.position.set(this.base[k].x + bx, this.base[k].y - by + kk * 0.01, this.base[k].z + kk * (k === 'P' ? 0.06 : 0.035));
      gun.rotation.x = kk * (k === 'P' ? 0.35 : 0.18);
      const f = this.flash[k];
      f.t -= dt;
      f.sp.visible = f.t > 0;
      if (f.sp.visible) f.sp.scale.setScalar((k === 'P' ? 0.22 : 0.13) * (0.8 + Math.random() * 0.4));
    }

    // swap the right gun for the shield (it swings up from below)
    this.shieldT += ((this.shieldUp ? 1 : 0) - this.shieldT) * Math.min(1, dt * 16);
    this.guns.P.visible = this.shieldT < 0.5;
    this.shield.visible = this.shieldT > 0.03;
    this.shield.position.set(0.38 + bx, -0.3 - by - (1 - this.shieldT) * 0.8, -0.52);
    // charging the SHOVER: its muzzle glows brighter and the gun trembles
    if (this.charge > 0) {
      const f = this.flash.P, gun = this.guns.P;
      f.sp.visible = true;
      f.sp.scale.setScalar(0.08 + 0.3 * this.charge * (0.9 + Math.random() * 0.2));
      gun.position.x += (Math.random() - 0.5) * 0.006 * this.charge;
      gun.position.y += (Math.random() - 0.5) * 0.006 * this.charge;
    }

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) t.m.visible = false;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = 1 - r.life / r.max;
      r.m.scale.setScalar(0.2 + k * r.size);
      r.m.material.opacity = 1 - k;
      if (r.life <= 0) r.m.visible = false;
    }
    if (!this.pAlive) return; // nothing to simulate: skip the particle loop and GPU upload
    let alive = 0;
    for (let i = 0; i < this.NP; i++) {
      if (this.pLife[i] <= 0) continue;
      alive++;
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 9 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      const f = Math.max(0, this.pLife[i] / 0.5);
      this.pCol[i * 3] = this.pBase[i * 3] * f; this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * f; this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * f;
      if (this.pLife[i] <= 0) this.pPos[i * 3 + 1] = -9999;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.pAlive = alive;
  }

  render(renderer) {
    if (!this.visible) return;
    renderer.clearDepth();
    renderer.render(this.vScene, this.vCam);
  }
}
