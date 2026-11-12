// Shared map + gameplay rules. Imported by the Node server AND the browser.
// Keep this file free of imports so both sides can load it.

// The arena follows the outlined courtyard at the Isha Yoga Center: a four-sided yard with the Nandi,
// two ponds joined under a bridge, and a wall along the outline. poly = corners (x, z), going round.
export const ARENA = {
  halfX: 65, halfZ: 42, wallH: 4.5, wallT: 0.8,
  poly: [[-65, -29], [44, -42], [65, 12], [-35, 42]],
};
// one entry per wall: start, end, length, unit direction (t) and unit normal pointing into the arena (n)
export const EDGES = ARENA.poly.map((a, i, arr) => {
  const b = arr[(i + 1) % arr.length];
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  return { ax: a[0], az: a[1], bx: b[0], bz: b[1], len, tx: dx / len, tz: dz / len, nx: -dz / len, nz: dx / len };
});
// distance to the nearest wall: positive inside the arena, negative outside
export function edgeDist(x, z) {
  let m = Infinity;
  for (const e of EDGES) m = Math.min(m, (x - e.ax) * e.nx + (z - e.az) * e.nz);
  return m;
}
export const WATER_LEVEL = -0.6;
export const KILL_Y = -14;
// crouched players (C key) are short enough to hide behind the low walls
export const PLAYER = { radius: 0.4, height: 2.25, eye: 2.0, crouchHeight: 1.5, crouchEye: 1.3, crouchHitbox: 1.55, hitHeight: 2.4, hitHalf: 1.1 };
// two looks: 'egg' (wide cartoon egg) and 'human' (a person, drawn 1.5x life size). The target box and eye height match the look.
export const BODY = {
  egg: { half: PLAYER.hitHalf, h: PLAYER.hitHeight, crouchH: PLAYER.crouchHitbox, eye: PLAYER.eye, crouchEye: PLAYER.crouchEye, head: 1.75, crouchHead: 1.12 },
  human: { half: 0.98, h: 3.61, crouchH: 2.54, eye: 3.16, crouchEye: 2.05, head: 2.86, crouchHead: 2.0 }, // drawn 1.95x life size
};
export const bodyOf = (look) => BODY[look === 'human' ? 'human' : 'egg'];
// Headshot: a shot that lands this high above the target's feet (the head / the egg's face and up) counts double.
// A LIFTER headshot throws them twice as high; a SHOVER headshot knocks them back twice as fast.
export const headFrom = (look, crouched) => (crouched ? bodyOf(look).crouchHead : bodyOf(look).head);
export const HEADSHOT_MULT = 2;
// Charged shot (SHOVER only): hold the right button for `ms`, then release. It uses `cost` ammo and knocks back
// `mult` times as fast. A charged headshot stacks, but never beyond maxMult.
export const CHARGE = { ms: 700, cost: 5, mult: 2, maxMult: 3 };

export const MAX_AMMO = 30;
export const PICKUP_AMOUNT = 15;
// Air dash power-up (pickup type 'D'): press Shift in the air to fly forward and up a little.
// It can carry you back in after being pushed over the wall.
export const DASH = { max: 3, give: 2, speed: 14, up: 8.5, cooldownMs: 350 };
export const maxOf = (type) => (type === 'D' ? DASH.max : MAX_AMMO);
export const giveOf = (type) => (type === 'D' ? DASH.give : PICKUP_AMOUNT);
export const fullAmmo = () => ({ L: MAX_AMMO, P: MAX_AMMO, D: 0 });
export const PICKUP_NAME = { L: 'LIFTER AMMO', P: 'SHOVER AMMO', D: 'AIR DASH' };
// Shield (hold F): stops shots that come at your front. Every blocked shot uses 1 charge; at 0 it breaks.
// It refills 1 charge every regenMs while lowered, and a broken shield needs minToRaise charges before it works again.
// Shots from behind always get through, and the SHOVER cannot be fired while the shield is up.
export const SHIELD = { max: 10, regenMs: 1500, minToRaise: 3 };
// yaw: where the shielded player faces; d: direction the shot is travelling. True = it meets the shield.
export const shieldBlocks = (yaw, d) => -Math.sin(yaw) * d[0] - Math.cos(yaw) * d[2] < 0;
export const PICKUP_RESPAWN_MS = 12000;
export const PICKUP_RADIUS = 1.6;

// L = lift gun (left mouse), P = push gun (right mouse)
export const GUNS = {
  L: { name: 'LIFTER', interval: 0.2 },
  P: { name: 'SHOVER', interval: 0.45 },
};

export const PHYS = {
  // heavier gravity + a stronger jump: about the same jump height as before, but quicker and snappier
  gravity: 30,
  jumpV: 9.4,
  walk: 7.5,
  sprint: 15.75,       // 50% faster than before
  airAccel: 14,        // steering in the air (was 9)
  coyoteMs: 110,       // you can still jump this long after running off an edge
  jumpBufferMs: 130,   // a jump pressed just before landing still counts
  swim: 3.4,
  crouchSpeed: 3.0,
  // every lift hit throws the target up by the same height; then plain gravity brings them down.
  // 3 quick hits put a player above the 4.5 m wall, then a push carries them over it.
  liftHeight: 2.0,     // metres a lift hit raises the target from where they are
  liftFloatMs: 700,    // how long the "lifted" ring / HUD note shows (no effect on gravity)
  maxVy: 18,
  pushV: 11,           // speed a push hit adds along the shot's direction
  pushUp: 2.5,         // small pop so the target leaves the ground
  maxKb: 18,
  friction: 25,        // m/s^2 the ground takes off a sliding (knocked back) player; in the air nothing slows them
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
// two ponds (north = bigger) and the narrow channel that joins them; a flat courtyard everywhere else
export const PONDS = [
  { x: 16, z: -15, rx: 12, rz: 8 },
  { x: 21, z: 8, rx: 9.5, rz: 6.5 },
  { x: 18.5, z: -3.5, rx: 3.5, rz: 6 },
];
export const POND_DEPTH = 2.6;
// arched stone bridge over the channel, running west-east
export const BRIDGE = { x: 18.5, z: -3.5, halfLen: 7.5, halfW: 2.4, rise: 1.0 };
export const bridgeArch = (dx) => BRIDGE.rise * Math.cos((Math.min(1, Math.abs(dx) / BRIDGE.halfLen) * Math.PI) / 2);

export function inArena(x, z) {
  return edgeDist(x, z) >= 0;
}

// the ground without the bridge (what the terrain mesh shows)
export function groundAt(x, z) {
  let h = (fbm(x * 0.08, z * 0.08, 3) - 0.5) * 0.4;
  let t = 0;
  const wob = (noise2(x * 0.25, z * 0.25, 99) - 0.5) * 0.2;
  for (const k of PONDS) {
    const px = (x - k.x) / k.rx, pz = (z - k.z) / k.rz;
    t = Math.max(t, 1 - smooth(0.55, 1.0, Math.sqrt(px * px + pz * pz) + wob));
  }
  h = h * (1 - t) - POND_DEPTH * t;
  return h * smooth(0, 5, edgeDist(x, z));
}

// what players stand on: the ground, or the bridge deck where it crosses the channel
export function heightAt(x, z) {
  const h = groundAt(x, z);
  if (Math.abs(z - BRIDGE.z) <= BRIDGE.halfW && Math.abs(x - BRIDGE.x) < BRIDGE.halfLen) return Math.max(h, bridgeArch(x - BRIDGE.x));
  return h;
}

// ---------------------------------------------------------------- cover
const CR = 1.4; // crate size
const C = (type, x, z, w, d, h, lvl = 0, extra = {}) => ({ type, x, z, w, d, h, lvl, ...extra });

// four walls with 3 m doorways in the middle of the listed sides ('n' = -z, 's' = +z, 'w' = -x, 'e' = +x)
const WALL_T = 0.5;
function room(cx, cz, w, d, h, doors) {
  const out = [], gap = 3;
  const side = (alongX, x, z, len, door) => {
    const seg = (px, pz, l) => out.push(alongX ? C('block', px, pz, l, WALL_T, h) : C('block', px, pz, WALL_T, l, h));
    if (!door) { seg(x, z, len); return; }
    const part = (len - gap) / 2, off = (gap + part) / 2;
    for (const s of [-1, 1]) seg(alongX ? x + s * off : x, alongX ? z : z + s * off, part);
  };
  side(true, cx, cz - d / 2, w, doors.includes('n'));
  side(true, cx, cz + d / 2, w, doors.includes('s'));
  side(false, cx - w / 2, cz, d, doors.includes('w'));
  side(false, cx + w / 2, cz, d, doors.includes('e'));
  return out;
}

// a point `inset` metres inside wall number `edge`, `t` of the way along it (0..1)
const alongWall = (edge, t, inset) => {
  const e = EDGES[edge];
  return [e.ax + e.tx * e.len * t + e.nx * inset, e.az + e.tz * e.len * t + e.nz * inset];
};

export const NANDI = { x: -22, z: 2 }; // faces west, toward the temple

export const COVER = [
  // ---- the Nandi on its stone platform (you can stand on both)
  C('stone', NANDI.x, NANDI.z, 11, 6.5, 0.9),
  C('nandi', NANDI.x - 0.3, NANDI.z, 7.4, 3.0, 3.6, 0, { lift: 0.9 }),
  // low walls beside the Nandi
  C('block', -22, -8, 8, WALL_T, 1.6),
  C('block', -22, 12, 8, WALL_T, 1.6),
  // ---- open-top rooms (no ceiling, so anyone inside can still be lifted out)
  ...room(-44, -22, 10, 7, 3.2, ['e', 's']),  // west building
  ...room(-30, 24, 9, 8, 3.2, ['n', 'e']),    // south-west building
  ...room(30, -34, 9, 7, 3.2, ['s', 'w']),    // north-east room
  // L-shaped hiding corner south of the ponds
  C('block', 2, 22, 7, WALL_T, 2.6), C('block', 5.25, 24.5, WALL_T, 5, 2.6),
  // ---- hiding walls here and there, of different heights
  C('block', -36, 4, WALL_T, 7, 2.6),
  C('block', -6, -14, WALL_T, 6, 2.4),
  C('block', -4, 10, 6, WALL_T, 2.4),
  C('block', -30, -24, 7, WALL_T, 2.2),
  C('block', -8, -30, WALL_T, 6, 3),
  C('block', 10, -33, 6, WALL_T, 1.5),
  C('block', -12, 30, 7, WALL_T, 2.4),
  C('block', 10, 27, WALL_T, 5, 1.6),
  C('block', 44, 6, WALL_T, 6, 2.2),
  C('block', 40, -12, WALL_T, 6, 2.4),
  C('block', 36, 0, 5, WALL_T, 1.5),
  // stone planter between the Nandi and the ponds
  C('stone', -8, -2, 3, 3, 1.2),
  // ---- pillars of the east pavilion (roof left off)
  ...[0.45, 0.55, 0.65, 0.75, 0.85, 0.95].map((t) => { const [x, z] = alongWall(1, t, 3); return C('block', x, z, 1, 1, 4); }),
  // rocks at the water's edge
  C('rock', 3, -12, 3.0, 2.4, 1.7),
  C('rock', 30.5, -22, 2.6, 2.2, 1.5),
  C('rock', 33, 10, 3.0, 3.0, 1.9),
  C('rock', 12, 15, 2.6, 2.4, 1.6),
  // palm trees (collider is the trunk)
  C('tree', -56, -26, 0.6, 0.6, 9),
  C('tree', -42, -5, 0.6, 0.6, 9),
  C('tree', -10, 16, 0.6, 0.6, 9),
  C('tree', -2, -22, 0.6, 0.6, 9),
  C('tree', 40, -34, 0.6, 0.6, 9),
  C('tree', 30, 18, 0.6, 0.6, 9),
  C('tree', -20, 34, 0.6, 0.6, 9),
  C('tree', 6, 2, 0.6, 0.6, 9),
];

// ---------------------------------------------------------------- spawns & pickups
const faceCentre = (x, z) => Math.atan2(x, z);
const spawnRow = (edge, ts, inset, yaw) => ts.map((t) => { const [x, z] = alongWall(edge, t, inset); return { x, z, yaw }; });
export const SPAWNS = {
  // team A starts along the west wall, team B along the east wall
  A: [...spawnRow(3, [0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85], 5, -Math.PI / 2), ...spawnRow(3, [0.5], 11, -Math.PI / 2)],
  B: spawnRow(1, [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], 8, Math.PI / 2),
};
export const DM_SPAWNS = [
  ...SPAWNS.A, ...SPAWNS.B,
  ...[[-10, -6], [0, 14], [-14, -20], [4, -26], [36, -6]].map(([x, z]) => ({ x, z, yaw: faceCentre(x, z) })),
];

export const PICKUPS = [
  { id: 1, type: 'L', x: -34, z: -6 },
  { id: 2, type: 'L', x: 40, z: -4 },
  { id: 3, type: 'P', x: -12, z: -16 },
  { id: 4, type: 'P', x: 2, z: 6 },
  { id: 5, type: 'L', x: 18.5, z: -3.5 },   // on top of the bridge
  { id: 6, type: 'P', x: -22, z: -13 },
  { id: 7, type: 'L', x: -14, z: 24 },
  { id: 8, type: 'L', x: 8, z: -29 },
  { id: 9, type: 'P', x: -52, z: -8 },
  { id: 10, type: 'P', x: 52, z: 1.5 },
  { id: 11, type: 'L', x: 36, z: 14 },
  { id: 12, type: 'P', x: -4, z: 27 },
  // air dash power-ups sit in the rooms and hiding corners
  { id: 13, type: 'D', x: -44, z: -22 },
  { id: 14, type: 'D', x: -30, z: 24 },
  { id: 15, type: 'D', x: 30, z: -34 },
  { id: 16, type: 'D', x: 2, z: 24.5 },
  { id: 17, type: 'D', x: -22, z: 9 },
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
  for (const e of EDGES) {
    const dn = d.x * e.nx + d.z * e.nz;
    if (Math.abs(dn) < 1e-9) continue;
    const t = -((o.x - e.ax) * e.nx + (o.z - e.az) * e.nz) / dn;
    if (t <= 0 || t >= best) continue;
    const y = o.y + d.y * t;
    if (y < -1 || y > ARENA.wallH) continue;
    const al = (o.x + d.x * t - e.ax) * e.tx + (o.z + d.z * t - e.az) * e.tz;
    if (al >= -ARENA.wallT && al <= e.len + ARENA.wallT) best = t;
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
    const base = groundUnder(c.x, c.z, c.w, c.d) + c.lvl * c.h + (c.lift || 0);
    const shrink = c.type === 'rock' ? 0.85 : 1;
    const w = c.w * shrink, d = c.d * shrink;
    out.push({
      type: c.type, ref: c, base,
      minX: c.x - w / 2, maxX: c.x + w / 2,
      minZ: c.z - d / 2, maxZ: c.z + d / 2,
      minY: c.type === 'block' ? base - 1 : base, maxY: base + c.h * (c.type === 'rock' ? 0.92 : 1),
      noStand: c.type === 'tree',
    });
  }
  return out; // the boundary wall follows the outline, so it is handled with EDGES (see physics.js and rayStatic)
}
