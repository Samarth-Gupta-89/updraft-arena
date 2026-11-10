// Shared map + gameplay rules. Imported by the Node server AND the browser.
// Keep this file free of imports so both sides can load it.

export const ARENA = { halfX: 42, halfZ: 32, wallH: 4.5, wallT: 0.8 };
export const WATER_LEVEL = -0.6;
export const KILL_Y = -14;
// crouched players (C key) are short enough to hide behind the 1.7 m concrete barriers
// players are drawn comically wide and 25% taller than life, so they are easy targets
export const PLAYER = { radius: 0.4, height: 2.25, eye: 2.0, crouchHeight: 1.5, crouchEye: 1.3, crouchHitbox: 1.55, hitHeight: 2.4, hitHalf: 1.1 };

export const MAX_AMMO = 20;
export const PICKUP_AMOUNT = 10;
export const PICKUP_RESPAWN_MS = 12000;
export const PICKUP_RADIUS = 1.6;

// L = lift gun (left mouse), P = push gun (right mouse)
export const GUNS = {
  L: { name: 'LIFTER', interval: 0.2 },
  P: { name: 'SHOVER', interval: 0.45 },
};

export const PHYS = {
  gravity: 24,
  jumpV: 8.2,
  walk: 6.5,
  sprint: 9.5,
  swim: 3.4,
  crouchSpeed: 3.0,
  // tuned so ~3 quick lift hits put a player just above the wall, then a push carries them ~10 m
  liftV: 4.8,          // upward speed added per lift hit (stacks)
  liftFloatMs: 1200,   // reduced gravity after a lift hit
  liftGravScale: 0.55,
  maxVy: 18,
  pushV: 10,           // horizontal knockback per push hit
  pushUp: 2.5,
  maxKb: 18,
  airDrag: 0.5,        // how fast knockback fades in the air (per second)
};

export const MATCH = {
  dmKills: 15,
  teamKills: 25,
  timeMs: 7 * 60 * 1000,
  respawnMs: 3000,
  protectMs: 2000,
  creditMs: 10000,     // last hitter within this window gets the knockout
  lobbyAfterEndMs: 12000,
};

export const MODES = {
  dm: { label: 'Deathmatch', max: 10 },
  team: { label: 'Team Battle', max: 10, perTeam: 5 },
};

export const TEAMS = {
  A: { name: 'Red', color: '#e5483d' },
  B: { name: 'Blue', color: '#3b82e6' },
};

export const DM_COLORS = ['#e5483d', '#3b82e6', '#f2c230', '#3fbf6f', '#b05be8', '#f07f2e', '#2ec9c4', '#e85ba8', '#9aa63a', '#f0f0f0'];

// ---------------------------------------------------------------- noise
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function noise2(x, z, seed = 1) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x, z, oct = 4, seed = 7) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * noise2(x * f, z * f, seed + i * 31);
    n += amp; amp *= 0.5; f *= 2;
  }
  return s / n;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- terrain
const HILLS = [
  { x: -24, z: -15, r: 7, h: 2.0 },
  { x: 25, z: -12, r: 6, h: 1.6 },
  { x: -28, z: 20, r: 5.5, h: 1.3 },
  { x: 21, z: 23, r: 6, h: 1.7 },
  { x: -8, z: -21, r: 8, h: 1.0 },
];
export const POND = { x: 2, z: 15, rx: 11, rz: 7, depth: 2.8 };

export function inArena(x, z) {
  return Math.abs(x) <= ARENA.halfX && Math.abs(z) <= ARENA.halfZ;
}

export function heightAt(x, z) {
  let h = 0;
  for (const k of HILLS) {
    const dx = x - k.x, dz = z - k.z;
    h += k.h * Math.exp(-(dx * dx + dz * dz) / (k.r * k.r));
  }
  h += (fbm(x * 0.08, z * 0.08, 3) - 0.5) * 0.7;
  const px = (x - POND.x) / POND.rx, pz = (z - POND.z) / POND.rz;
  const pd = Math.sqrt(px * px + pz * pz) + (noise2(x * 0.25, z * 0.25, 99) - 0.5) * 0.25;
  const t = 1 - smooth(0.55, 1.0, pd);
  h = h * (1 - t) - POND.depth * t;
  const edge = Math.min(ARENA.halfX - Math.abs(x), ARENA.halfZ - Math.abs(z));
  return h * smooth(0, 5, edge);
}

// ---------------------------------------------------------------- cover
const CR = 1.4; // crate size
const C = (type, x, z, w, d, h, lvl = 0, extra = {}) => ({ type, x, z, w, d, h, lvl, ...extra });

export const COVER = [
  // centre
  C('container', 0, -3, 2.5, 6.1, 2.6, 0, { color: 0 }),
  C('crate', 3.0, -5.2, CR, CR, CR),
  C('crate', 3.0, -5.2, CR, CR, CR, 1),
  C('crate', 3.1, -3.6, CR, CR, CR),
  C('crate', -3.0, -0.6, CR, CR, CR),
  // mid containers
  C('container', -16, -6, 6.1, 2.5, 2.6, 0, { color: 1 }),
  C('container', 15, 5, 6.1, 2.5, 2.6, 0, { color: 2 }),
  C('container', -11, -25, 6.1, 2.5, 2.6, 0, { color: 3 }),
  C('container', 13, -21, 2.5, 6.1, 2.6, 0, { color: 1 }),
  // crate clusters
  C('crate', -22, 6, CR, CR, CR),
  C('crate', -20.5, 6, CR, CR, CR),
  C('crate', -21.3, 7.5, CR, CR, CR),
  C('crate', -22, 6, CR, CR, CR, 1),
  C('crate', 24, 9, CR, CR, CR),
  C('crate', 24, 10.5, CR, CR, CR),
  C('crate', 25.5, 9.6, CR, CR, CR),
  C('crate', 24, 9, CR, CR, CR, 1),
  C('crate', 14.5, 18.5, CR, CR, CR),
  C('crate', -13, 23, CR, CR, CR),
  C('crate', -13, 23, CR, CR, CR, 1),
  // concrete barriers
  C('barrier', -32, -6, 0.7, 3.4, 1.7),
  C('barrier', -32, 6, 0.7, 3.4, 1.7),
  C('barrier', 32, -6, 0.7, 3.4, 1.7),
  C('barrier', 32, 6, 0.7, 3.4, 1.7),
  C('barrier', -29, 17, 3.4, 0.7, 1.7),
  C('barrier', 29, -17, 3.4, 0.7, 1.7),
  C('barrier', -7, 8.5, 3.4, 0.7, 1.7),
  // rocks
  C('rock', -5, 26, 3.2, 2.6, 1.9),
  C('rock', 8, -12, 2.6, 2.2, 1.5),
  C('rock', 35, 24, 3.0, 3.0, 2.1),
  C('rock', -35, -24, 3.0, 3.0, 2.1),
  // trees (collider is the trunk)
  C('tree', -39.5, 29.5, 0.6, 0.6, 9),
  C('tree', 39.5, -29.5, 0.6, 0.6, 9),
  C('tree', -21, -29, 0.6, 0.6, 9),
  C('tree', 23, 29, 0.6, 0.6, 9),
  C('tree', 30, -28, 0.6, 0.6, 9),
  C('tree', -31, 28, 0.6, 0.6, 9),
  C('tree', 10, 25, 0.6, 0.6, 9),
];

// ---------------------------------------------------------------- spawns & pickups
const ZS = [-24, -17, -10, -3, 4, 11, 18, 25];
const faceCentre = (x, z) => Math.atan2(x, z);
export const SPAWNS = {
  A: ZS.map((z) => ({ x: -37.5, z, yaw: -Math.PI / 2 })),
  B: ZS.map((z) => ({ x: 37.5, z, yaw: Math.PI / 2 })),
};
export const DM_SPAWNS = [
  ...SPAWNS.A, ...SPAWNS.B,
  ...[[-20, -16], [16, -10], [-14, 14], [6, 28], [-2, -14]].map(([x, z]) => ({ x, z, yaw: faceCentre(x, z) })),
];

export const PICKUPS = [
  { id: 1, type: 'L', x: -27, z: 0 },
  { id: 2, type: 'L', x: 27, z: 0 },
  { id: 3, type: 'P', x: -14, z: -14 },
  { id: 4, type: 'P', x: 14, z: -12 },
  { id: 5, type: 'L', x: 0, z: 5 },
  { id: 6, type: 'P', x: 0, z: -11 },
  { id: 7, type: 'L', x: -20, z: 26 },
  { id: 8, type: 'L', x: 20, z: -27 },
  { id: 9, type: 'P', x: -36, z: -20 },
  { id: 10, type: 'P', x: 36, z: 20 },
];

// ---------------------------------------------------------------- ray casting (shared by client shots and server bots)
// o, d: {x, y, z}; returns distance along the ray or null
export function rayAABB(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = Infinity;
  const ax = [[o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ]];
  for (const [oo, dd, mn, mx] of ax) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < mn || oo > mx) return null;
    } else {
      let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

// distance to the first wall/cover/terrain hit, capped at maxT
export function rayStatic(o, d, maxT, colliders) {
  let best = maxT;
  for (const b of colliders) {
    const t = rayAABB(o, d, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
    if (t !== null && t < best) best = t;
  }
  const step = 0.5;
  for (let t = step; t < best; t += step) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (!inArena(x, z)) { if (y < -2) break; continue; }
    if (y < heightAt(x, z)) {
      let lo = t - step, hi = t;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (o.y + d.y * mid < heightAt(o.x + d.x * mid, o.z + d.z * mid)) hi = mid; else lo = mid;
      }
      return Math.min(best, hi);
    }
  }
  return best;
}

// ---------------------------------------------------------------- colliders (AABBs)
function groundUnder(x, z, w, d) {
  let m = heightAt(x, z);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m = Math.min(m, heightAt(x + sx * w / 2, z + sz * d / 2));
  return m;
}

export function buildColliders() {
  const out = [];
  for (const c of COVER) {
    const base = groundUnder(c.x, c.z, c.w, c.d) + c.lvl * c.h;
    const shrink = c.type === 'rock' ? 0.85 : 1;
    const w = c.w * shrink, d = c.d * shrink;
    out.push({
      type: c.type, ref: c, base,
      minX: c.x - w / 2, maxX: c.x + w / 2,
      minZ: c.z - d / 2, maxZ: c.z + d / 2,
      minY: base, maxY: base + c.h * (c.type === 'rock' ? 0.92 : 1),
      noStand: c.type === 'tree',
    });
  }
  const { halfX: X, halfZ: Z, wallH: H, wallT: T } = ARENA;
  const wall = (minX, maxX, minZ, maxZ) => out.push({ type: 'wall', minX, maxX, minZ, maxZ, minY: -1, maxY: H, noStand: true });
  wall(-X - T, X + T, Z, Z + T);
  wall(-X - T, X + T, -Z - T, -Z);
  wall(X, X + T, -Z, Z);
  wall(-X - T, -X, -Z, Z);
  return out;
}
