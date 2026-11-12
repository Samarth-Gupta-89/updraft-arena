// Game: renderer, loop, input, shooting, and syncing with the server.
import * as THREE from 'three';
import * as M from './shared/map.js';
import { buildWorld } from './world.js';
import { Controller } from './physics.js';
import { Avatar } from './avatar.js';
import { Weapons } from './weapons.js';
import { Sfx } from './audio.js';
import { Hud, playerColor } from './hud.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const arr = (v) => [r3(v.x), r3(v.y), r3(v.z)];

function storeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }

// 'low' (no anti-aliasing, fewer pixels) when the browser renders 3D on the CPU (no usable graphics chip), else 'high'.
// Can be forced with ?quality=low or ?quality=high in the URL.
let gpuName = ''; // which graphics chip the browser is using (shown in the FPS readout)
function pickQuality() {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'high') return forced;
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gpuName = (name.match(/ANGLE \([^,]+, ([^,]+?)(?: \(0x[0-9A-Fa-f]+\))?(?: Direct3D| OpenGL|,|$)/) || [0, name])[1].replace(/\((R|TM)\)/g, '').trim();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(name) ? 'low' : 'high';
  } catch { return 'high'; }
}

export class Game {
  constructor(canvas, net) {
    this.net = net;
    this.canvas = canvas;
    this.quality = pickQuality();
    const low = this.quality === 'low';
    // Anti-aliasing cost ~40% of the frame on laptop graphics chips, so it is off unless asked for with ?aa=1
    const aa = new URLSearchParams(location.search).get('aa') === '1';
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: aa, powerPreference: 'high-performance', stencil: false }));
    // Render at 1 pixel per CSS pixel at most (high-DPI laptops would otherwise render 1.5–2x the pixels).
    // autoScale() lowers this further if the frame rate drops.
    this.maxScale = Math.min(window.devicePixelRatio || 1, low ? 0.75 : 1);
    this.scale = this.maxScale;
    r.setPixelRatio(this.scale);
    r.toneMapping = THREE.NoToneMapping; // one less calculation on every pixel
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.autoClear = false;
    this.perf = { dts: [], time: 0, lastChange: 0, badScale: 9, badUntil: 0, work: 0 };
    this.pace = 1; // draw every Nth screen refresh (see autoScale)
    this.tick = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.world = buildWorld(r, this.scene);
    this.ctrl = new Controller(this.world.colliders);
    this.weapons = new Weapons(this.scene);
    this.sfx = new Sfx();
    this.hud = new Hud();

    this.avatars = new Map();
    this.players = new Map();
    this.room = null;
    this.myId = 0;
    this.state = 'menu'; // menu | play | ended
    this.alive = false;
    this.inputActive = false;
    this.ammo = M.fullAmmo();
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.fireHeld = { L: false, P: false };
    this.nextFire = { L: 0, P: 0 };
    this.sens = Number(storeGet('sens')) || 0.0022;
    this.lastSend = 0;
    this.clock = new THREE.Clock();
    this.t = 0;
    this.shake = 0;
    this.kickP = 0;   // view kick from firing
    this.punchP = 0;  // view knocked off target when hit
    this.punchY = 0;
    this.stepT = 0;
    this.endTime = 0;
    this.deathAt = 0;
    this.protectUntil = 0;
    this.fellSent = false;
    this.pickTimes = new Map();
    this.shield = { v: M.SHIELD.max, broken: false }; // charges left, as last told by the server
    this.shieldUp = false;
    this.chargeAt = 0; // when the SHOVER button went down (0 = not held)
    this.protectMap = new Map(); // player id -> spawn protection end time
    this.eyeH = M.PLAYER.eye;
    this.everLocked = false;
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3(); this.v4 = new THREE.Vector3();

    this.bindInput();
    this.bindNet();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    // Measure the screen's refresh rate on an empty page first (30 quick ticks, or 0.6 s at most), then start drawing.
    let n = 0, last = 0, best = Infinity, started = false;
    const start = () => { if (started) return; started = true; if (best < 0.05) this.perf.hz = 1 / best; r.setAnimationLoop(() => this.frame()); };
    const probe = (t) => { if (started) return; if (last) best = Math.min(best, (t - last) / 1000); last = t; if (++n < 30) requestAnimationFrame(probe); else start(); };
    requestAnimationFrame(probe);
    setTimeout(start, 600);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weapons.resize(w / h);
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const onKey = (e, down) => {
      if (this.state !== 'play') return;
      if (e.code === 'Tab') {
        e.preventDefault();
        this.hud.showScoreboard(down, this.room, this.myId);
        return;
      }
      if (!this.inputActive) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      // crouching with Ctrl: stop Ctrl+D/S/A etc. from triggering browser shortcuts (Ctrl+W can't be blocked; see beforeunload)
      if (e.ctrlKey) e.preventDefault();
      if (down) this.keys.add(e.code); else this.keys.delete(e.code);
      if (down && !e.repeat && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) this.tryDash();
      if (e.code === 'KeyQ') this.fireHeld.L = down;
      if (e.code === 'KeyE') this.fireHeld.P = down;
    };
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.fireHeld.L = this.fireHeld.P = false; this.hud.showScoreboard(false); });
    // Ctrl+W (crouch + forward) would close the tab: ask first while a match is on
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'play') { e.preventDefault(); e.returnValue = ''; }
    });

    const pause = () => {
      this.inputActive = false;
      this.keys.clear();
      this.fireHeld.L = this.fireHeld.P = false;
      this.hud.showPlayOverlay(true, this.everLocked ? 'Paused' : 'Click to play');
    };
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) { this.inputActive = true; this.everLocked = true; this.hud.showPlayOverlay(false); }
      else if (this.state === 'play') pause();
    });
    // e.g. clicking "Play" within a second of pressing Esc: the browser refuses, so keep the menu up
    document.addEventListener('pointerlockerror', () => { if (this.state === 'play') pause(); });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.yaw -= e.movementX * this.sens;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * this.sens));
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'play') return;
      if (!this.inputActive) { this.lockPointer(); return; }
      if (e.button === 0) this.fireHeld.L = true;
      if (e.button === 2) this.fireHeld.P = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld.L = false;
      if (e.button === 2) this.fireHeld.P = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // pause menu: "Play" button or a click on the dim background resumes; the bot panel doesn't
    const overlay = document.querySelector('#play-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.id === 'btn-resume') this.lockPointer(); });
    // sensitivity sliders (lobby + pause menu) stay in sync
    const sliders = document.querySelectorAll('.sens-input');
    for (const el of sliders) {
      el.value = String(Math.round(this.sens * 10000));
      el.addEventListener('input', () => {
        this.sens = Number(el.value) / 10000;
        for (const o of sliders) o.value = el.value;
        try { localStorage.setItem('sens', String(this.sens)); } catch { /* private mode */ }
      });
    }
  }

  // Air dash power-up: Shift while in the air flies you forward (the way you are looking) and up a little
  tryDash() {
    if (!this.alive || this.ammo.D <= 0) return;
    if (!this.ctrl.dash(-Math.sin(this.yaw), -Math.cos(this.yaw))) return;
    this.ammo.D--;
    this.hud.setAmmo(this.ammo);
    this.net.send({ t: 'dash' });
    this.sfx.dash();
    this.hud.popup('AIR DASH!', '#b9ff9c');
  }

  lockPointer() {
    this.sfx.init();
    // input switches on when the browser confirms the lock (pointerlockchange)
    const plain = () => {
      try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* not allowed here */ }
    };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(plain);
    } catch { plain(); }
  }

  // ------------------------------------------------------------------ network
  bindNet() {
    const n = this.net;
    n.on('welcome', (m) => { this.myId = m.id; });
    n.on('joined', (m) => this.setRoom(m.room));
    n.on('room', (m) => this.setRoom(m.room));
    n.on('match', (m) => this.startMatch(m));
    n.on('snap', (m) => this.onSnap(m.ps, m.ts));
    n.on('spawn', (m) => this.onSpawn(m));
    n.on('death', (m) => this.onDeath(m));
    n.on('round', (m) => { if (this.state === 'play') this.hud.center(m.w ? `${M.TEAMS[m.w].name} team wins round ${m.n}` : `Round ${m.n} is a draw`, m.n < m.of ? 'Next round starts in a moment' : ''); });
    n.on('rstart', (m) => { this.endTime = performance.now() + m.timeLeft; if (this.ann) this.ann.oneMinute = false; if (this.state === 'play') this.hud.popup(`ROUND ${m.n} OF ${m.of}`, '#ffe08a'); });
    n.on('imp', (m) => this.onImpulse(m));
    n.on('shot', (m) => this.onShot(m));
    n.on('sh', (m) => { this.shield.v = m.v; this.shield.broken = !!m.b; this.hud.setShield(m.v, !!m.b, this.shieldUp); });
    n.on('ammo', (m) => { this.ammo.L = m.L; this.ammo.P = m.P; this.ammo.D = m.D || 0; this.hud.setAmmo(this.ammo); });
    n.on('pk', (m) => {
      this.world.pickups.setActive(m.id, m.a);
      if (m.by === this.myId) { this.sfx.pickup(); const ty = this.world.pickups.items.get(m.id).type; this.hud.popup(`+${M.giveOf(ty)} ${M.PICKUP_NAME[ty]}${ty === 'D' ? ' — press Shift in the air' : ''}`, ty === 'D' ? '#b9ff9c' : '#cfe'); }
    });
    n.on('gone', (m) => this.removeAvatar(m.id));
    n.on('end', (m) => this.onEnd(m));
    n.on('left', () => this.toMenu());
    n.on('close', () => this.toMenu());
  }

  avInfo(p) { return { name: p.name, colorHex: playerColor(p), sex: p.sex, look: p.look }; }

  isEnemy(p) {
    if (!this.room || this.room.mode === 'dm') return true;
    const me = this.players.get(this.myId);
    return !me || me.team !== p.team;
  }

  setRoom(room) {
    this.room = room;
    this.players.clear();
    for (const p of room.players) this.players.set(p.id, p);
    for (const [id, av] of this.avatars) {
      const info = this.players.get(id);
      if (!info) this.removeAvatar(id);
      else av.setInfo(this.avInfo(info), this.isEnemy(info));
    }
    if (room.state === 'playing') this.endTime = performance.now() + room.timeLeft;
    this.hud.setScores(room, this.myId);
    if (room.state === 'lobby' && this.state !== 'menu') this.toMenu();
    if (room.state === 'playing') this.announceLead(room);
  }

  startMatch(m) {
    this.state = 'play';
    this.renderer.compile(this.scene, this.camera); // build all shaders now, not in the middle of a fight
    this.alive = false;
    this.fellSent = false;
    this.deathAt = 0;
    this.endTime = performance.now() + m.timeLeft;
    this.world.pickups.setAll(m.pickups);
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
    this.hud.reset();
    this.hud.show(true);
    this.hud.setAmmo(this.ammo);
    if (this.room) this.hud.setScores(this.room, this.myId);
    this.hud.showMap(m.mode === 'team'); // the minimap is for Team Battle only
    this.inputActive = document.pointerLockElement === this.canvas;
    this.everLocked = this.inputActive;
    this.hud.showPlayOverlay(!this.inputActive, 'Click to play');
    this.weapons.visible = true;
    this.sfx.start();
    this.ann = { firstKo: false, streak: 0, multi: 0, lastKillAt: 0, leading: false, oneMinute: m.timeLeft < 60000 };
    setTimeout(() => { if (this.state === 'play') this.sfx.voice('fight'); }, 700);
  }

  toMenu() {
    this.state = 'menu';
    this.alive = false;
    this.inputActive = false;
    this.keys.clear();
    this.fireHeld.L = this.fireHeld.P = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.show(false);
    this.hud.showPlayOverlay(false);
    this.hud.showScoreboard(false);
    this.hud.hideEnd();
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
  }

  removeAvatar(id) {
    const av = this.avatars.get(id);
    if (av) { av.dispose(); this.avatars.delete(id); }
  }

  onSnap(ps, ts) {
    if (this.state !== 'play') return;
    // Time each snapshot by the server's clock, not by when it happened to arrive, so network hiccups
    // don't make other players stutter. The offset follows the fastest packets and drifts up slowly.
    const now = performance.now();
    this.clockOff = this.clockOff === undefined ? now - ts : Math.min(now - ts, this.clockOff + 0.03);
    const t = ts + this.clockOff;
    const seen = new Set();
    for (const [id, x, y, z, ya, pi, f] of ps) {
      if (id === this.myId) continue;
      seen.add(id);
      let av = this.avatars.get(id);
      if (!av) {
        const info = this.players.get(id);
        if (!info) continue;
        av = new Avatar(this.scene, this.avInfo(info), this.isEnemy(info));
        this.avatars.set(id, av);
        av.teleport([x, y, z], ya);
        av.protectUntil = this.protectMap.get(id) || 0;
      }
      av.push([x, y, z], ya, pi, f, t);
      if (!av.visible) av.setVisible(true);
    }
    for (const [id, av] of this.avatars) if (!seen.has(id) && av.visible) av.setVisible(false);
  }

  onSpawn(m) {
    if (m.id === this.myId) {
      this.ctrl.spawn(m.p);
      this.yaw = m.ya;
      this.pitch = 0;
      this.alive = true;
      this.fellSent = false;
      this.deathAt = 0;
      this.ammo = M.fullAmmo();
      this.hud.setAmmo(this.ammo);
      this.hud.setFade(0);
      this.hud.center('', '');
      this.protectUntil = performance.now() + (m.prot || 0);
    } else {
      const until = performance.now() + (m.prot || 0);
      this.protectMap.set(m.id, until);
      const av = this.avatars.get(m.id);
      if (av) { av.teleport(m.p, m.ya); av.protectUntil = until; }
    }
  }

  onDeath(m) {
    const v = this.players.get(m.v), k = m.k ? this.players.get(m.k) : null;
    if (v) this.hud.killfeed(k, v, m.g);
    if (m.v === this.myId) {
      this.alive = false;
      this.deathAt = performance.now();
      this.specCleared = false;
      this.fireHeld.L = this.fireHeld.P = false;
      this.sfx.death();
      this.hud.center(k ? `Knocked out by ${k.name}` : 'You fell out of the arena', '');
      this.hud.setLifted(false);
    } else {
      const av = this.avatars.get(m.v);
      if (av) av.setVisible(false);
    }
    if (m.k === this.myId && v) {
      this.sfx.kill();
      this.hud.popup(`KNOCKED OUT ${v.name.toUpperCase()}`, '#ffe08a');
    }
    this.announceDeath(m);
  }

  // ------------------------------------------------------------------ announcer (ElevenLabs voice lines)
  announceDeath(m) {
    const a = this.ann;
    if (!a) return;
    const first = m.k && !a.firstKo;
    if (m.k) a.firstKo = true;
    if (m.v === this.myId) {
      a.streak = 0;
      a.multi = 0;
      this.sfx.voice('out_of_arena');
      return;
    }
    if (m.k !== this.myId) {
      if (first) this.sfx.voice('first_ko');
      return;
    }
    const now = performance.now();
    a.multi = now - a.lastKillAt < 4000 ? a.multi + 1 : 1; // knockouts in quick succession
    a.lastKillAt = now;
    a.streak++;
    const multi = a.multi >= 4 ? 'multi' : a.multi === 3 ? 'triple' : a.multi === 2 ? 'double' : null;
    const streak = { 3: 'rampage', 5: 'dominating', 7: 'unstoppable', 10: 'legendary' }[a.streak] || null;
    if (multi) this.sfx.voice(multi);
    if (streak) this.sfx.voice(streak);
    if (!multi && !streak) this.sfx.voice(first ? 'first_ko' : 'knockout');
  }

  // deathmatch: "You have taken / lost the lead"
  announceLead(room) {
    if (room.mode !== 'dm' || this.state !== 'play') return;
    const me = room.players.find((p) => p.id === this.myId);
    if (!me) return;
    const best = Math.max(0, ...room.players.filter((p) => p.id !== this.myId).map((p) => p.kills));
    const leading = me.kills > 0 && me.kills > best;
    if (leading && !this.ann.leading) this.sfx.voice('took_lead');
    else if (!leading && this.ann.leading && best > me.kills) this.sfx.voice('lost_lead');
    this.ann.leading = leading;
  }

  onImpulse(m) {
    if (!this.alive || this.state !== 'play') return;
    this.ctrl.impulse(m.g, m.d, m.x || 1);
    this.sfx.hurt(m.g);
    if (m.x > 1) this.hud.popup(m.hs ? 'HEADSHOT — DOUBLE HIT!' : 'CHARGED HIT!', '#ff8d84');
    this.shake = Math.min(1, this.shake + (m.g === 'P' ? 0.6 : 0.3));
    // being hit throws your aim off for a moment
    const hard = m.g === 'P' ? 1.4 : 1;
    this.punchP = Math.max(-0.25, Math.min(0.25, this.punchP + (0.05 + Math.random() * 0.04) * hard));
    this.punchY = Math.max(-0.25, Math.min(0.25, this.punchY + (Math.random() < 0.5 ? -1 : 1) * (0.04 + Math.random() * 0.05) * hard));
    const av = this.avatars.get(m.by);
    let dx, dz;
    if (av && av.visible) { dx = av.pos.x - this.ctrl.pos.x; dz = av.pos.z - this.ctrl.pos.z; }
    else { dx = -m.d[0]; dz = -m.d[2]; }
    const worldAng = Math.atan2(-dx, -dz);
    let rel = worldAng - this.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.hud.damage(-rel * 180 / Math.PI, m.g);
  }

  onShot(m) {
    if (this.state !== 'play') return;
    const av = this.avatars.get(m.id);
    const from = av && av.visible ? av.muzzle(m.g, this.v1) : this.v1.set(m.o[0], m.o[1], m.o[2]);
    const to = this.v2.set(m.e[0], m.e[1], m.e[2]);
    if (av) { av.fired(m.g); av.protectUntil = 0; } // shooting ends spawn protection
    this.protectMap.delete(m.id);
    const dir = this.v3.copy(to).sub(from).normalize();
    this.weapons.tracer(from, to, m.g, !!m.c);
    this.weapons.impact(to, dir, m.g, !!m.h);
    this.sfx.shot(m.g, from);
    if (m.b === this.myId) { this.sfx.block(); this.hud.popup('BLOCKED', '#9fdcff'); } // my shield took it
  }

  onEnd(m) {
    this.state = 'ended';
    this.alive = false;
    this.inputActive = false;
    this.fireHeld.L = this.fireHeld.P = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.showPlayOverlay(false);
    this.hud.showScoreboard(false);
    this.hud.setLifted(false);
    this.hud.center('', '');
    this.hud.showEnd(m.winner, m.room, this.myId);
    const me = m.room.players.find((p) => p.id === this.myId);
    if (m.room.mode === 'team' && m.winner) {
      this.sfx.voice(m.winner === 'A' ? 'red_wins' : 'blue_wins');
      if (me) this.sfx.voice(me.team === m.winner ? 'victory' : 'defeat');
    } else if (!m.winner) this.sfx.voice('draw');
    else this.sfx.voice(m.winner === this.myId ? 'victory' : 'defeat');
  }

  // ------------------------------------------------------------------ shooting
  raycast(o, d) {
    let best = M.rayStatic(o, d, 250, this.world.colliders), id = 0;
    for (const [pid, av] of this.avatars) {
      if (!av.visible) continue;
      const info = this.players.get(pid);
      if (!info || !this.isEnemy(info)) continue;
      const p = av.pos;
      const body = M.bodyOf(av.look); // the target box matches the character (egg = wide, human = slim)
      const top = (av.flags & 8) ? body.crouchH : body.h; // crouched players are shorter targets
      const t = M.rayAABB(o, d, p.x - body.half, p.y, p.z - body.half, p.x + body.half, p.y + top, p.z + body.half);
      if (t !== null && t < best) { best = t; id = pid; }
    }
    return { id, point: new THREE.Vector3().copy(d).multiplyScalar(best).add(o) };
  }

  fire(g, charged = false) {
    const now = performance.now();
    if (now < this.nextFire[g]) return;
    if (this.ammo[g] <= 0) {
      if (now > (this.emptyAt || 0)) { this.sfx.empty(); this.hud.flashEmpty(g); this.emptyAt = now + 350; }
      return;
    }
    this.nextFire[g] = now + M.GUNS[g].interval * 1000;
    this.ammo[g] -= charged ? M.CHARGE.cost : 1;
    this.hud.setAmmo(this.ammo);
    const o = this.camera.getWorldPosition(this.v1);
    const d = this.camera.getWorldDirection(this.v2);
    const hit = this.raycast(o, d);
    const target = hit.id ? this.avatars.get(hit.id) : null;
    // spawn-protected players shrug hits off, and so does a raised shield that the shot meets from the front
    const effective = target && !target.isProtected && !((target.flags & 16) && M.shieldBlocks(target.yaw, [d.x, d.y, d.z]));
    // headshot: the shot landed at head height on the target (double lift / double knockback)
    const head = effective && hit.point.y - target.pos.y >= M.headFrom(target.look, (target.flags & 8) !== 0);
    const muzzle = this.weapons.muzzleWorld(g, this.camera, this.v3);
    this.weapons.kick(g);
    this.kickP += (g === 'P' ? 0.035 : 0.014) * (charged ? 2.2 : 1); // recoil: the view jumps up a little and settles back
    this.weapons.tracer(muzzle, hit.point, g, charged);
    this.weapons.impact(hit.point, d, g, effective);
    this.sfx.shot(g, null);
    if (effective) { this.hud.hitmarker(g); setTimeout(() => this.sfx.hitConfirm(), 40); }
    if (head) { this.hud.popup('HEADSHOT!', '#ffd84a'); setTimeout(() => this.sfx.hitConfirm(), 150); }
    else if (charged && effective) this.hud.popup('CHARGED HIT!', '#ffb02e');
    if (charged) this.shake = Math.min(1, this.shake + 0.35);
    this.protectUntil = 0;
    this.net.send({ t: 'fire', g, o: arr(o), d: arr(d), e: arr(hit.point), h: hit.id || 0, hs: head ? 1 : 0, c: charged ? 1 : 0 });
  }

  // ------------------------------------------------------------------ frame
  // Keep every frame on time for this screen (60, 120, 144 Hz…): if frames are being missed, render fewer
  // pixels; raise again when there is headroom.
  autoScale(rawDt, now) {
    const p = this.perf;
    // a long gap means the tab was hidden/throttled, not that rendering is slow: start counting again
    if (rawDt > 0.2) { p.dts.length = 0; p.time = 0; p.work = 0; return; }
    p.dts.push(rawDt);
    p.time += rawDt;
    if (p.time < 1.5) return;
    const fps = p.dts.length / p.time;
    // FPS readout (top-left): frames per second, share of full resolution drawn, time spent in the game's own code, graphics chip
    this.fpsEl = this.fpsEl || document.getElementById('fps');
    if (this.fpsEl) this.fpsEl.textContent = `${Math.round(fps)} FPS${this.pace > 1 ? ' (steady 1/' + this.pace + ')' : ''} · ${Math.round(this.scale * 100)}% · ${(p.work / p.dts.length).toFixed(1)} ms · ${gpuName}`;
    p.work = 0;
    const d = p.dts.sort((x, y) => x - y);
    const refresh = d[Math.floor(d.length * 0.05)]; // the fastest frames show the interval we are aiming for
    let missed = 0;
    for (const x of d) if (x > refresh * 1.5) missed++;
    missed /= d.length;
    p.dts.length = 0;
    p.time = 0;
    if (this.pace === 1) p.hz = Math.max(p.hz || 0, 1 / refresh); // the screen's refresh rate: the best we have seen unpaced
    if (this.state !== 'play' || document.hidden || now - p.lastChange < 2000) return;

    // 1) Did the last resolution drop buy anything? If not, the graphics chip is not waiting on pixels:
    //    put the sharpness back and stop lowering it.
    if (p.tryFrom) {
      if (fps < p.tryFrom.fps * 1.12) { p.noGain = true; this.setScale(p.tryFrom.scale, now); p.tryFrom = null; return; }
      p.tryFrom = null;
    }
    // 2) Resolution: fewer pixels when frames are being missed, more again when there is room.
    let next = this.scale;
    if (missed > 0.08 && this.scale > 0.4 && !p.noGain) {
      next = Math.max(0.4, this.scale - (missed > 0.3 ? 0.2 : 0.1)); // far behind: drop in bigger steps
      p.badScale = this.scale; // don't climb back to a size that just failed for a while (no see-sawing)
      p.badUntil = now + 30000;
      p.tryFrom = { fps, scale: this.scale };
    } else if (missed < 0.02 && this.scale < this.maxScale) {
      next = Math.min(this.maxScale, this.scale + 0.05);
      if (now < p.badUntil && next >= p.badScale - 0.001) next = this.scale;
    }
    if (next !== this.scale) { this.setScale(next, now); return; }

    // 3) Frame pacing on fast screens (100 Hz and up). A machine that cannot fill every refresh shows frames at
    //    uneven moments, which looks jerky. Drawing every 2nd (or 3rd) refresh instead gives evenly spaced
    //    frames, which looks smoother than a higher but uneven number.
    const hz = p.hz || 60;
    if (hz < 100) return;
    if (this.pace < 3 && missed > 0.08 && fps < (hz / this.pace) * 0.85) {
      this.pace++;
      p.lastChange = now;
      p.retryAt = now + (p.retryGap = Math.min(120000, (p.retryGap || 10000) * 2));
    } else if (this.pace > 1 && missed < 0.02 && now > p.retryAt) {
      this.pace--; // things look easy: try the faster rate again (waits longer each time it fails)
      p.lastChange = now;
    }
  }

  setScale(v, now) {
    this.scale = Math.round(v * 100) / 100;
    this.perf.lastChange = now;
    this.renderer.setPixelRatio(this.scale);
    this.resize();
  }

  frame() {
    // frame pacing: on a fast screen that this machine cannot keep up with, draw every 2nd or 3rd refresh
    if (this.pace > 1 && (this.tick = (this.tick + 1) % this.pace) !== 0) return;
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    this.t += dt;
    const now = performance.now();
    this.autoScale(rawDt, now);
    // the tab was hidden or frozen: the server took us out of play, ask to come back in
    if (rawDt > 1 && this.state === 'play') this.net.send({ t: 'back' });
    this.world.update(this.t);

    if (this.state === 'menu') {
      const a = this.t * 0.035;
      this.camera.position.set(Math.cos(a) * 100, 42, Math.sin(a) * 76);
      this.camera.lookAt(0, 0, 0);
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
    } else {
      this.updatePlay(dt, now);
    }

    for (const av of this.avatars.values()) if (av.visible) av.update(dt, now);
    const c = this.ctrl;
    const hs = Math.hypot(c.mv.x, c.mv.z);
    this.weapons.update(dt, this.camera, this.world.sunDir, hs, c.onGround);
    this.sfx.setListener(this.camera);

    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.state === 'play' && this.alive) this.weapons.render(r);
    this.perf.work += performance.now() - now; // milliseconds this frame spent in the game's own code
  }

  updatePlay(dt, now) {
    const c = this.ctrl, k = this.keys;
    const active = this.inputActive && this.alive && this.state === 'play';
    const input = active ? {
      f: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      r: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      jump: k.has('Space'),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      crouch: k.has('KeyC'),
    } : { f: 0, r: 0, jump: false, sprint: false, crouch: false };

    const p = c.pos;
    if (this.alive || p.y > -60) c.update(dt, input, this.yaw);
    for (const e of c.events) {
      if (e === 'jump') this.sfx.step(false);
      else if (e === 'splash') this.sfx.splash(null);
      else if (e.startsWith('land:')) { const v = Number(e.slice(5)); this.sfx.land(v); this.dip = Math.min(0.3, v * 0.014); } // the view dips on landing
    }
    c.events.length = 0;

    const hs = Math.hypot(c.mv.x, c.mv.z);
    if (this.alive && (c.onGround || c.inWater) && hs > 1) {
      this.stepT += dt * hs;
      if (this.stepT > (c.inWater ? 3.2 : 2.6)) { this.stepT = 0; this.sfx.step(c.inWater); }
    }

    if (this.alive && p.y < M.KILL_Y && !this.fellSent) {
      this.fellSent = true;
      this.net.send({ t: 'fell' });
    }

    // camera
    // eye height glides down/up when crouching
    const myBody = M.bodyOf((this.players.get(this.myId) || {}).look); // humans see from human eye height
    this.eyeH += ((c.crouching ? myBody.crouchEye : myBody.eye) - this.eyeH) * Math.min(1, dt * 12);
    this.dip = (this.dip || 0) * Math.exp(-dt * 9);
    this.roll = (this.roll || 0) + (-input.r * 0.014 - (this.roll || 0)) * Math.min(1, dt * 10); // lean a little when strafing
    if (this.alive || p.y > -45) this.camera.position.set(p.x, p.y + this.eyeH - this.dip, p.z);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const sh = this.shake * this.shake;
    this.kickP *= Math.exp(-dt * 14);
    const pf = Math.exp(-dt * 4.5);
    this.punchP *= pf; this.punchY *= pf;
    this.camera.rotation.set(this.pitch + this.kickP + this.punchP + (Math.random() - 0.5) * sh * 0.06, this.yaw + this.punchY + (Math.random() - 0.5) * sh * 0.06, this.roll);
    // Team Battle, knocked out: watch through the eyes of a team mate who is still in.
    // Left click or Space switches to the next one. Only your own team can be watched.
    const meP = this.players.get(this.myId);
    let spec = null, specId = 0;
    if (!this.alive && this.state === 'play' && meP && meP.team && this.deathAt && now - this.deathAt > 1200) {
      const mates = [];
      for (const [id, av] of this.avatars) { const o = this.players.get(id); if (o && o.team === meP.team && av.visible) mates.push(id); }
      const press = this.fireHeld.L || k.has('Space');
      const next = press && !this.specHeld;
      this.specHeld = press;
      if (mates.length) {
        let i = mates.indexOf(this.specId);
        if (i < 0) i = 0; else if (next) i = (i + 1) % mates.length;
        specId = mates[i];
        spec = this.avatars.get(specId);
      }
    }
    if (specId !== this.specId) { // put the body of the player we stopped watching back
      const old = this.avatars.get(this.specId);
      if (old) old.group.visible = old.visible;
      this.specId = specId;
    }
    this.spec = spec;
    if (spec) {
      spec.group.visible = false; // we are inside their head: do not draw their body
      const b = M.bodyOf(spec.look);
      this.camera.position.set(spec.pos.x, spec.pos.y + ((spec.flags & 8) ? b.crouchEye : b.eye), spec.pos.z);
      this.camera.rotation.set(spec.pitch, spec.yaw, 0);
    }
    const kbs = Math.hypot(c.kb.x, c.kb.z);
    const sprinting = input.sprint && input.f > 0 && c.onGround;
    const fov = 75 + (sprinting ? 5 : 0) + Math.min(12, kbs * 0.45);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 6);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    // shield: held up with F while it has charge. Only the LIFTER can be fired from behind it.
    const up = active && k.has('KeyF') && !this.shield.broken && this.shield.v >= 1;
    if (up !== this.shieldUp) { this.shieldUp = up; this.weapons.shieldUp = up; this.hud.setShield(this.shield.v, this.shield.broken, up); }
    if (active && this.fireHeld.L) this.fire('L');
    // SHOVER fires when the button is released: a tap is a normal shot; held until charged, it is a charged shot.
    // Raising the shield or dying cancels it.
    const holdP = active && this.fireHeld.P && !up;
    if (holdP && !this.chargeAt) this.chargeAt = now;
    if (!holdP && this.chargeAt) {
      const held = now - this.chargeAt;
      this.chargeAt = 0;
      if (active && !up) this.fire('P', held >= M.CHARGE.ms && this.ammo.P >= M.CHARGE.cost);
    }
    const charge = this.chargeAt && this.ammo.P >= M.CHARGE.cost ? Math.min(1, (now - this.chargeAt) / M.CHARGE.ms) : 0;
    if (charge >= 1 && this.weapons.charge < 1) this.sfx.pickup(); // a ping when it is ready
    this.weapons.charge = charge;

    if (this.alive && now - this.lastSend > 15) { // up to 60 updates per second: fresher positions for everyone else
      this.lastSend = now;
      let f = 0;
      if (c.floating) f |= 1;
      if (c.inWater) f |= 2;
      if (c.onGround) f |= 4;
      if (c.crouching) f |= 8;
      if (this.shieldUp) f |= 16;
      this.net.send({ t: 's', p: [r2(p.x), r2(p.y), r2(p.z)], ya: r3(this.yaw), pi: r3(this.pitch), f });
    }

    if (this.alive) {
      for (const it of this.world.pickups.items.values()) {
        if (!it.active || this.ammo[it.type] >= M.maxOf(it.type)) continue;
        if (Math.hypot(p.x - it.x, p.z - it.z) < M.PICKUP_RADIUS && Math.abs(p.y - it.group.position.y) < 2.5) {
          const last = this.pickTimes.get(it.id) || 0;
          if (now - last > 500) { this.pickTimes.set(it.id, now); this.net.send({ t: 'pick', id: it.id }); }
        }
      }
    }

    // HUD
    // Team Battle minimap, redrawn 10 times a second: me and my team mates who are still in (never the enemy)
    const meInfo = this.players.get(this.myId);
    if (meInfo && meInfo.team && now - (this.mapAt || 0) > 100) {
      this.mapAt = now;
      const mates = [];
      for (const [id, av] of this.avatars) { const o = this.players.get(id); if (o && o.team === meInfo.team && av.visible) mates.push(av.pos); }
      this.hud.drawMap(M, this.spec ? this.spec.pos : p, this.spec ? this.spec.yaw : this.yaw, mates, M.TEAMS[meInfo.team].color);
    }
    this.hud.setTimer(this.endTime - now);
    if (this.ann && !this.ann.oneMinute && this.endTime - now < 60000) { this.ann.oneMinute = true; this.sfx.voice('one_minute'); }
    this.hud.setLifted(this.alive && c.floating);
    const cam = this.camera.position;
    this.hud.setWater(cam.y < M.WATER_LEVEL && M.inArena(cam.x, cam.z) && M.heightAt(cam.x, cam.z) < M.WATER_LEVEL);
    if (!this.alive && this.deathAt) {
      const left = Math.max(0, Math.ceil((this.deathAt + M.MATCH.respawnMs - now) / 1000));
      const team = this.room && this.room.mode === 'team'; // Team Battle: no respawn until the round ends
      this.hud.sub(this.spec ? `Watching ${this.spec.name} — click or Space for the next team mate` : team ? 'Out until the next round' : left > 0 ? `Respawning in ${left}…` : 'Respawning…');
      this.hud.setFade(this.spec ? 0 : Math.min(team ? 0.3 : 0.65, (now - this.deathAt) / 1800));
      if (this.spec && !this.specCleared) { this.specCleared = true; this.hud.center('', ''); } // clear the big knocked-out text off the view
      this.hud.status('');
    } else if (this.alive) {
      if (!M.inArena(p.x, p.z)) this.hud.status('OUT OF THE ARENA!', 'danger');
      else if (now < this.protectUntil) this.hud.status('SPAWN PROTECTION', 'info');
      else if (c.floating) this.hud.status('LIFTED!', 'lift');
      else if (this.weapons.charge >= 1) this.hud.status('CHARGED — RELEASE!', 'info');
      else if (this.weapons.charge > 0) this.hud.status('CHARGING…', 'info');
      else this.hud.status('');
    }
  }
}
