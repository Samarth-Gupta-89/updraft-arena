// Sound: ElevenLabs recordings from /audio (announcer voice + effects) when present,
// with synthesised fallbacks so the game always has sound.
// seconds to keep of each effect
const MAX_LEN = { 'sfx/hit': 0.25, 'sfx/step': 0.35, 'sfx/lift_shot': 0.6, 'sfx/push_shot': 0.9, 'sfx/empty': 0.3, 'sfx/land': 0.6, 'sfx/fall': 3, 'sfx/hurt_lift': 1.2, 'sfx/pickup': 0.8 };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.buf = {};        // name -> AudioBuffer (e.g. 'sfx/lift_shot', 'voice/knockout')
    this.voiceQueue = [];
    this.voiceBusy = false;
  }

  // must be called from a user gesture
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startWind();
    this.loadFiles();
  }

  // the server lists which recordings exist, so missing ones never cause 404s
  async loadFiles() {
    let list;
    try { list = await (await fetch('/api/audio')).json(); } catch { return; }
    const names = [...list.voice.map((n) => `voice/${n}`), ...list.sfx.map((n) => `sfx/${n}`)];
    await Promise.all(names.map(async (name) => {
      try {
        const data = await (await fetch(`/audio/${name}.mp3`)).arrayBuffer();
        this.buf[name] = await this.ctx.decodeAudioData(data);
      } catch { /* keep the synth fallback */ }
    }));
    if (this.buf['sfx/wind'] && this.buf['sfx/wind'].duration >= 4) this.startWind(); // too short to loop nicely otherwise
  }

  // play a recording; returns false if it isn't loaded (caller falls back to synth)
  play(name, pos = null, gain = 1, rate = 1) {
    const b = this.ctx && this.buf[name];
    if (!b) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    // generated clips often run long: cut each one to a sensible length with a short fade
    const max = MAX_LEN[name];
    const out = this.out(pos, gain);
    src.connect(out);
    src.start();
    if (max && b.duration > max) {
      const t = this.ctx.currentTime;
      out.gain.setValueAtTime(gain, t + max * 0.7);
      out.gain.linearRampToValueAtTime(0.0001, t + max);
      src.stop(t + max + 0.02);
    }
    return src;
  }

  // announcer lines play one after another, never on top of each other
  voice(name) {
    if (!this.ctx || !this.buf[`voice/${name}`]) return;
    if (this.voiceQueue.length >= 2) this.voiceQueue.shift();
    this.voiceQueue.push(name);
    if (!this.voiceBusy) this.nextVoice();
  }

  nextVoice() {
    const name = this.voiceQueue.shift();
    if (!name) { this.voiceBusy = false; return; }
    this.voiceBusy = true;
    const src = this.play(`voice/${name}`, null, 1.3);
    if (!src) { this.nextVoice(); return; }
    src.onended = () => setTimeout(() => this.nextVoice(), 120);
  }

  startWind() {
    const ctx = this.ctx;
    if (this.windSrc) { try { this.windSrc.stop(); } catch { /* already stopped */ } }
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    if (this.buf['sfx/wind'] && this.buf['sfx/wind'].duration >= 4) {
      src.buffer = this.buf['sfx/wind'];
      g.gain.value = 0.18;
      src.connect(g).connect(this.master);
    } else {
      src.buffer = this.noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      g.gain.value = 0.05;
      src.connect(lp).connect(g).connect(this.master);
    }
    src.loop = true;
    src.start();
    this.windSrc = src;
  }

  setListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = cam.position;
    const f = this._f || (this._f = cam.position.clone());
    const u = this._u || (this._u = cam.position.clone());
    cam.getWorldDirection(f);
    u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = u.x; l.upY.value = u.y; l.upZ.value = u.z;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  // output node: positional if pos given
  out(pos, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const pn = ctx.createPanner();
      pn.panningModel = 'equalpower';
      pn.distanceModel = 'inverse';
      pn.refDistance = 4;
      pn.rolloffFactor = 1.1;
      pn.maxDistance = 200;
      if (pn.positionX) { pn.positionX.value = pos.x; pn.positionY.value = pos.y; pn.positionZ.value = pos.z; }
      else pn.setPosition(pos.x, pos.y, pos.z);
      g.connect(pn).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  tone(dest, type, f0, f1, dur, vol, t0 = 0) {
    const ctx = this.ctx, t = ctx.currentTime + t0;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  burst(dest, type, f0, f1, dur, vol, q = 1, t0 = 0) {
    const ctx = this.ctx, t = ctx.currentTime + t0;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
  }

  shot(g, pos) {
    if (!this.ctx) return;
    if (this.play(g === 'L' ? 'sfx/lift_shot' : 'sfx/push_shot', pos, pos ? 1 : 0.7, 0.95 + Math.random() * 0.1)) return;
    const d = this.out(pos, pos ? 1 : 0.8);
    if (g === 'L') {
      this.tone(d, 'triangle', 260, 1100, 0.14, 0.32);
      this.tone(d, 'sine', 900, 2400, 0.08, 0.12);
      this.burst(d, 'bandpass', 3000, 1500, 0.05, 0.25, 2);
    } else {
      this.tone(d, 'sine', 140, 42, 0.28, 0.6);
      this.burst(d, 'lowpass', 1400, 200, 0.3, 0.55, 0.7);
      this.burst(d, 'bandpass', 600, 300, 0.12, 0.3, 1.5);
    }
  }

  hitConfirm() {
    if (!this.ctx || this.play('sfx/hit', null, 0.6)) return;
    this.tone(this.out(null, 0.5), 'square', 1500, 1400, 0.05, 0.2);
  }

  hurt(g) {
    if (!this.ctx || this.play(g === 'L' ? 'sfx/hurt_lift' : 'sfx/hurt_push', null, 0.8)) return;
    const d = this.out(null, 0.8);
    if (g === 'L') {
      this.burst(d, 'bandpass', 400, 2400, 0.5, 0.4, 3);
      this.tone(d, 'sine', 300, 700, 0.4, 0.15);
    } else {
      this.tone(d, 'sine', 90, 35, 0.3, 0.7);
      this.burst(d, 'lowpass', 900, 150, 0.25, 0.5);
    }
  }

  kill() {
    if (!this.ctx) return;
    const d = this.out(null, 0.45);
    this.tone(d, 'triangle', 660, 660, 0.12, 0.3);
    this.tone(d, 'triangle', 990, 990, 0.22, 0.3, 0.1);
  }

  death() {
    if (!this.ctx || this.play('sfx/fall', null, 0.8)) return;
    const d = this.out(null, 0.7);
    this.tone(d, 'sine', 1000, 110, 1.4, 0.25);
    this.burst(d, 'bandpass', 800, 3000, 1.4, 0.25, 1);
  }

  pickup() {
    if (!this.ctx || this.play('sfx/pickup', null, 0.6)) return;
    const d = this.out(null, 0.5);
    this.tone(d, 'sine', 660, 660, 0.09, 0.3);
    this.tone(d, 'sine', 1180, 1180, 0.16, 0.3, 0.08);
  }

  empty() {
    if (!this.ctx || this.play('sfx/empty', null, 0.6)) return;
    this.burst(this.out(null, 0.5), 'highpass', 3000, 3000, 0.03, 0.3, 1);
  }

  step(inWater) {
    if (!this.ctx) return;
    if (!inWater && this.play('sfx/step', null, 0.35, 0.85 + Math.random() * 0.3)) return;
    const d = this.out(null, 0.25);
    if (inWater) this.burst(d, 'bandpass', 900, 500, 0.18, 0.3, 1);
    else this.burst(d, 'lowpass', 500 + Math.random() * 300, 150, 0.07, 0.35, 1);
  }

  land(speed) {
    if (!this.ctx) return;
    const vol = Math.min(1, speed / 14);
    if (this.play('sfx/land', null, vol)) return;
    this.burst(this.out(null, vol), 'lowpass', 700, 100, 0.15, 0.6, 1);
  }

  splash(pos) {
    if (!this.ctx || this.play('sfx/splash', pos, 0.8)) return;
    this.burst(this.out(pos, 0.8), 'bandpass', 1500, 400, 0.5, 0.5, 0.8);
  }

  start() {
    if (!this.ctx) return;
    const d = this.out(null, 0.4);
    [523, 659, 784].forEach((f, i) => this.tone(d, 'triangle', f, f, 0.25, 0.25, i * 0.12));
  }
}
