// Updraft Arena — game server. Serves the web client and runs rooms over WebSocket.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  SPAWNS, DM_SPAWNS, PICKUPS, MAX_AMMO, maxOf, giveOf, fullAmmo, PICKUP_RESPAWN_MS, PICKUP_RADIUS,
  KILL_Y, GUNS, MATCH, MODES, DM_COLORS, heightAt,
} from './public/js/shared/map.js';
import { BOT_LEVELS, botName, makeBrain, resetBrain, updateBot } from './bots.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};

// The laptop's address on the local network, so a host on localhost can share a link friends on the same Wi-Fi can open.
function lanAddress() {
  const skip = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|docker|tailscale|zerotier/i;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
    }
  }
  return null;
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) ? p : null;
}

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (p === '/health') { res.writeHead(200).end('ok'); return; }
  if (p === '/api/audio') { // which ElevenLabs recordings are installed (the client falls back to synth for the rest)
    const list = (dir) => {
      try { return fs.readdirSync(path.join(PUBLIC, 'audio', dir)).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)); } catch { return []; }
    };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ voice: list('voice'), sfx: list('sfx') }));
    return;
  }
  if (p === '/api/lan') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ip: lanAddress() }));
    return;
  }
  let file;
  if (p === '/' || p === '/index.html') file = path.join(PUBLIC, 'index.html');
  else if (p.startsWith('/vendor/three/')) file = safeJoin(THREE_DIR, p.slice('/vendor/three/'.length));
  else file = safeJoin(PUBLIC, p.slice(1));
  if (!file) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------------------------------------------------------------- helpers
const rooms = new Map();
let nextId = 1;
const now = () => Date.now();
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function vec3(a) {
  if (!Array.isArray(a) || a.length !== 3) return null;
  const v = a.map(Number);
  return v.every((n) => Number.isFinite(n) && Math.abs(n) < 1e4) ? v : null;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function send(pl, msg) {
  if (pl.ws && pl.ws.readyState === 1) pl.ws.send(JSON.stringify(msg)); // bots have no socket
}
function broadcast(room, msg, except) {
  const s = JSON.stringify(msg);
  for (const p of room.players.values()) if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(s);
}
const humans = (room) => [...room.players.values()].filter((p) => !p.isBot);

function logPlayer(name, email) {
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  fs.appendFile(path.join(DATA_DIR, 'players.csv'), `${new Date().toISOString()},${esc(name)},${esc(email)}\n`, () => {});
}

// ---------------------------------------------------------------- rooms
function newCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function roomInfo(room) {
  return {
    code: room.code, mode: room.mode, hostId: room.hostId, state: room.state, scores: room.scores,
    timeLeft: room.state === 'playing' ? Math.max(0, room.endsAt - now()) : 0,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, color: p.color, kills: p.kills, deaths: p.deaths, alive: p.alive,
      bot: p.isBot ? p.botLevel : null, sex: p.sex || 'm', look: p.look || 'egg',
    })),
  };
}
const broadcastRoom = (room) => broadcast(room, { t: 'room', room: roomInfo(room) });

function teamCount(room, team) {
  let n = 0;
  for (const p of room.players.values()) if (p.team === team) n++;
  return n;
}

function joinRoom(pl, room) {
  leaveRoom(pl);
  pl.room = room;
  // two players can't share a name: the second "Sam" becomes "Sam 2"
  const taken = new Set([...room.players.values()].map((p) => p.name));
  const base = pl.baseName || pl.name;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  pl.name = name;
  if (room.mode === 'team') {
    pl.team = teamCount(room, 'A') <= teamCount(room, 'B') ? 'A' : 'B';
    pl.color = null;
  } else {
    const used = new Set([...room.players.values()].map((p) => p.color));
    pl.team = null;
    pl.color = DM_COLORS.find((c) => !used.has(c)) || DM_COLORS[0];
  }
  Object.assign(pl, { kills: 0, deaths: 0, alive: false, away: false, respawnAt: 0, ammo: fullAmmo(), lastHit: null });
  // someone who dropped out mid-match and came back keeps their score (matched by email)
  const saved = !pl.isBot && room.saved && room.saved.get(pl.email);
  if (saved) {
    pl.kills = saved.kills; pl.deaths = saved.deaths;
    if (room.mode === 'team' && saved.team && teamCount(room, saved.team) < MODES.team.perTeam) pl.team = saved.team;
    room.saved.delete(pl.email);
  }
  room.players.set(pl.id, pl);
  if (!pl.isBot && (!room.hostId || !room.players.has(room.hostId))) room.hostId = pl.id;
  room.emptySince = 0;
  send(pl, { t: 'joined', room: roomInfo(room) });
  broadcastRoom(room);
  if (room.state === 'playing') {
    send(pl, matchMsg(room));
    spawn(room, pl);
  }
}

function leaveRoom(pl) {
  const room = pl.room;
  if (!room) return;
  if (!pl.isBot && room.state === 'playing') (room.saved || (room.saved = new Map())).set(pl.email, { kills: pl.kills, deaths: pl.deaths, team: pl.team });
  room.players.delete(pl.id);
  pl.room = null;
  pl.alive = false;
  const people = humans(room);
  if (!people.length) { room.players.clear(); room.hostId = 0; room.emptySince = now(); return; } // only bots left: close up
  if (room.hostId === pl.id) room.hostId = people[0].id;
  broadcast(room, { t: 'gone', id: pl.id });
  broadcastRoom(room);
}

// ---------------------------------------------------------------- match flow
function matchMsg(room) {
  return { t: 'match', mode: room.mode, timeLeft: room.endsAt - now(), pickups: room.pickups.map(({ id, active }) => ({ id, active })) };
}

function startMatch(room) {
  room.state = 'playing';
  room.saved = new Map();
  room.scores = { A: 0, B: 0 };
  room.endsAt = now() + MATCH.timeMs;
  room.pickups = PICKUPS.map((p) => ({ ...p, active: true, respawnAt: 0 }));
  for (const p of room.players.values()) Object.assign(p, { kills: 0, deaths: 0, alive: false, lastHit: null });
  broadcast(room, matchMsg(room));
  for (const p of room.players.values()) spawn(room, p);
  broadcastRoom(room);
}

function pickSpawn(room, pl) {
  const list = room.mode === 'team' ? SPAWNS[pl.team] : DM_SPAWNS;
  const others = [...room.players.values()].filter((o) => o !== pl && o.alive);
  const scored = list.map((s) => {
    let d = 999;
    for (const o of others) d = Math.min(d, Math.hypot(o.p[0] - s.x, o.p[2] - s.z));
    return { s, d: d + Math.random() * 6 };
  }).sort((a, b) => b.d - a.d);
  return scored[0].s;
}

function spawn(room, pl) {
  const s = pickSpawn(room, pl);
  const t = now();
  Object.assign(pl, {
    alive: true, respawnAt: 0, lastHit: null, f: 0, ya: s.yaw, pi: 0,
    p: [s.x, heightAt(s.x, s.z) + 0.05, s.z],
    ammo: fullAmmo(), protectUntil: t + MATCH.protectMs, prevP: null, v: [0, 0, 0], lastS: t, away: false,
  });
  if (pl.isBot) resetBrain(pl.bot, pl.p, s.yaw);
  broadcast(room, { t: 'spawn', id: pl.id, p: pl.p, ya: s.yaw, prot: MATCH.protectMs });
  send(pl, { t: 'ammo', L: pl.ammo.L, P: pl.ammo.P, D: pl.ammo.D });
}

function kill(room, pl) {
  if (!pl.alive || room.state !== 'playing') return;
  const t = now();
  pl.alive = false;
  pl.deaths++;
  pl.respawnAt = t + MATCH.respawnMs;
  const lh = pl.lastHit;
  let killer = null;
  if (lh && t - lh.time < MATCH.creditMs) {
    const k = room.players.get(lh.by);
    if (k && k !== pl && (room.mode === 'dm' || k.team !== pl.team)) {
      killer = k;
      k.kills++;
      if (room.mode === 'team') room.scores[k.team]++;
    }
  }
  broadcast(room, { t: 'death', v: pl.id, k: killer ? killer.id : 0, g: killer ? lh.g : null });
  broadcastRoom(room);
  if (room.mode === 'dm' && killer && killer.kills >= MATCH.dmKills) endMatch(room, killer.id);
  if (room.mode === 'team' && killer && room.scores[killer.team] >= MATCH.teamKills) endMatch(room, killer.team);
}

function leader(room) {
  if (room.mode === 'team') {
    const { A, B } = room.scores;
    return A === B ? null : A > B ? 'A' : 'B';
  }
  const ps = [...room.players.values()].sort((a, b) => b.kills - a.kills);
  if (!ps.length || (ps[1] && ps[1].kills === ps[0].kills)) return null;
  return ps[0].id;
}

function endMatch(room, winner) {
  if (room.state !== 'playing') return;
  room.state = 'ended';
  room.lobbyAt = now() + MATCH.lobbyAfterEndMs;
  for (const p of room.players.values()) p.alive = false;
  broadcast(room, { t: 'end', winner, room: roomInfo(room) });
}

// ---------------------------------------------------------------- shots, pickups, bots
function applyImpulse(tg, g, d) {
  if (tg.isBot) { tg.bot.ctrl.impulse(g, d); tg.bot.flinchUntil = now() + 700; } // a bot that was just hit aims worse too
  else send(tg, { t: 'imp', g, d: d.map(r3), by: tg.lastHit.by });
}

// pl has ammo and is allowed to fire; tg is the validated target or null
function resolveShot(room, pl, g, o, e, d, tg) {
  const t = now();
  pl.ammo[g]--;
  pl.lastFire = pl.lastFire || { L: 0, P: 0 };
  pl.lastFire[g] = t;
  pl.protectUntil = 0; // shooting ends spawn protection
  let hit = 0;
  if (tg && tg !== pl && tg.alive && !(room.mode === 'team' && tg.team === pl.team) && t >= (tg.protectUntil || 0)) {
    hit = tg.id;
    tg.lastHit = { by: pl.id, time: t, g };
    applyImpulse(tg, g, d);
  }
  broadcast(room, { t: 'shot', id: pl.id, g, o: o.map(r2), e: e.map(r2), h: hit }, pl.isBot ? null : pl);
}

function takePickup(room, pl, pk) {
  pl.ammo[pk.type] = Math.min(maxOf(pk.type), pl.ammo[pk.type] + giveOf(pk.type));
  pk.active = false;
  pk.respawnAt = now() + PICKUP_RESPAWN_MS;
  send(pl, { t: 'ammo', L: pl.ammo.L, P: pl.ammo.P, D: pl.ammo.D });
  broadcast(room, { t: 'pk', id: pk.id, a: false, by: pl.id });
}

function addBot(room, level) {
  const pl = {
    id: nextId++, ws: null, isBot: true, botLevel: level, sex: Math.random() < 0.5 ? 'f' : 'm', look: Math.random() < 0.5 ? 'human' : 'egg', name: botName(room), email: null, room: null,
    team: null, color: null, alive: false, p: [0, 0, 0], ya: 0, pi: 0, f: 0, kills: 0, deaths: 0,
    ammo: fullAmmo(), bot: makeBrain(level),
  };
  joinRoom(pl, room);
}

function botApi(room) {
  return {
    pickups: room.pickups,
    isEnemy: (a, b) => room.mode === 'dm' || a.team !== b.team,
    fire: (pl, g, o, e, d, tg) => resolveShot(room, pl, g, o, e, d, tg),
    kill: (pl) => kill(room, pl),
    takePickup: (pl, pk) => takePickup(room, pl, pk),
  };
}

// ---------------------------------------------------------------- message handling
function handle(pl, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'hello') {
    const name = String(m.name || '').trim().replace(/\s+/g, ' ').slice(0, 16);
    const email = String(m.email || '').trim().slice(0, 100);
    if (!name) return send(pl, { t: 'err', msg: 'Please enter a name.' });
    if (!EMAIL_RE.test(email)) return send(pl, { t: 'err', msg: 'Please enter a valid email.' });
    pl.name = name; pl.baseName = name; pl.email = email; pl.sex = m.sex === 'f' ? 'f' : 'm'; pl.look = m.look === 'human' ? 'human' : 'egg';
    logPlayer(name, email);
    return send(pl, { t: 'hello_ok', name });
  }
  if (!pl.name) return send(pl, { t: 'err', msg: 'Enter your name first.' });
  const room = pl.room;

  switch (m.t) {
    case 'create': {
      const mode = m.mode === 'team' ? 'team' : 'dm';
      const r = { code: newCode(), mode, hostId: 0, state: 'lobby', players: new Map(), scores: { A: 0, B: 0 }, pickups: [], endsAt: 0, emptySince: 0 };
      rooms.set(r.code, r);
      joinRoom(pl, r);
      break;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const r = rooms.get(code);
      if (!r) return send(pl, { t: 'err', msg: `Room ${code || '?'} not found. It may have closed.`, code: 'noroom' });
      if (r === room) return send(pl, { t: 'joined', room: roomInfo(r) });
      if (r.players.size >= MODES[r.mode].max) {
        const bot = [...r.players.values()].find((p) => p.isBot); // a real player takes a bot's place
        if (!bot) return send(pl, { t: 'err', msg: 'That room is full.', code: 'full' });
        leaveRoom(bot);
      }
      joinRoom(pl, r);
      break;
    }
    case 'addBot': {
      if (!room || room.hostId !== pl.id) return;
      const level = BOT_LEVELS[m.level] ? m.level : 'medium';
      if (room.players.size >= MODES[room.mode].max) return send(pl, { t: 'err', msg: 'The room is full — remove someone first.' });
      addBot(room, level);
      break;
    }
    case 'removeBot': {
      if (!room || room.hostId !== pl.id) return;
      const bot = room.players.get(Number(m.id));
      if (bot && bot.isBot) leaveRoom(bot);
      else if (bot && bot !== pl) { // the host can also remove a person
        leaveRoom(bot);
        send(bot, { t: 'err', msg: 'The host removed you from the room.' });
        send(bot, { t: 'left' });
      }
      break;
    }
    case 'vis':
      pl.hiddenSince = m.v ? 0 : now();
      break;
    case 'back': // tab became visible again after being away
      if (room && room.state === 'playing' && pl.away) spawn(room, pl);
      break;
    case 'leave':
      leaveRoom(pl);
      send(pl, { t: 'left' });
      break;
    case 'team': {
      if (!room || room.mode !== 'team' || room.state === 'playing') return;
      const team = m.team === 'B' ? 'B' : 'A';
      if (team === pl.team || teamCount(room, team) >= MODES.team.perTeam) return;
      pl.team = team;
      broadcastRoom(room);
      break;
    }
    case 'start':
      if (room && room.hostId === pl.id && room.state !== 'playing') startMatch(room);
      break;
    case 's': {
      if (!room || room.state !== 'playing' || !pl.alive) return;
      const p = vec3(m.p);
      if (!p) return;
      pl.p = p;
      pl.ya = Number(m.ya) || 0;
      pl.pi = Math.max(-1.6, Math.min(1.6, Number(m.pi) || 0));
      pl.f = m.f | 0;
      pl.lastS = now();
      if (p[1] < KILL_Y) kill(room, pl);
      break;
    }
    case 'dash': // the player used an air dash (the movement itself happens on their side)
      if (room && pl.alive && pl.ammo.D > 0) pl.ammo.D--;
      break;
    case 'fell':
      if (room && pl.alive) kill(room, pl);
      break;
    case 'fire': {
      if (!room || room.state !== 'playing' || !pl.alive) return;
      const g = m.g === 'P' ? 'P' : 'L';
      const t = now();
      pl.lastFire = pl.lastFire || { L: 0, P: 0 };
      if (t - pl.lastFire[g] < GUNS[g].interval * 1000 * 0.75) return;
      if (pl.ammo[g] <= 0) return send(pl, { t: 'ammo', L: pl.ammo.L, P: pl.ammo.P, D: pl.ammo.D });
      const o = vec3(m.o), e = vec3(m.e), d = vec3(m.d);
      if (!o || !e || !d) return;
      let tg = m.h ? room.players.get(Number(m.h)) : null;
      // the shooter saw the target slightly in the past: accept hits near where the target really is
      if (tg && tg.alive && dist(e, [tg.p[0], tg.p[1] + 0.9, tg.p[2]]) >= 5.5) tg = null;
      resolveShot(room, pl, g, o, e, d, tg);
      break;
    }
    case 'pick': {
      if (!room || room.state !== 'playing' || !pl.alive) return;
      const pk = room.pickups.find((x) => x.id === m.id);
      if (!pk || !pk.active || pl.ammo[pk.type] >= maxOf(pk.type)) return;
      if (Math.hypot(pl.p[0] - pk.x, pl.p[2] - pk.z) > PICKUP_RADIUS + 1.5) return;
      takePickup(room, pl, pk);
      break;
    }
  }
}

// ---------------------------------------------------------------- sockets
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  const pl = { id: nextId++, ws, name: null, email: null, room: null, team: null, color: null, alive: false, p: [0, 0, 0], ya: 0, pi: 0, f: 0, kills: 0, deaths: 0, ammo: fullAmmo() };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    try { handle(pl, m); } catch (e) { console.error('handle error', e); }
  });
  ws.on('close', () => leaveRoom(pl));
  send(pl, { t: 'welcome', id: pl.id });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// ---------------------------------------------------------------- tick (30 Hz)
let lastTick = now();
// Windows rounds timers up to ~16 ms steps, so a plain 33 ms interval really fired every ~47 ms.
// Wake up often and run the tick once 30 ms have passed instead.
setInterval(() => {
  const t = now();
  if (t - lastTick < 30) return;
  const dt = Math.min(0.1, (t - lastTick) / 1000);
  lastTick = t;
  for (const room of rooms.values()) {
    if (!room.players.size) {
      if (t - room.emptySince > 120000) rooms.delete(room.code);
      continue;
    }
    // host walked away (tab hidden for 20 s): hand the room to a random player who is still here
    const host = room.players.get(room.hostId);
    if (host && host.hiddenSince && t - host.hiddenSince > 20000) {
      const here = humans(room).filter((p) => p !== host && !p.hiddenSince);
      if (here.length) { room.hostId = here[Math.floor(Math.random() * here.length)].id; broadcastRoom(room); }
    }
    if (room.state === 'playing') {
      // a player whose game stopped sending updates (tab hidden / frozen) is taken out of play
      // until they return, instead of standing there as an un-knock-out-able statue
      for (const p of room.players.values()) {
        if (!p.isBot && p.alive && t - (p.lastS || t) > 2000) { p.alive = false; p.away = true; p.respawnAt = 0; }
      }
      for (const p of room.players.values()) if (!p.alive && p.respawnAt && t >= p.respawnAt) spawn(room, p);
      const api = botApi(room);
      for (const p of [...room.players.values()]) {
        if (!p.alive || room.state !== 'playing') continue;
        if (p.prevP && dt > 0) p.v = [0, 1, 2].map((i) => (p.p[i] - p.prevP[i]) / dt);
        p.prevP = p.p.slice();
        if (p.isBot) updateBot(room, p, dt, api);
      }
      if (room.state !== 'playing') continue; // a bot knockout can end the match
      for (const pk of room.pickups) {
        if (!pk.active && t >= pk.respawnAt) { pk.active = true; broadcast(room, { t: 'pk', id: pk.id, a: true }); }
      }
      const ps = [];
      for (const p of room.players.values()) if (p.alive) ps.push([p.id, r2(p.p[0]), r2(p.p[1]), r2(p.p[2]), r3(p.ya), r3(p.pi), p.f | 0]);
      broadcast(room, { t: 'snap', ts: t, ps }); // ts: clients space the snapshots by server time
      if (t >= room.endsAt) endMatch(room, leader(room));
    } else if (room.state === 'ended' && t >= room.lobbyAt) {
      room.state = 'lobby';
      broadcastRoom(room);
    }
  }
}, 8);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Updraft Arena running on http://localhost:${PORT}`);
  const ip = lanAddress();
  if (ip) console.log(`Friends on the same Wi-Fi can open http://${ip}:${PORT}`);
});
