// UI flow: name/email → create or join → lobby with share link → match.
import { Net } from './net.js';
import { Game } from './game.js';
import { MODES, TEAMS } from './shared/map.js';
import { playerColor } from './hud.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const net = new Net();
let game;
try {
  game = new Game($('#view'), net);
  window.__game = game; // handy for debugging in the console
} catch (err) {
  console.error(err);
  $('#webgl-error').classList.remove('hidden');
}

let invite = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
let myId = 0;
let room = null;
let myName = '';

function show(screen) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== `screen-${screen}`);
  $('#ui').classList.toggle('hidden', !screen);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
}

function setUrl(code) {
  history.replaceState(null, '', code ? `?room=${code}` : location.pathname);
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (label) btn.textContent = label;
}

// ------------------------------------------------------------------ login
$('#in-name').value = store.get('name');
$('#in-email').value = store.get('email');
if (store.get('sex') === 'f') document.querySelector('input[name=sex][value=f]').checked = true;
if (store.get('look') === 'human') document.querySelector('input[name=look][value=human]').checked = true;
if (invite) {
  $('#invite-note').innerHTML = `You're invited to room <b>${esc(invite)}</b>`;
  $('#invite-note').classList.remove('hidden');
  $('#btn-login').textContent = 'Join game';
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (game) game.sfx.init();
  const name = $('#in-name').value.trim();
  const email = $('#in-email').value.trim();
  if (!name) return toast('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Please enter a valid email.');
  store.set('name', name);
  store.set('email', email);
  myName = name;
  const btn = $('#btn-login');
  busy(btn, true);
  try {
    if (!net.open) await net.connect();
  } catch (err) {
    busy(btn, false);
    return toast(err.message);
  }
  const sex = document.querySelector('input[name=sex]:checked').value;
  store.set('sex', sex);
  const look = document.querySelector('input[name=look]:checked').value;
  store.set('look', look);
  net.send({ t: 'hello', name, email, sex, look });
});

net.on('welcome', (m) => { myId = m.id; });
net.on('hello_ok', (m) => {
  busy($('#btn-login'), false);
  myName = m.name;
  $('#hello-name').textContent = m.name;
  if (invite) net.send({ t: 'join', code: invite });
  else show('menu');
});
net.on('err', (m) => {
  toast(m.msg);
  busy($('#btn-login'), false);
  if (m.code === 'noroom' || m.code === 'full') {
    invite = '';
    setUrl('');
    show('menu');
  }
});

// ------------------------------------------------------------------ menu
$('#btn-dm').addEventListener('click', () => net.send({ t: 'create', mode: 'dm' }));
$('#btn-team').addEventListener('click', () => net.send({ t: 'create', mode: 'team' }));
$('#form-join').addEventListener('submit', (e) => {
  e.preventDefault();
  let code = $('#in-code').value.trim();
  const m = code.match(/room=([A-Za-z0-9]+)/);
  if (m) code = m[1];
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code) net.send({ t: 'join', code });
});

// ------------------------------------------------------------------ lobby
net.on('joined', (m) => {
  room = m.room;
  invite = room.code;
  setUrl(room.code);
  renderLobby();
  if (room.state !== 'playing') show('lobby');
});
net.on('room', (m) => {
  room = m.room;
  renderLobby();
  if (room.state === 'lobby' && game && game.state === 'menu') show('lobby');
});
net.on('match', () => show(null));
net.on('left', () => {
  room = null;
  invite = '';
  setUrl('');
  show('menu');
});
net.on('close', () => {
  show('disconnected');
});

// If the host opened the game on localhost, a localhost link is useless to friends:
// swap in the laptop's Wi-Fi address so friends on the same network can join.
const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let shareOrigin = location.origin;
if (isLocalHost) {
  fetch('/api/lan').then((r) => r.json()).then(({ ip }) => {
    if (ip) shareOrigin = `${location.protocol}//${ip}${location.port ? ':' + location.port : ''}`;
    renderLobby();
  }).catch(() => {});
}

function shareLink() { return `${shareOrigin}/?room=${room.code}`; }

function renderLobby() {
  if (!room) return;
  const mode = MODES[room.mode];
  const isHost = room.hostId === myId;
  $('#lobby-mode').textContent = mode.label;
  $('#lobby-code').textContent = room.code;
  $('#share-link').value = shareLink();
  $('#share-note').classList.toggle('hidden', !isLocalHost);
  $('#lobby-count').textContent = `${room.players.length}/${mode.max} players`;
  $('#btn-start').classList.toggle('hidden', !isHost);
  $('#wait-host').classList.toggle('hidden', isHost);
  const hostName = (room.players.find((p) => p.id === room.hostId) || {}).name || 'the host';
  $('#wait-host').textContent = room.state === 'playing' ? 'Match in progress…' : `Waiting for ${hostName} to start the match…`;

  const removeBtn = (p) => (isHost && p.id !== myId ? `<button class="x-btn" data-remove="${p.id}" title="Remove from room">✕</button>` : '');
  const row = (p) => `<li class="${p.id === myId ? 'me' : ''}"><i class="dot" style="background:${playerColor(p)}"></i><span class="pname">${esc(p.name)}</span>${p.bot ? `<span class="tag bot">BOT · ${BOT_LABEL[p.bot]}</span>` : ''}${p.id === room.hostId ? '<span class="tag host">HOST</span>' : ''}${p.id === myId ? '<span class="tag you">YOU</span>' : ''}${removeBtn(p)}</li>`;
  const list = $('#lobby-players');
  if (room.mode === 'team') {
    const me = room.players.find((p) => p.id === myId);
    const col = (team) => {
      const ps = room.players.filter((p) => p.team === team);
      const canJoin = me && me.team !== team && ps.length < MODES.team.perTeam;
      return `<div class="team-col"><h3 style="color:${TEAMS[team].color}">${TEAMS[team].name} team <small>${ps.length}/${MODES.team.perTeam}</small></h3><ul>${ps.map(row).join('') || '<li class="empty">Empty</li>'}</ul>${canJoin ? `<button class="btn small ghost" data-team="${team}">Switch to ${TEAMS[team].name}</button>` : ''}</div>`;
    };
    list.innerHTML = `<div class="team-cols">${col('A')}${col('B')}</div>`;
    list.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => net.send({ t: 'team', team: b.dataset.team })));
  } else {
    list.innerHTML = `<ul>${room.players.map(row).join('')}</ul>`;
  }

  // host bot controls: in the lobby and in the in-game pause menu (Esc)
  const full = room.players.length >= mode.max;
  $('#lobby-bots').classList.toggle('hidden', !isHost);
  $('#po-bots').classList.toggle('hidden', !isHost);
  document.querySelectorAll('[data-bot]').forEach((b) => { b.disabled = full; });
  const bots = room.players.filter((p) => p.bot);
  $('#po-bot-list').innerHTML = bots.length
    ? bots.map((p) => `<li><i class="dot" style="background:${playerColor(p)}"></i><span class="pname">${esc(p.name)}</span><span class="tag bot">${BOT_LABEL[p.bot]}</span>${removeBtn(p)}</li>`).join('')
    : `<li class="empty">${full ? 'Room is full' : 'No bots yet'}</li>`;
}

const BOT_LABEL = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' };

// bot buttons live in two places; one listener handles both
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-bot]');
  const rem = e.target.closest('[data-remove]');
  if (add) { e.stopPropagation(); net.send({ t: 'addBot', level: add.dataset.bot }); }
  if (rem) { e.stopPropagation(); net.send({ t: 'removeBot', id: Number(rem.dataset.remove) }); }
});

$('#btn-copy').addEventListener('click', async () => {
  const link = shareLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied — send it to your friends!');
  } catch {
    $('#share-link').select();
    toast('Press Ctrl+C to copy the link.');
  }
});
$('#btn-start').addEventListener('click', () => net.send({ t: 'start' }));
$('#btn-leave').addEventListener('click', () => net.send({ t: 'leave' }));
$('#btn-reconnect').addEventListener('click', () => location.reload());

// tell the server when this tab is hidden, so an absent host can be replaced
document.addEventListener('visibilitychange', () => net.send({ t: 'vis', v: !document.hidden }));

show('login');
