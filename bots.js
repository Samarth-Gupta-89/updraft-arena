// Server-side bots. They use the same physics, guns, ammo and pickups as real players.
import { Controller } from './public/js/physics.js';
import {
  ARENA, PLAYER, GUNS, MAX_AMMO, PICKUP_RADIUS, WATER_LEVEL, KILL_Y,
  heightAt, inArena, buildColliders, rayAABB, rayStatic,
} from './public/js/shared/map.js';

const COLLIDERS = buildColliders();

// react: seconds before shooting a newly seen target; aimErr: radians of random aim error;
// fireMul: slows the gun's fire rate; tactics: positions so pushes send targets toward a wall.
export const BOT_LEVELS = {
  easy:   { label: 'Easy',   react: 0.9,  aimErr: 0.11,  fireMul: 2.2, speed: 0.75, sprint: false, turn: 2.5, range: 32, strafe: 0,   tactics: false, lead: 0 },
  medium: { label: 'Medium', react: 0.5,  aimErr: 0.05,  fireMul: 1.4, speed: 1,    sprint: false, turn: 5,   range: 48, strafe: 0.5, tactics: false, lead: 0.5 },
  hard:   { label: 'Hard',   react: 0.22, aimErr: 0.022, fireMul: 1.0, speed: 1,    sprint: true,  turn: 10,  range: 70, strafe: 1,   tactics: true,  lead: 1 },
};

const NAMES = ['Nova', 'Bolt', 'Echo', 'Viper', 'Blaze', 'Orbit', 'Pixel', 'Rex', 'Frost', 'Zed', 'Kilo', 'Juno'];

export function botName(room) {
  const used = new Set([...room.players.values()].map((p) => p.name));
  const free = NAMES.filter((n) => !used.has(`${n} (bot)`));
  const base = free.length ? free[Math.floor(Math.random() * free.length)] : `Bot${Math.floor(Math.random() * 900 + 100)}`;
  return `${base} (bot)`;
}

export function makeBrain(level) {
  return {
    level, L: BOT_LEVELS[level], ctrl: new Controller(COLLIDERS),
    yaw: 0, pitch: 0, target: 0, visible: false, seenFor: 0, think: 0,
    nextFire: { L: 0, P: 0 }, wander: null, strafeDir: 1, strafeT: 0,
    stuckT: 0, lastPos: null, detour: null, detourT: 0, jumpNext: false,
  };
}

export function resetBrain(B, p, yaw) {
  B.ctrl.spawn(p);
  Object.assign(B, { yaw, pitch: 0, target: 0, visible: false, seenFor: 0, think: 0.3, wander: null, detour: null, detourT: 0, lastPos: null });
}

const hitHeight = (pl) => ((pl.f & 8) ? PLAYER.crouchHitbox : PLAYER.hitHeight);
const eyeOf = (p) => ({ x: p[0], y: p[1] + PLAYER.eye, z: p[2] });

function canSee(eye, q) {
  const tx = q[0] - eye.x, ty = q[1] + 0.9 - eye.y, tz = q[2] - eye.z;
  const dist = Math.hypot(tx, ty, tz) || 1;
  return rayStatic(eye, { x: tx / dist, y: ty / dist, z: tz / dist }, dist, COLLIDERS) >= dist - 0.3;
}

// unit vector from p toward its nearest wall, plus the distance
function nearestWall(p) {
  const opts = [[ARENA.halfX - p[0], 1, 0], [p[0] + ARENA.halfX, -1, 0], [ARENA.halfZ - p[2], 0, 1], [p[2] + ARENA.halfZ, 0, -1]];
  opts.sort((a, b) => a[0] - b[0]);
  return { dist: opts[0][0], x: opts[0][1], z: opts[0][2] };
}

function freeSpot(x, z) {
  if (heightAt(x, z) < WATER_LEVEL + 0.2) return false;
  for (const c of COLLIDERS) if (x > c.minX - 0.8 && x < c.maxX + 0.8 && z > c.minZ - 0.8 && z < c.maxZ + 0.8) return false;
  return true;
}
function randomSpot() {
  for (let i = 0; i < 30; i++) {
    const x = (Math.random() * 2 - 1) * (ARENA.halfX - 4), z = (Math.random() * 2 - 1) * (ARENA.halfZ - 4);
    if (freeSpot(x, z)) return { x, z };
  }
  return { x: 0, z: -12 };
}
const clampArena = (x, z) => ({
  x: Math.max(-ARENA.halfX + 3, Math.min(ARENA.halfX - 3, x)),
  z: Math.max(-ARENA.halfZ + 3, Math.min(ARENA.halfZ - 3, z)),
});

// api: { isEnemy(a, b), fire(pl, g, o, e, d, target|null), kill(pl), pickups, takePickup(pl, pk) }
export function updateBot(room, pl, dt, api) {
  const B = pl.bot, L = B.L, c = B.ctrl;
  const t = Date.now();
  const me = [c.pos.x, c.pos.y, c.pos.z];
  const eye = eyeOf(me);

  // ---------------------------------------------------------------- pick a target
  B.think -= dt;
  if (B.think <= 0) {
    B.think = L.react * (0.6 + Math.random() * 0.8);
    let best = null, bestScore = Infinity, bestSeen = false;
    for (const o of room.players.values()) {
      if (o === pl || !o.alive || !api.isEnemy(pl, o)) continue;
      const d = Math.hypot(o.p[0] - me[0], o.p[2] - me[2]);
      if (d > L.range) continue;
      const seen = canSee(eye, o.p);
      let score = d + (seen ? 0 : 25) + (t < (o.protectUntil || 0) ? 40 : 0) - (o.id === B.target ? 5 : 0);
      if (score < bestScore) { bestScore = score; best = o; bestSeen = seen; }
    }
    const id = best ? best.id : 0;
    if (id !== B.target) { B.target = id; B.seenFor = 0; }
    B.visible = bestSeen;
  }
  let target = B.target ? room.players.get(B.target) : null;
  if (!target || !target.alive) { target = null; B.target = 0; B.visible = false; }
  B.seenFor = target && B.visible ? B.seenFor + dt : 0;

  // ---------------------------------------------------------------- where to go
  let goal = null;
  const need = pl.ammo.L === 0 && pl.ammo.P === 0 ? 'any' : pl.ammo.L < 4 ? 'L' : pl.ammo.P < 3 ? 'P' : null;
  if (need) {
    let bd = 60;
    for (const pk of api.pickups) {
      if (!pk.active || (need !== 'any' && pk.type !== need) || pl.ammo[pk.type] >= MAX_AMMO) continue;
      const d = Math.hypot(pk.x - me[0], pk.z - me[2]);
      if (d < bd) { bd = d; goal = { x: pk.x, z: pk.z, exact: true }; }
    }
  }
  if (!goal && target) {
    if (L.tactics) {
      const w = nearestWall(target.p); // stand on the far side so shots push the target toward the wall
      goal = clampArena(target.p[0] - w.x * 9, target.p[2] - w.z * 9);
    } else {
      const want = L === BOT_LEVELS.easy ? 14 : 11;
      const dx = me[0] - target.p[0], dz = me[2] - target.p[2], l = Math.hypot(dx, dz) || 1;
      goal = clampArena(target.p[0] + (dx / l) * want, target.p[2] + (dz / l) * want);
    }
  }
  if (!goal) {
    if (!B.wander || Math.hypot(B.wander.x - me[0], B.wander.z - me[2]) < 2) B.wander = randomSpot();
    goal = B.wander;
  }

  // ---------------------------------------------------------------- steering
  let mx = goal.x - me[0], mz = goal.z - me[2];
  const gd = Math.hypot(mx, mz);
  if (gd < (goal.exact ? 0.3 : 1.5)) { mx = 0; mz = 0; } else { mx /= gd; mz /= gd; }
  if (target && B.visible && L.strafe > 0) {
    B.strafeT -= dt;
    if (B.strafeT <= 0) { B.strafeDir = Math.random() < 0.5 ? -1 : 1; B.strafeT = 0.7 + Math.random(); }
    const tx = target.p[0] - me[0], tz = target.p[2] - me[2], tl = Math.hypot(tx, tz) || 1;
    mx += (-tz / tl) * B.strafeDir * L.strafe * 0.8;
    mz += (tx / tl) * B.strafeDir * L.strafe * 0.8;
  }
  // stuck on cover? take a short random detour and hop
  B.stuckT += dt;
  if (B.stuckT > 0.5) {
    if (B.lastPos && Math.hypot(mx, mz) > 0.5 && c.onGround && Math.hypot(me[0] - B.lastPos[0], me[2] - B.lastPos[1]) < 0.6) {
      const a = Math.random() * Math.PI * 2;
      B.detour = { x: Math.cos(a), z: Math.sin(a) };
      B.detourT = 0.8;
      B.jumpNext = true;
    }
    B.lastPos = [me[0], me[2]];
    B.stuckT = 0;
  }
  if (B.detourT > 0) { B.detourT -= dt; mx = B.detour.x; mz = B.detour.z; }
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }

  // ---------------------------------------------------------------- look
  let aim = null;
  if (target && B.visible) {
    const v = target.v || [0, 0, 0];
    const lead = L.lead * (0.08 + Math.hypot(target.p[0] - me[0], target.p[2] - me[2]) / 120);
    aim = { x: target.p[0] + v[0] * lead, y: target.p[1] + hitHeight(target) * 0.5 + v[1] * lead * 0.5, z: target.p[2] + v[2] * lead };
  }
  let wantYaw = B.yaw, wantPitch = 0;
  if (aim) {
    const dx = aim.x - eye.x, dy = aim.y - eye.y, dz = aim.z - eye.z;
    wantYaw = Math.atan2(-dx, -dz);
    wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
  } else if (ml > 0.1) {
    wantYaw = Math.atan2(-mx, -mz);
  }
  const dyaw = Math.atan2(Math.sin(wantYaw - B.yaw), Math.cos(wantYaw - B.yaw));
  const maxTurn = L.turn * dt;
  B.yaw += Math.max(-maxTurn, Math.min(maxTurn, dyaw));
  B.pitch += Math.max(-maxTurn, Math.min(maxTurn, wantPitch - B.pitch));

  // ---------------------------------------------------------------- move (input is relative to facing)
  const s = Math.sin(B.yaw), co = Math.cos(B.yaw);
  const input = {
    f: (-mx * s - mz * co) * L.speed,
    r: (mx * co - mz * s) * L.speed,
    jump: B.jumpNext || c.inWater,
    sprint: L.sprint && !B.visible,
  };
  B.jumpNext = false;
  c.update(dt, input, B.yaw);
  c.events.length = 0;
  pl.p = [c.pos.x, c.pos.y, c.pos.z];
  pl.ya = B.yaw;
  pl.pi = B.pitch;
  pl.f = (c.floating ? 1 : 0) | (c.inWater ? 2 : 0) | (c.onGround ? 4 : 0);
  if (c.pos.y < KILL_Y) { api.kill(pl); return; }

  for (const pk of api.pickups) {
    if (pk.active && pl.ammo[pk.type] < MAX_AMMO && Math.hypot(pk.x - c.pos.x, pk.z - c.pos.z) < PICKUP_RADIUS) api.takePickup(pl, pk);
  }

  // ---------------------------------------------------------------- shoot
  if (!aim || B.seenFor < L.react || Math.abs(dyaw) > 0.25) return;
  const ground = inArena(target.p[0], target.p[2]) ? heightAt(target.p[0], target.p[2]) : -99;
  const height = target.p[1] - ground;
  const airborne = (target.f & 4) === 0 && height > 0.6;
  let g;
  if (L === BOT_LEVELS.easy) g = Math.random() < 0.65 ? 'L' : 'P';
  else if (L.tactics) g = airborne && (height > 3.2 || (nearestWall(target.p).dist < 9 && height > 1.2)) ? 'P' : 'L';
  else g = airborne && height > 2.2 ? 'P' : 'L';
  if (pl.ammo[g] <= 0) g = g === 'L' ? 'P' : 'L';
  if (pl.ammo[g] <= 0 || t < B.nextFire[g]) return;
  B.nextFire[g] = t + GUNS[g].interval * 1000 * L.fireMul * (0.9 + Math.random() * 0.3);

  const err = () => (Math.random() + Math.random() - 1) * L.aimErr;
  const yaw = B.yaw + err(), pitch = B.pitch + err() * 0.7;
  const dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  const tStatic = rayStatic(eye, dir, 150, COLLIDERS);
  const q = target.p;
  const tHit = rayAABB(eye, dir, q[0] - PLAYER.hitHalf, q[1], q[2] - PLAYER.hitHalf, q[0] + PLAYER.hitHalf, q[1] + hitHeight(target), q[2] + PLAYER.hitHalf);
  const hit = tHit !== null && tHit < tStatic;
  const dist = hit ? tHit : tStatic;
  api.fire(pl, g, [eye.x, eye.y, eye.z], [eye.x + dir.x * dist, eye.y + dir.y * dist, eye.z + dir.z * dist], [dir.x, dir.y, dir.z], hit ? target : null);
}
