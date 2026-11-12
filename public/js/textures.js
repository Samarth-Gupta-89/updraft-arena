// Procedural canvas textures, so the game ships with zero image files.
import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise (lattice wraps at `period`).
function phash(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function pnoise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const m = (v) => ((v % period) + period) % period;
  const x0 = m(ix), x1 = m(ix + 1), y0 = m(iy), y1 = m(iy + 1);
  const a = phash(x0, y0, seed), b = phash(x1, y0, seed), c = phash(x0, y1, seed), d = phash(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
// u,v in [0,1): tileable fbm
function tfbm(u, v, base, oct, seed) {
  let s = 0, amp = 0.5, n = 0, p = base;
  for (let i = 0; i < oct; i++) {
    s += amp * pnoise(u * p, v * p, p, seed + i * 17);
    n += amp; amp *= 0.5; p *= 2;
  }
  return s / n;
}

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(canvas, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 2; // 8 was noticeably slower on laptop graphics chips
  return t;
}

// Fill a canvas pixel-by-pixel. fn(u, v, x, y) -> [r,g,b,(a)] 0..255
function fill(size, fn, h = size) {
  const [c, g] = makeCanvas(size, h);
  const img = g.createImageData(size, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const px = fn(x / size, y / h, x, y);
      const i = (y * size + x) * 4;
      d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = px.length > 3 ? px[3] : 255;
    }
  }
  g.putImageData(img, 0, 0);
  return [c, g];
}

const clamp255 = (v) => Math.max(0, Math.min(255, v | 0));

// ---------------------------------------------------------------- terrain detail (neutral, multiplied by vertex colour)
export function terrainDetail() {
  const r = rng(11);
  const [c, g] = fill(512, (u, v) => {
    const n = tfbm(u, v, 8, 5, 3);
    const fine = pnoise(u * 128, v * 128, 128, 9);
    const l = 190 + (n - 0.5) * 70 + (fine - 0.5) * 40;
    return [clamp255(l), clamp255(l + 4), clamp255(l - 6)];
  });
  // little blade strokes / specks for grain
  for (let i = 0; i < 9000; i++) {
    const x = r() * 512, y = r() * 512, len = 2 + r() * 5;
    const s = r() < 0.5 ? 150 + r() * 40 : 225 + r() * 30;
    g.strokeStyle = `rgba(${s},${s + 6},${s - 10},0.55)`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y - len); g.stroke();
  }
  return toTex(c, { repeat: [28, 21] });
}

// ---------------------------------------------------------------- concrete
export function concrete() {
  const r = rng(21);
  const [c, g] = fill(512, (u, v) => {
    const n = tfbm(u, v, 4, 5, 5);
    const stain = tfbm(u, v, 2, 3, 77);
    const grain = pnoise(u * 256, v * 256, 256, 6);
    let l = 150 + (n - 0.5) * 50 + (grain - 0.5) * 26;
    if (stain > 0.62) l -= (stain - 0.62) * 140;
    // rain streaks
    l -= Math.max(0, pnoise(u * 40, v * 3, 40, 8) - 0.7) * 90;
    return [clamp255(l), clamp255(l - 1), clamp255(l - 5)];
  });
  // formwork panel seams + tie holes
  g.strokeStyle = 'rgba(40,40,38,0.45)';
  g.lineWidth = 2;
  for (const y of [0, 256]) { g.beginPath(); g.moveTo(0, y + 1); g.lineTo(512, y + 1); g.stroke(); }
  for (const x of [0, 256]) { g.beginPath(); g.moveTo(x + 1, 0); g.lineTo(x + 1, 512); g.stroke(); }
  g.fillStyle = 'rgba(30,30,30,0.6)';
  for (const x of [64, 192, 320, 448]) for (const y of [64, 192, 320, 448]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '20,20,20' : '230,230,225'},${0.2 + r() * 0.3})`;
    g.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
  }
  return toTex(c);
}

// ---------------------------------------------------------------- granite paving slabs (neutral, multiplied by vertex colour)
export function paving() {
  const r = rng(31);
  const tone = Array.from({ length: 16 }, () => (r() - 0.5) * 26);
  const [c, g] = fill(512, (u, v) => {
    const slab = tone[(Math.floor(u * 4) % 4) + (Math.floor(v * 4) % 4) * 4];
    const speck = pnoise(u * 256, v * 256, 256, 12), n = tfbm(u, v, 6, 4, 14);
    const l = 205 + slab + (n - 0.5) * 30 + (speck - 0.5) * 34;
    return [clamp255(l), clamp255(l - 2), clamp255(l - 8)];
  });
  g.strokeStyle = 'rgba(70,66,58,0.55)';
  g.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    g.beginPath(); g.moveTo(0, k * 128 + 1); g.lineTo(512, k * 128 + 1); g.stroke();
    g.beginPath(); g.moveTo(k * 128 + 1, 0); g.lineTo(k * 128 + 1, 512); g.stroke();
  }
  return toTex(c, { repeat: [28, 21] });
}

// ---------------------------------------------------------------- lime-washed plaster (compound walls, buildings)
export function plaster() {
  const [c] = fill(256, (u, v) => {
    const n = tfbm(u, v, 4, 4, 41), stain = tfbm(u, v, 2, 3, 43);
    let l = 232 + (n - 0.5) * 26;
    if (stain > 0.64) l -= (stain - 0.64) * 90;
    return [clamp255(l), clamp255(l - 4), clamp255(l - 16)];
  });
  return toTex(c);
}

// ---------------------------------------------------------------- terracotta roof tiles
export function roofTiles() {
  const [c, g] = fill(256, (u, v) => {
    const row = (v * 8) % 1, colm = (u * 12 + (Math.floor(v * 8) % 2) * 0.5) % 1;
    const n = tfbm(u, v, 6, 3, 51);
    let l = 1 - row * 0.28 - (colm < 0.12 ? 0.22 : 0) + (n - 0.5) * 0.25;
    return [clamp255(196 * l), clamp255(92 * l), clamp255(52 * l)];
  });
  void g;
  return toTex(c);
}

// ---------------------------------------------------------------- hazard stripes
export function hazard() {
  const [c, g] = makeCanvas(256, 64);
  g.fillStyle = '#1d1d1b';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#e8b51f';
  for (let x = -64; x < 320; x += 64) {
    g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 32, 64); g.lineTo(x + 96, 0); g.lineTo(x + 64, 0); g.closePath(); g.fill();
  }
  const r = rng(5);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(60,55,45,${r() * 0.5})`;
    g.fillRect(r() * 256, r() * 64, 2 + r() * 6, 1 + r() * 3);
  }
  return toTex(c);
}

// ---------------------------------------------------------------- wooden crate
export function crate() {
  const r = rng(31);
  const S = 512;
  const [c, g] = fill(S, (u, v, x, y) => {
    const plank = Math.floor(v * 6);
    const tone = phash(plank, 3, 4);
    const grain = Math.sin((u * 60 + pnoise(u * 8, v * 40, 8, plank) * 6) * 2.2) * 0.5 + 0.5;
    const n = tfbm(u, v, 8, 3, plank + 2);
    let l = 0.78 + tone * 0.2 + grain * 0.08 + (n - 0.5) * 0.2;
    if ((y % (S / 6)) < 3) l *= 0.45; // plank gaps
    return [clamp255(168 * l), clamp255(118 * l), clamp255(68 * l)];
  });
  // frame
  const F = 46;
  g.fillStyle = 'rgba(120,80,42,1)';
  const frame = (x, y, w, h) => {
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(40,24,10,0.6)'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
  };
  frame(0, 0, S, F); frame(0, S - F, S, F); frame(0, 0, F, S); frame(S - F, 0, F, S);
  // diagonal brace
  g.save(); g.translate(S / 2, S / 2); g.rotate(-Math.PI / 4);
  g.fillStyle = 'rgba(128,86,46,1)'; g.fillRect(-S * 0.62, -F / 2, S * 1.24, F);
  g.strokeStyle = 'rgba(40,24,10,0.6)'; g.strokeRect(-S * 0.62, -F / 2, S * 1.24, F);
  g.restore();
  // nails + grime
  g.fillStyle = '#3a3530';
  for (const [x, y] of [[23, 23], [S - 23, 23], [23, S - 23], [S - 23, S - 23], [S / 2, 23], [S / 2, S - 23], [23, S / 2], [S - 23, S / 2]]) {
    g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(40,28,15,${r() * 0.18})`;
    g.beginPath(); g.arc(r() * S, r() * S, 6 + r() * 30, 0, 7); g.fill();
  }
  g.font = 'bold 44px sans-serif';
  g.fillStyle = 'rgba(30,20,10,0.5)';
  g.textAlign = 'center';
  g.fillText('FRAGILE', S / 2, S / 2 + 90);
  return toTex(c);
}

// ---------------------------------------------------------------- shipping container (white-based; tinted by material.color)
export function container(seed = 1) {
  const r = rng(40 + seed);
  const S = 512;
  const [c, g] = fill(S, (u, v) => {
    const ridge = Math.abs(((u * 24) % 1) - 0.5) * 2; // triangle wave
    const shade = 0.72 + 0.28 * Math.min(1, ridge * 1.6);
    const n = tfbm(u, v, 4, 4, seed);
    let l = shade * (0.9 + (n - 0.5) * 0.25);
    const rust = Math.max(0, pnoise(u * 30, v * 2.5, 30, seed + 9) - 0.62) * 2.2;
    const dirt = Math.max(0, v - 0.75) * 0.9;
    l *= 1 - dirt * 0.5;
    return [clamp255(255 * l * (1 - rust * 0.15)), clamp255(255 * l * (1 - rust * 0.45)), clamp255(255 * l * (1 - rust * 0.7))];
  });
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, S - 6, S - 6);
  g.font = 'bold 30px monospace';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText(`UPDU ${String(100000 + Math.floor(r() * 899999))} ${Math.floor(r() * 9)}`, 30, 52);
  g.font = '20px monospace';
  g.fillText('MAX GROSS 30480 KG', 30, 82);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(90,50,25,${r() * 0.25})`;
    g.fillRect(r() * S, r() * S * 0.3 + S * 0.7, 2 + r() * 4, 10 + r() * 60);
  }
  return toTex(c);
}

// ---------------------------------------------------------------- rock
export function rock() {
  const [c] = fill(512, (u, v) => {
    const n = tfbm(u, v, 4, 6, 12);
    const ridged = 1 - Math.abs(tfbm(u, v, 6, 3, 44) * 2 - 1);
    const lichen = tfbm(u, v, 8, 3, 90);
    let l = 105 + (n - 0.5) * 90;
    if (ridged > 0.93) l -= (ridged - 0.93) * 900;
    let rr = l + 6, gg = l + 2, bb = l - 4;
    if (lichen > 0.64) { const k = (lichen - 0.64) * 3; rr -= 20 * k; gg += 18 * k; bb -= 30 * k; }
    return [clamp255(rr), clamp255(gg), clamp255(bb)];
  });
  return toTex(c);
}

export function bark() {
  const [c] = fill(256, (u, v) => {
    const n = pnoise(u * 16, v * 2, 16, 3) * 0.7 + pnoise(u * 48, v * 6, 48, 5) * 0.3;
    const l = 0.45 + n * 0.55;
    return [clamp255(98 * l), clamp255(72 * l), clamp255(50 * l)];
  });
  return toTex(c, { repeat: [2, 4] });
}

// ---------------------------------------------------------------- water normal map
export function waterNormal() {
  const S = 256;
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = tfbm(x / S, y / S, 6, 4, 55);
  const [c] = fill(S, (u, v, x, y) => {
    const hx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)];
    const hy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
    const nx = -hx * 6, ny = -hy * 6, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    return [clamp255((nx / l * 0.5 + 0.5) * 255), clamp255((ny / l * 0.5 + 0.5) * 255), clamp255((nz / l * 0.5 + 0.5) * 255)];
  });
  return toTex(c, { srgb: false, repeat: [5, 3] });
}

// ---------------------------------------------------------------- soft glow sprite
export function glow() {
  const [c, g] = makeCanvas(128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- name tag
export function nameTag(text, color) {
  const [c, g] = makeCanvas(256, 64);
  g.font = 'bold 30px "Chakra Petch", sans-serif';
  const w = Math.min(248, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(10,14,20,0.55)';
  const x = (256 - w) / 2;
  g.beginPath();
  g.roundRect(x, 10, w, 44, 10);
  g.fill();
  g.fillStyle = color;
  g.fillRect(x, 50, w, 4);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
