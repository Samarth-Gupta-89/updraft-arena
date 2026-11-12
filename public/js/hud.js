// DOM heads-up display.
import { MAX_AMMO, TEAMS, MODES, MATCH } from './shared/map.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function playerColor(p) {
  return p.team ? TEAMS[p.team].color : p.color;
}

export class Hud {
  constructor() {
    this.el = $('#hud');
    this.timerEl = $('#timer');
    this.scoreA = $('#score-a');
    this.scoreB = $('#score-b');
    this.ammoEl = { L: $('#ammo-L'), P: $('#ammo-P') };
    this.barEl = { L: $('#bar-L'), P: $('#bar-P') };
    this.gunEl = { L: $('.gun-L'), P: $('.gun-P') };
    this.dashEl = $('#dash');
    this.shieldEl = $('#shield');
    this.shieldN = $('#shield-n');
    this.dashN = $('#dash-n');
    this.feed = $('#killfeed');
    this.centerEl = $('#center-msg');
    this.subEl = $('#sub-msg');
    this.popEl = $('#popup');
    this.statusEl = $('#status');
    this.hitEl = $('#hitmarker');
    this.dmgEl = $('#dmg');
    this.vignette = $('#vignette');
    this.waterEl = $('#water-tint');
    this.fadeEl = $('#fade');
    this.board = $('#scoreboard');
    this.overlay = $('#play-overlay');
    this.endEl = $('#end-overlay');
    this.boardOpen = false;
    this.lastTimer = '';
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  reset() {
    this.feed.innerHTML = '';
    this.center('', '');
    this.status('');
    this.setFade(0);
    this.setLifted(false);
    this.setWater(false);
    this.endEl.classList.add('hidden');
  }

  setAmmo(a) {
    for (const g of ['L', 'P']) {
      this.ammoEl[g].textContent = a[g];
      this.barEl[g].style.width = `${(a[g] / MAX_AMMO) * 100}%`;
      this.gunEl[g].classList.toggle('low', a[g] <= 5);
      this.gunEl[g].classList.toggle('empty', a[g] <= 0);
    }
    this.dashN.textContent = a.D || 0;
    this.dashEl.classList.toggle('on', (a.D || 0) > 0);
  }

  flashEmpty(g) {
    const el = this.gunEl[g];
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  setTimer(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (txt !== this.lastTimer) { this.timerEl.textContent = txt; this.lastTimer = txt; }
    this.timerEl.classList.toggle('urgent', s <= 30);
  }

  setScores(room, myId) {
    if (!room) return;
    if (room.mode === 'team') {
      this.scoreA.innerHTML = `<span class="tname" style="color:${TEAMS.A.color}">RED</span> <b>${room.scores.A}</b>`;
      this.scoreB.innerHTML = `<b>${room.scores.B}</b> <span class="tname" style="color:${TEAMS.B.color}">BLUE</span>`;
    } else {
      // left: you, right: the best other player
      const me = room.players.find((p) => p.id === myId);
      const best = room.players.filter((p) => p.id !== myId).sort((a, b) => b.kills - a.kills)[0];
      this.scoreA.innerHTML = me ? `<span class="tname">YOU</span> <b>${me.kills}</b>` : '';
      this.scoreB.innerHTML = best ? `<b>${best.kills}</b> <span class="tname" style="color:${best.color}">${esc(best.name.toUpperCase())}</span>` : '';
    }
    $('#goal').textContent = room.mode === 'team' ? `Round ${Math.max(1, room.round || 1)} of ${room.rounds}` : `First to ${MATCH.dmKills}`;
    if (this.boardOpen) this.showScoreboard(true, room, myId);
  }

  killfeed(killer, victim, g) {
    const row = document.createElement('div');
    row.className = 'kf';
    const name = (p) => `<span style="color:${playerColor(p)}">${esc(p.name)}</span>`;
    if (killer) {
      const icon = g === 'P' ? '<i class="kf-icon push">➜</i>' : '<i class="kf-icon lift">⬆</i>';
      row.innerHTML = `${name(killer)} ${icon} ${name(victim)}`;
    } else {
      row.innerHTML = `${name(victim)} <i class="kf-icon">fell out</i>`;
    }
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 6000);
    setTimeout(() => row.remove(), 7000);
  }

  center(text, sub) {
    this.centerEl.textContent = text;
    this.subEl.textContent = sub || '';
  }

  sub(text) { this.subEl.textContent = text; }

  popup(text, color = '#fff') {
    this.popEl.textContent = text;
    this.popEl.style.color = color;
    this.popEl.classList.remove('pop');
    void this.popEl.offsetWidth;
    this.popEl.classList.add('pop');
  }

  status(text, cls = '') {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
    if (this.statusEl.className !== cls) this.statusEl.className = cls;
  }

  hitmarker(g) {
    this.hitEl.className = '';
    void this.hitEl.offsetWidth;
    this.hitEl.className = `on ${g === 'P' ? 'push' : 'lift'}`;
  }

  // angleDeg: 0 = in front, positive = to the right
  damage(angleDeg, g) {
    const d = document.createElement('div');
    d.className = `dmg ${g === 'P' ? 'push' : 'lift'}`;
    d.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
    this.dmgEl.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  // charges left; broken = recharging and cannot be raised yet; up = held in front right now
  setShield(v, broken, up) {
    this.shieldN.textContent = v;
    this.shieldEl.classList.toggle('broken', broken);
    this.shieldEl.classList.toggle('up', up);
    this.gunEl.P.classList.toggle('locked', up);
  }
  // Team Battle minimap (top-left): the yard, the ponds, the Nandi, you (white arrow) and your team mates (dots).
  // Enemies are never drawn. Hidden in Deathmatch.
  showMap(v) { this.mapEl = this.mapEl || $('#minimap'); this.mapEl.classList.toggle('hidden', !v); }
  drawMap(M, me, yaw, mates, color) {
    const cv = this.mapEl || (this.mapEl = $('#minimap')), g = cv.getContext('2d');
    const k = (cv.width - 12) / (M.ARENA.halfX * 2), X = (x) => cv.width / 2 + x * k, Z = (z) => cv.height / 2 + z * k;
    g.clearRect(0, 0, cv.width, cv.height);
    g.beginPath();
    M.ARENA.poly.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.closePath();
    g.fillStyle = 'rgba(190, 182, 160, 0.28)'; g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.7)'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = 'rgba(80, 150, 120, 0.8)';
    for (const p of M.PONDS) { g.beginPath(); g.ellipse(X(p.x), Z(p.z), p.rx * k * 0.9, p.rz * k * 0.9, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#15171a'; g.fillRect(X(M.NANDI.x) - 4, Z(M.NANDI.z) - 2.5, 8, 5);
    g.fillStyle = color;
    for (const m of mates) { g.beginPath(); g.arc(X(m.x), Z(m.z), 3.2, 0, Math.PI * 2); g.fill(); }
    // me: an arrow pointing where I look
    g.save();
    g.translate(X(me.x), Z(me.z));
    g.rotate(-yaw);
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4.2, 4.5); g.lineTo(0, 2.2); g.lineTo(-4.2, 4.5); g.closePath();
    g.fillStyle = '#fff'; g.fill();
    g.strokeStyle = color; g.lineWidth = 1.2; g.stroke();
    g.restore();
  }
  setLifted(v) { if (v !== this.lifted) { this.lifted = v; this.vignette.classList.toggle('on', v); } }
  setWater(v) { if (v !== this.water) { this.water = v; this.waterEl.classList.toggle('on', v); } }
  setFade(v) { if (v !== this.fade) { this.fade = v; this.fadeEl.style.opacity = v; } }

  showPlayOverlay(v, title) {
    this.overlay.classList.toggle('hidden', !v);
    if (title) document.querySelector('#po-title').textContent = title;
    document.querySelector('#btn-resume').textContent = title === 'Paused' ? 'Resume' : 'Play';
  }

  scoreboardHtml(room, myId) {
    const row = (p) => `<tr class="${p.id === myId ? 'me' : ''}"><td><i class="dot" style="background:${playerColor(p)}"></i>${esc(p.name)}${p.id === room.hostId ? ' <span class="host">HOST</span>' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`;
    const table = (title, list, color) => `<div class="sb-col">${title ? `<h3 style="color:${color}">${title}</h3>` : ''}<table><thead><tr><th>Player</th><th>KO</th><th>Falls</th></tr></thead><tbody>${list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map(row).join('')}</tbody></table></div>`;
    if (room.mode === 'team') {
      return `<div class="sb-cols">${table(`RED — ${room.scores.A}`, room.players.filter((p) => p.team === 'A'), TEAMS.A.color)}${table(`BLUE — ${room.scores.B}`, room.players.filter((p) => p.team === 'B'), TEAMS.B.color)}</div>`;
    }
    return table('', [...room.players]);
  }

  showScoreboard(v, room, myId) {
    this.boardOpen = v;
    this.board.classList.toggle('hidden', !v);
    if (v && room) this.board.innerHTML = `<h2>${MODES[room.mode].label} · Room ${room.code}</h2>${this.scoreboardHtml(room, myId)}`;
  }

  showEnd(winner, room, myId) {
    let title = 'DRAW', color = '#fff';
    if (room.mode === 'team' && winner) {
      title = `${TEAMS[winner].name.toUpperCase()} TEAM WINS`;
      color = TEAMS[winner].color;
      const me = room.players.find((p) => p.id === myId);
      if (me) title += me.team === winner ? ' — VICTORY' : ' — DEFEAT';
    } else if (winner) {
      const w = room.players.find((p) => p.id === winner);
      title = winner === myId ? 'YOU WIN!' : `${w ? esc(w.name) : 'Someone'} WINS`;
      color = w ? w.color : '#fff';
    }
    this.endEl.innerHTML = `<div class="end-card"><div class="end-title" style="color:${color}">${title}</div>${this.scoreboardHtml(room, myId)}<p class="muted">Back to the lobby in a few seconds…</p></div>`;
    this.endEl.classList.remove('hidden');
  }

  hideEnd() { this.endEl.classList.add('hidden'); }
}
