// Remote player: a fat egg-shaped cutie with big eyes, stubby feet and two guns.
// Static parts are merged per material so each player costs only ~12 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

const INTERP_DELAY = 100; // ms behind the newest snapshot
const ARM_Y = 1.25;

// non-indexed, position/normal/uv only, so any mix of primitives can be merged
function prep(g, m) {
  const out = g.index ? g.toNonIndexed() : g;
  if (m) out.applyMatrix4(m);
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
  return out;
}
const at = (x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
const ball = (r, x, y, z, sx = 1, sy = 1, sz = 1) => prep(new THREE.SphereGeometry(r, 14, 10), at(x, y, z, sx, sy, sz));

// capsule from point a to point b
function limb(r, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 8);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return prep(g, new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

const shared = {};
function sharedAssets() {
  if (shared.ready) return shared;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- egg body: about 2.2 m wide, 2.2 m tall, fat at the bottom and narrower on top. Faces -Z.
  const egg = new THREE.SphereGeometry(1, 24, 18);
  const p = egg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = y > 0 ? 1 - 0.3 * y * y : 1 + 0.06 * y; // taper the top
    p.setXYZ(i, p.getX(i) * 1.1 * k, y * 1.1, p.getZ(i) * 0.98 * k);
  }
  egg.computeVertexNormals();
  shared.eggG = prep(egg, at(0, 1.3, 0));

  // ---- face: big white eyes, black pupils, smile, pink cheeks
  shared.whiteG = mergeGeometries([ball(0.24, -0.33, 1.72, -0.72, 1, 1.15, 0.6), ball(0.24, 0.33, 1.72, -0.72, 1, 1.15, 0.6)]);
  const smile = prep(new THREE.TorusGeometry(0.17, 0.035, 6, 14, Math.PI), new THREE.Matrix4().makeRotationZ(Math.PI).setPosition(0, 1.42, -0.93));
  shared.blackG = mergeGeometries([ball(0.11, -0.31, 1.7, -0.86, 1, 1.1, 0.5), ball(0.11, 0.31, 1.7, -0.86, 1, 1.1, 0.5), smile]);
  shared.pinkG = mergeGeometries([ball(0.12, -0.62, 1.42, -0.74, 1, 0.7, 0.4), ball(0.12, 0.62, 1.42, -0.74, 1, 0.7, 0.4)]);
  // female: big pink bow on top (merged with the cheeks)
  shared.bowG = mergeGeometries([
    ball(0.12, -0.62, 1.42, -0.74, 1, 0.7, 0.4), ball(0.12, 0.62, 1.42, -0.74, 1, 0.7, 0.4),
    ball(0.24, -0.26, 2.42, 0, 1, 0.8, 0.5), ball(0.24, 0.26, 2.42, 0, 1, 0.8, 0.5), ball(0.11, 0, 2.42, 0),
  ]);
  // male: little dark helmet with a spike (merged with belt)
  const belt = prep(new THREE.TorusGeometry(1.09, 0.06, 6, 28), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.95, 0));
  shared.gearGm = mergeGeometries([
    belt,
    prep(new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), at(0, 2.02, 0, 1.15, 0.9, 1.1)),
    prep(new THREE.ConeGeometry(0.09, 0.26, 8), at(0, 2.58, 0)),
  ]);
  shared.gearGf = belt;
  // female eyelashes ride along with the black parts
  shared.blackGf = mergeGeometries([
    shared.blackG.clone(),
    limb(0.02, V(-0.5, 1.93, -0.72), V(-0.62, 2.03, -0.66)), limb(0.02, V(0.5, 1.93, -0.72), V(0.62, 2.03, -0.66)),
  ]);

  // ---- stubby foot (pivot at the hip joint just under the egg)
  shared.footG = mergeGeometries([limb(0.13, V(0, 0, 0), V(0, -0.22, 0)), ball(0.26, 0, -0.26, -0.08, 1, 0.55, 1.5)]);
  // ---- tiny arms reaching forward to the guns (pivot at ARM_Y)
  const arm = (s) => limb(0.1, V(s * 0.98, 0.02, -0.2), V(s * 0.8, -0.05, -0.85));
  shared.armG = mergeGeometries([arm(-1), arm(1), ball(0.13, -0.8, -0.05, -0.9), ball(0.13, 0.8, -0.05, -0.9)]);
  // ---- gun (pivot at the hand)
  shared.gunG = mergeGeometries([prep(new THREE.BoxGeometry(0.16, 0.2, 0.62), at(0, 0.08, -0.22)), prep(new THREE.BoxGeometry(0.09, 0.18, 0.1), at(0, -0.06, 0.02))]);
  shared.barrelG = prep(new THREE.CylinderGeometry(0.055, 0.055, 0.34, 8), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.1, -0.68));

  shared.ringG = new THREE.TorusGeometry(1.2, 0.07, 6, 28);
  shared.ringG.rotateX(Math.PI / 2);
  shared.shieldG = new THREE.SphereGeometry(1.75, 20, 12);

  shared.white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  shared.black = new THREE.MeshLambertMaterial({ color: 0x15171a });
  shared.pink = new THREE.MeshLambertMaterial({ color: 0xff8fb3 });
  shared.gear = new THREE.MeshLambertMaterial({ color: 0x2a2e34 });
  shared.gunMetal = new THREE.MeshLambertMaterial({ color: 0x2a2d31 });
  shared.liftGlow = new THREE.MeshBasicMaterial({ color: 0x5ff3ff, toneMapped: false });
  shared.pushGlow = new THREE.MeshBasicMaterial({ color: 0xffb02e, toneMapped: false });
  shared.floatRingMat = new THREE.MeshBasicMaterial({ color: 0x5ff3ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  shared.shieldMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  shared.ready = true;
  return shared;
}

export class Avatar {
  constructor(scene, info, isEnemy) {
    const S = sharedAssets();
    this.scene = scene;
    this.samples = [];
    this.visible = false;
    this.phase = 0;
    this.speed = 0;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.flags = 0;
    this.recoil = { L: 0, P: 0 };
    this.protectUntil = 0;
    this.crouchAmt = 0;

    this.bodyMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const g = (this.group = new THREE.Group());
    const female = info.sex === 'f';

    // the egg squashes down when crouching and wobbles when walking (pivot at the ground)
    const egg = (this.egg = new THREE.Group());
    egg.add(
      new THREE.Mesh(S.eggG, this.bodyMat),
      new THREE.Mesh(S.whiteG, S.white),
      new THREE.Mesh(female ? S.blackGf : S.blackG, S.black),
      new THREE.Mesh(female ? S.bowG : S.pinkG, S.pink),
      new THREE.Mesh(female ? S.gearGf : S.gearGm, S.gear),
    );
    g.add(egg);

    this.footL = new THREE.Mesh(S.footG, S.gear);
    this.footR = new THREE.Mesh(S.footG, S.gear);
    this.footL.position.set(-0.42, 0.4, 0);
    this.footR.position.set(0.42, 0.4, 0);
    g.add(this.footL, this.footR);

    // arms + guns follow the view pitch
    this.arms = new THREE.Group();
    this.arms.position.y = ARM_Y;
    this.arms.add(new THREE.Mesh(S.armG, this.bodyMat));
    const mkGun = (side, glow) => {
      const gun = new THREE.Group();
      gun.position.set(side * 0.8, -0.05, -0.9);
      gun.add(new THREE.Mesh(S.gunG, S.gunMetal), new THREE.Mesh(S.barrelG, glow));
      this.arms.add(gun);
      return gun;
    };
    this.gunL = mkGun(-1, S.liftGlow);
    this.gunR = mkGun(1, S.pushGlow);
    egg.add(this.arms);

    this.floatRing = new THREE.Mesh(S.ringG, S.floatRingMat);
    this.floatRing.visible = false;
    g.add(this.floatRing);

    this.shield = new THREE.Mesh(S.shieldG, S.shieldMat);
    this.shield.position.y = 1.3;
    this.shield.visible = false;
    g.add(this.shield);

    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.tag.scale.set(2.0, 0.5, 1);
    this.tag.position.y = 3.05;
    g.add(this.tag);

    g.visible = false;
    scene.add(g);
    this.setInfo(info, isEnemy);
  }

  setInfo(info, isEnemy) {
    const key = `${info.name}|${info.colorHex}|${isEnemy}`;
    if (key === this.infoKey) return;
    this.infoKey = key;
    this.name = info.name;
    this.bodyMat.color.set(info.colorHex);
    if (this.tag.material.map) this.tag.material.map.dispose();
    this.tag.material.map = TX.nameTag(info.name, info.colorHex);
    this.tag.material.depthTest = isEnemy; // teammates' names show through walls
    this.tag.renderOrder = isEnemy ? 0 : 10;
    this.tag.material.needsUpdate = true;
  }

  push(p, yaw, pitch, flags, t = performance.now()) {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return; // keep samples in time order
    this.samples.push({ t, x: p[0], y: p[1], z: p[2], yaw, pitch, flags });
    if (this.samples.length > 30) this.samples.shift();
    this.lastSeen = t;
  }

  teleport(p, yaw) {
    this.samples.length = 0;
    this.push(p, yaw, 0, 0);
    this.pos.set(p[0], p[1], p[2]);
  }

  get isProtected() { return performance.now() < this.protectUntil; }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  fired(g) { this.recoil[g] = 1; }

  // world position of the muzzle for tracers
  muzzle(g, out) {
    return (g === 'L' ? this.gunL : this.gunR).localToWorld(out.set(0, 0.1, -0.85));
  }

  update(dt, now) {
    if (!this.samples.length) return;
    const rt = now - INTERP_DELAY;
    const s = this.samples;
    let a = s[0], b = s[s.length - 1];
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= rt) { a = s[i - 1]; b = s[i]; break; }
    }
    let k = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 1;
    k = Math.max(0, Math.min(1.2, k));
    const nx = a.x + (b.x - a.x) * k, ny = a.y + (b.y - a.y) * k, nz = a.z + (b.z - a.z) * k;
    const moved = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    this.speed += ((dt > 0 ? moved / dt : 0) - this.speed) * Math.min(1, dt * 8);
    this.pos.set(nx, ny, nz);
    let dy = b.yaw - a.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw = a.yaw + dy * Math.min(1, k);
    this.pitch = a.pitch + (b.pitch - a.pitch) * Math.min(1, k);
    this.flags = b.flags;

    const g = this.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;

    // crouch: the egg squashes down and bulges out
    const cr = (this.crouchAmt += (((this.flags & 8) ? 1 : 0) - this.crouchAmt) * Math.min(1, dt * 12));
    this.egg.scale.set(1 + 0.12 * cr, 1 - 0.36 * cr, 1 + 0.12 * cr);
    this.tag.position.y = 3.05 - 0.85 * cr;
    this.arms.rotation.x = this.pitch;

    // waddle: feet swing and the egg rocks side to side
    const onGround = (this.flags & 4) !== 0;
    const sp = Math.min(this.speed, 10);
    const ease = Math.min(1, dt * 12);
    let fl = 0, fr = 0, rock = 0, bounce = 0;
    if (onGround && sp > 0.5) {
      this.phase += dt * sp * 1.5;
      const amt = Math.min(1, sp / 6);
      const sw = Math.sin(this.phase);
      fl = sw * 0.9 * amt; fr = -sw * 0.9 * amt;
      rock = sw * 0.13 * amt;
      bounce = Math.abs(Math.cos(this.phase)) * 0.07 * amt;
    } else if (!onGround) {
      fl = 0.7; fr = -0.5; // feet dangle in the air
      rock = Math.sin(now / 130) * 0.08;
    }
    this.footL.rotation.x += (fl - this.footL.rotation.x) * ease;
    this.footR.rotation.x += (fr - this.footR.rotation.x) * ease;
    this.egg.rotation.z += (rock - this.egg.rotation.z) * ease;
    this.egg.position.y = bounce;

    for (const gk of ['L', 'P']) {
      this.recoil[gk] = Math.max(0, this.recoil[gk] - dt * 6);
      (gk === 'L' ? this.gunL : this.gunR).position.z = -0.9 + this.recoil[gk] * 0.14;
    }

    this.shield.visible = now < this.protectUntil;

    const lifted = (this.flags & 1) !== 0;
    this.floatRing.visible = lifted;
    if (lifted) {
      const pulse = (now / 300) % 1;
      this.floatRing.scale.setScalar(0.8 + pulse * 0.6);
      this.floatRing.position.y = 0.1 + pulse * 0.4;
      this.floatRing.material.opacity = 0.9 * (1 - pulse);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.bodyMat.dispose();
    if (this.tag.material.map) this.tag.material.map.dispose();
    this.tag.material.dispose();
  }
}
