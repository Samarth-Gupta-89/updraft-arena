// Remote player. Two looks: a fat egg-shaped cutie, or a normal-sized person in Indian dress
// (man: long kurta + white dhoti and shoulder cloth; woman: saree with a gold blouse and border).
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

  // ================= human, about 1.75 m tall, faces -Z, feet at y = 0 =================
  const cyl = (rt, rb, h, x, y, z, sx = 1, sz = 1) => prep(new THREE.CylinderGeometry(rt, rb, h, 12), at(x, y, z, sx, 1, sz));
  const slab = (w, h, d, x, y, z, rz = 0) => prep(new THREE.BoxGeometry(w, h, d), new THREE.Matrix4().makeRotationZ(rz).setPosition(x, y, z));
  const head = [ball(0.115, 0, 1.62, 0, 1, 1.12, 1), cyl(0.05, 0.055, 0.1, 0, 1.49, 0)];
  const hairCap = prep(new THREE.SphereGeometry(0.123, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), at(0, 1.64, 0.014));
  const eyes = [ball(0.014, -0.04, 1.635, -0.108), ball(0.014, 0.04, 1.635, -0.108)];
  // man: kurta down to the knees (player colour), white cloth over one shoulder, white dhoti legs
  shared.hKurtaG = mergeGeometries([cyl(0.19, 0.25, 0.95, 0, 0.975, 0, 1, 0.7), ball(1, 0, 1.43, 0, 0.27, 0.1, 0.15)]);
  shared.hSashG = mergeGeometries([slab(0.11, 0.8, 0.03, 0.02, 1.13, -0.17, 0.5), slab(0.11, 0.55, 0.03, -0.17, 1.2, 0.15)]);
  shared.hSkinGm = mergeGeometries(head);
  shared.hHairGm = mergeGeometries([hairCap, ...eyes, slab(0.07, 0.014, 0.02, 0, 1.575, -0.112)]); // short hair, eyes, moustache
  shared.hLegG = mergeGeometries([limb(0.078, V(0, 0, 0), V(0, -0.8, 0)), ball(0.085, 0, -0.84, -0.05, 1, 0.5, 1.6)]);
  shared.hSleeveG = mergeGeometries([limb(0.048, V(-0.24, 0, 0), V(-0.2, -0.12, -0.42)), limb(0.048, V(0.24, 0, 0), V(0.2, -0.12, -0.42))]);
  shared.hHandG = mergeGeometries([ball(0.052, -0.2, -0.12, -0.45), ball(0.052, 0.2, -0.12, -0.45)]);
  // woman: saree (player colour) = long skirt + the cloth across the chest and over the shoulder; gold blouse and border
  shared.hSareeG = mergeGeometries([cyl(0.17, 0.33, 0.95, 0, 0.515, 0, 1, 0.85), slab(0.14, 0.74, 0.03, 0.02, 1.2, -0.155, -0.55), slab(0.15, 0.8, 0.03, -0.15, 1.02, 0.15)]);
  shared.hBlouseG = mergeGeometries([
    cyl(0.15, 0.17, 0.36, 0, 1.27, 0, 1, 0.75), ball(1, 0, 1.43, 0, 0.22, 0.08, 0.13),
    prep(new THREE.TorusGeometry(0.325, 0.022, 6, 20), new THREE.Matrix4().makeRotationX(Math.PI / 2).scale(new THREE.Vector3(1, 0.85, 1)).setPosition(0, 0.07, 0)),
  ]);
  shared.hArmsGf = mergeGeometries([shared.hSleeveG.clone(), shared.hHandG.clone()]);
  shared.hSkinGf = mergeGeometries([...head.map((g) => g.clone()), cyl(0.145, 0.155, 0.12, 0, 1.04, 0, 1, 0.75)]);
  shared.hHairGf = mergeGeometries([hairCap.clone(), ...eyes.map((g) => g.clone()), ball(0.062, 0, 1.63, 0.125), limb(0.03, V(0, 1.56, 0.115), V(0, 1.18, 0.15))]); // bun + braid
  shared.hBindiG = ball(0.014, 0, 1.672, -0.112);
  shared.skin = new THREE.MeshLambertMaterial({ color: 0xc48a5a });
  shared.hair = new THREE.MeshLambertMaterial({ color: 0x1a1410 });
  shared.cloth = new THREE.MeshLambertMaterial({ color: 0xf4efe4 });
  shared.gold = new THREE.MeshLambertMaterial({ color: 0xdcb44c });
  shared.red = new THREE.MeshLambertMaterial({ color: 0xc81e2c });

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
    this.look = info.look === 'human' ? 'human' : 'egg';
    // sizes that differ between the two looks
    const human = this.look === 'human';
    const dim = (this.dim = human
      ? { armY: 1.38, gunX: 0.2, gunY: -0.1, gunZ: -0.5, gunS: 0.55, tagY: 2.1, tagDrop: 0.5, sqY: 0.3, sqXZ: 0, swing: 0.7, rock: 0.04, bounce: 0.03, ring: 0.45, shield: 0.62, shieldY: 0.9, hip: 0.9, footX: 0.1 }
      : { armY: ARM_Y, gunX: 0.8, gunY: -0.05, gunZ: -0.9, gunS: 1, tagY: 3.05, tagDrop: 0.85, sqY: 0.36, sqXZ: 0.12, swing: 0.9, rock: 0.13, bounce: 0.07, ring: 1, shield: 1, shieldY: 1.3, hip: 0.4, footX: 0.42 });

    // the egg squashes down when crouching and wobbles when walking (pivot at the ground)
    const egg = (this.egg = new THREE.Group());
    if (!human) {
      egg.add(
        new THREE.Mesh(S.eggG, this.bodyMat),
        new THREE.Mesh(S.whiteG, S.white),
        new THREE.Mesh(female ? S.blackGf : S.blackG, S.black),
        new THREE.Mesh(female ? S.bowG : S.pinkG, S.pink),
        new THREE.Mesh(female ? S.gearGf : S.gearGm, S.gear),
      );
    } else if (female) {
      egg.add(
        new THREE.Mesh(S.hSareeG, this.bodyMat), new THREE.Mesh(S.hBlouseG, S.gold), new THREE.Mesh(S.hSkinGf, S.skin),
        new THREE.Mesh(S.hHairGf, S.hair), new THREE.Mesh(S.hBindiG, S.red),
      );
    } else {
      egg.add(
        new THREE.Mesh(S.hKurtaG, this.bodyMat), new THREE.Mesh(S.hSashG, S.cloth),
        new THREE.Mesh(S.hSkinGm, S.skin), new THREE.Mesh(S.hHairGm, S.hair),
      );
    }
    g.add(egg);

    // legs / feet swing from the hip. A saree hides the legs, so the woman gets none.
    const legless = human && female;
    this.footL = legless ? new THREE.Group() : new THREE.Mesh(human ? S.hLegG : S.footG, human ? S.cloth : S.gear);
    this.footR = legless ? new THREE.Group() : new THREE.Mesh(human ? S.hLegG : S.footG, human ? S.cloth : S.gear);
    this.footL.position.set(-dim.footX, dim.hip, 0);
    this.footR.position.set(dim.footX, dim.hip, 0);
    g.add(this.footL, this.footR);

    // arms + guns follow the view pitch
    this.arms = new THREE.Group();
    this.arms.position.y = dim.armY;
    if (!human) this.arms.add(new THREE.Mesh(S.armG, this.bodyMat));
    else if (female) this.arms.add(new THREE.Mesh(S.hArmsGf, S.skin)); // bare arms
    else this.arms.add(new THREE.Mesh(S.hSleeveG, this.bodyMat), new THREE.Mesh(S.hHandG, S.skin)); // kurta sleeves
    const mkGun = (side, glow) => {
      const gun = new THREE.Group();
      gun.position.set(side * dim.gunX, dim.gunY, dim.gunZ);
      gun.scale.setScalar(dim.gunS);
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
    this.shield.position.y = dim.shieldY;
    this.shield.scale.setScalar(dim.shield);
    this.shield.visible = false;
    g.add(this.shield);

    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.tag.scale.set(2.0, 0.5, 1);
    this.tag.position.y = dim.tagY;
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
    const dim = this.dim;
    this.egg.scale.set(1 + dim.sqXZ * cr, 1 - dim.sqY * cr, 1 + dim.sqXZ * cr);
    if (this.look === 'human') { // legs fold with the body
      this.footL.position.y = this.footR.position.y = dim.hip * (1 - dim.sqY * cr);
      this.footL.scale.y = this.footR.scale.y = 1 - dim.sqY * cr;
    }
    this.tag.position.y = dim.tagY - dim.tagDrop * cr;
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
      fl = sw * dim.swing * amt; fr = -sw * dim.swing * amt;
      rock = sw * dim.rock * amt;
      bounce = Math.abs(Math.cos(this.phase)) * dim.bounce * amt;
    } else if (!onGround) {
      fl = 0.7; fr = -0.5; // feet dangle in the air
      rock = Math.sin(now / 130) * 0.6 * dim.rock;
    }
    this.footL.rotation.x += (fl - this.footL.rotation.x) * ease;
    this.footR.rotation.x += (fr - this.footR.rotation.x) * ease;
    this.egg.rotation.z += (rock - this.egg.rotation.z) * ease;
    this.egg.position.y = bounce;

    for (const gk of ['L', 'P']) {
      this.recoil[gk] = Math.max(0, this.recoil[gk] - dt * 6);
      (gk === 'L' ? this.gunL : this.gunR).position.z = dim.gunZ + this.recoil[gk] * 0.14 * dim.gunS;
    }

    this.shield.visible = now < this.protectUntil;

    const lifted = (this.flags & 1) !== 0;
    this.floatRing.visible = lifted;
    if (lifted) {
      const pulse = (now / 300) % 1;
      this.floatRing.scale.setScalar((0.8 + pulse * 0.6) * dim.ring);
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
