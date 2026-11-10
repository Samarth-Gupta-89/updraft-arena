// Local player movement: terrain + box collisions, water, and knockback from lift/push hits.
import { PLAYER, PHYS, DASH, WATER_LEVEL, heightAt, inArena } from './shared/map.js';

const R = PLAYER.radius, H = PLAYER.height, STEP = 0.4;

export class Controller {
  constructor(colliders) {
    this.col = colliders;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vy = 0;
    this.mv = { x: 0, z: 0 };   // input-driven velocity
    this.kb = { x: 0, z: 0 };   // knockback velocity (decays slowly in the air)
    this.onGround = false;
    this.inWater = false;
    this.floatUntil = 0;
    this.crouching = false;
    this.height = H;
    this.events = [];           // 'jump' | 'land:<speed>' | 'splash'
    this.airT = 0;              // seconds since last on the ground (for coyote jumps)
    this.jumpBuf = 0;           // seconds a recent jump press stays valid
    this.jumpHeld = false;
    this.dashAt = 0;
  }

  // Air dash: fly along (dx, dz) and up a little. Replaces any knockback, so it can bring you back in.
  dash(dx, dz) {
    const now = performance.now();
    if (this.onGround || this.inWater || now - this.dashAt < DASH.cooldownMs) return false;
    const l = Math.hypot(dx, dz) || 1;
    this.kb.x = (dx / l) * DASH.speed;
    this.kb.z = (dz / l) * DASH.speed;
    this.mv.x = this.mv.z = 0;
    this.vy = Math.max(this.vy, 0) * 0.5 + DASH.up;
    this.floatUntil = 0;
    this.dashAt = now;
    return true;
  }

  spawn(p) {
    this.pos.x = p[0]; this.pos.y = p[1]; this.pos.z = p[2];
    this.vy = 0;
    this.mv.x = this.mv.z = this.kb.x = this.kb.z = 0;
    this.floatUntil = 0;
    this.onGround = false;
    this.crouching = false;
    this.height = H;
  }

  get floating() { return performance.now() < this.floatUntil; }

  impulse(g, d) {
    const now = performance.now();
    if (g === 'L') {
      this.vy = Math.min(PHYS.maxVy, Math.max(this.vy, 0) + PHYS.liftV);
      this.floatUntil = now + PHYS.liftFloatMs;
    } else {
      let hx = d[0], hz = d[2];
      const l = Math.hypot(hx, hz) || 1;
      hx /= l; hz /= l;
      this.kb.x += hx * PHYS.pushV;
      this.kb.z += hz * PHYS.pushV;
      const m = Math.hypot(this.kb.x, this.kb.z);
      if (m > PHYS.maxKb) { this.kb.x *= PHYS.maxKb / m; this.kb.z *= PHYS.maxKb / m; }
      this.vy = Math.min(PHYS.maxVy, Math.max(this.vy, 0) + PHYS.pushUp);
    }
    this.onGround = false;
    this.pos.y += 0.02;
  }

  // input: { f, r, jump, sprint, crouch } with f/r in -1..1
  update(dt, input, yaw) {
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      this.step(h, input, yaw);
      left -= h;
    }
  }

  terrainAt(x, z) { return inArena(x, z) ? heightAt(x, z) : -Infinity; }

  step(dt, inp, yaw) {
    const p = this.pos;
    const now = performance.now();
    const terrain = this.terrainAt(p.x, p.z);
    const depth = WATER_LEVEL - p.y;
    const wasWater = this.inWater;
    // only the pond is water; outside the arena there is no ground at all (terrain = -Infinity)
    this.inWater = depth > 0.1 && Number.isFinite(terrain) && terrain < WATER_LEVEL;
    if (this.inWater && !wasWater && this.vy < -3) this.events.push('splash');

    // crouch (not while swimming)
    this.crouching = !!inp.crouch && !this.inWater;
    this.height = this.crouching ? PLAYER.crouchHeight : H;

    // ---- horizontal intent
    let f = inp.f, r = inp.r;
    const il = Math.hypot(f, r);
    if (il > 1) { f /= il; r /= il; }
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const wx = -s * f + c * r, wz = -c * f - s * r;
    const speed = this.inWater ? PHYS.swim : this.crouching ? PHYS.crouchSpeed : (inp.sprint && f > 0.1 ? PHYS.sprint : PHYS.walk);
    const accel = this.onGround ? 70 : this.inWater ? 18 : PHYS.airAccel;
    const tx = wx * speed, tz = wz * speed;
    const dx = tx - this.mv.x, dz = tz - this.mv.z;
    const dl = Math.hypot(dx, dz), maxD = accel * dt;
    if (dl <= maxD) { this.mv.x = tx; this.mv.z = tz; }
    else { this.mv.x += dx / dl * maxD; this.mv.z += dz / dl * maxD; }

    const kd = this.onGround ? 7 : this.inWater ? 3 : PHYS.airDrag;
    const kf = Math.exp(-kd * dt);
    this.kb.x *= kf; this.kb.z *= kf;

    // ---- vertical
    if (this.inWater) {
      const target = 1.25; // float with chest at the surface
      this.vy += (depth > target ? (depth - target) * 26 : -PHYS.gravity * 0.45) * dt;
      this.vy *= Math.exp(-2.6 * dt);
      if (inp.jump && depth < 1.7) this.vy = Math.max(this.vy, 5.6);
    } else {
      this.vy -= PHYS.gravity * (now < this.floatUntil ? PHYS.liftGravScale : 1) * dt;
    }
    // jump: forgiving timing (a press just before landing, or just after running off an edge, still works)
    if (inp.jump && !this.jumpHeld) this.jumpBuf = PHYS.jumpBufferMs / 1000;
    this.jumpHeld = !!inp.jump;
    this.jumpBuf -= dt;
    this.airT = this.onGround ? 0 : this.airT + dt;
    const canJump = this.onGround || (this.airT < PHYS.coyoteMs / 1000 && this.vy <= 0);
    if (canJump && (inp.jump || this.jumpBuf > 0) && !this.inWater) {
      this.vy = PHYS.jumpV;
      this.onGround = false;
      this.airT = 1;
      this.jumpBuf = 0;
      this.events.push('jump');
    }

    // ---- move XZ then resolve
    p.x += (this.mv.x + this.kb.x) * dt;
    p.z += (this.mv.z + this.kb.z) * dt;
    this.resolveHorizontal();
    this.resolveHorizontal();

    // ---- move Y then resolve
    const prevY = p.y;
    const wasGround = this.onGround;
    p.y += this.vy * dt;
    const support = this.supportAt(p.x, p.z, prevY);
    this.onGround = false;
    if (p.y <= support && this.vy <= 0) {
      if (!wasGround && this.vy < -4) this.events.push('land:' + (-this.vy).toFixed(1));
      p.y = support;
      this.vy = 0;
      this.onGround = true;
    } else if (wasGround && this.vy <= 0 && p.y - support < 0.3 && !this.inWater) {
      p.y = support; // stick to slopes when walking down
      this.vy = 0;
      this.onGround = true;
    }
    if (this.vy > PHYS.maxVy) this.vy = PHYS.maxVy;
  }

  supportAt(x, z, prevY) {
    let s = this.terrainAt(x, z);
    const rr = R * 0.85;
    for (const b of this.col) {
      if (b.noStand || b.maxY > prevY + STEP) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < rr * rr && b.maxY > s) s = b.maxY;
    }
    return s;
  }

  resolveHorizontal() {
    const p = this.pos;
    for (const b of this.col) {
      const blocksAbove = b.noStand ? b.maxY > p.y + 0.01 : b.maxY > p.y + STEP;
      if (!blocksAbove || b.minY > p.y + this.height) continue;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      let nx, nz, push;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d; push = R - d;
      } else {
        // centre inside the box: push out through the nearest side
        const opts = [[p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0], [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1]];
        opts.sort((a, b2) => a[0] - b2[0]);
        [push, nx, nz] = opts[0];
        push += R;
      }
      p.x += nx * push; p.z += nz * push;
      for (const v of [this.mv, this.kb]) {
        const dot = v.x * nx + v.z * nz;
        if (dot < 0) { v.x -= dot * nx; v.z -= dot * nz; }
      }
    }
  }
}
