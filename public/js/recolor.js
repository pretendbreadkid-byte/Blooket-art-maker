// Swapping one colour for another everywhere some art uses it: fills, outlines,
// gradients, textures, keyframes, and the colours written inside SVG pictures.
// Other pictures are recoloured pixel by pixel, keeping their shading.
import { findPalette } from './trace.js';

const MAX_SWATCHES = 16;
const MAX_PICTURE = 2048;
const PICTURE_COLOURS = 8;

export function normalColor(c) {
  if (typeof c !== 'string') return null;
  const v = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((x) => x + x).join('')}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/* ---------- SVG pictures ---------- */

const SVG_HREF = /^data:image\/svg\+xml(;base64)?,/i;

export function svgOf(href) {
  const head = typeof href === 'string' && href.match(SVG_HREF);
  if (!head) return null;
  const body = href.slice(head[0].length);
  if (!head[1]) return decodeURIComponent(body);
  return new TextDecoder().decode(Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0)));
}

function svgHref(svg) {
  const bytes = new TextEncoder().encode(svg);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(text)}`;
}
const HEX_IN_SVG = /#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z_-])/gi;

/* ---------- Every colour slot in some art ---------- */

function slots(o, visit) {
  for (const s of [o, ...(o.keys || []).map((k) => k.pose)]) {
    for (const key of ['fill', 'stroke']) if (s[key] !== undefined) visit(s[key], (v) => { s[key] = v; });
    const g = s.gradient;
    if (g?.raw) g.raw.stops.forEach((stop) => visit(stop[1], (v) => { stop[1] = v; }));
    else if (g) { visit(g.from, (v) => { g.from = v; }); visit(g.to, (v) => { g.to = v; }); }
  }
  for (const tex of [...(o.textures || []), ...(o.texture ? [o.texture] : [])]) visit(tex.color, (v) => { tex.color = v; });
  // A welded shape's pieces keep their own colours.
  for (const part of o.parts || []) slots(part, visit);
}

// The colours in some art, most used first.
export function colorsIn(objects) {
  const count = new Map();
  const add = (c) => { const n = normalColor(c); if (n) count.set(n, (count.get(n) || 0) + 1); };
  for (const o of objects) {
    slots(o, add);
    const svg = o.type === 'image' && svgOf(o.href);
    if (svg) for (const m of svg.match(HEX_IN_SVG) || []) add(m);
    for (const part of o.parts || []) {
      const inner = part.type === 'image' && svgOf(part.href);
      if (inner) for (const m of inner.match(HEX_IN_SVG) || []) add(m);
    }
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, MAX_SWATCHES).map(([c]) => c);
}

export function swapColor(objects, from, to) {
  const target = normalColor(from);
  for (const o of objects) {
    slots(o, (value, set) => { if (normalColor(value) === target) set(to); });
    const svg = o.type === 'image' && svgOf(o.href);
    if (svg) o.href = svgHref(svg.replace(HEX_IN_SVG, (m) => (normalColor(m) === target ? to : m)));
  }
}

/* ---------- Other pictures, in the browser ---------- */

async function pixelsOf(href) {
  const img = new Image();
  img.src = href;
  await img.decode();
  const scale = Math.min(1, MAX_PICTURE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.max(1, Math.round(img.naturalWidth * scale)), height: Math.max(1, Math.round(img.naturalHeight * scale)),
  });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

const isRaster = (o) => o.type === 'image' && !svgOf(o.href);

export async function pictureColors(objects) {
  const found = [];
  for (const o of objects.filter(isRaster)) {
    const { data } = await pixelsOf(o.href);
    const mask = new Uint8Array(data.width * data.height).map((_, i) => (data.data[i * 4 + 3] > 24 ? 1 : 0));
    for (const rgb of findPalette(data.data, mask, PICTURE_COLOURS)) found.push(toHex(rgb));
  }
  return found;
}

// Pixels closest to `from` shift by the same amount, so shading and edges stay.
export async function recolorPictures(objects, from, to) {
  const a = toRgb(from), b = toRgb(to), shift = b.map((v, i) => v - a[i]);
  for (const o of objects.filter(isRaster)) {
    const { canvas, ctx, data } = await pixelsOf(o.href);
    const mask = new Uint8Array(data.width * data.height).map((_, i) => (data.data[i * 4 + 3] > 24 ? 1 : 0));
    const palette = findPalette(data.data, mask, PICTURE_COLOURS);
    if (!palette.length) continue;
    const mine = palette.reduce((best, c, i) => {
      const d = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 + (c[2] - a[2]) ** 2;
      return d < best.d ? { i, d } : best;
    }, { i: -1, d: Infinity }).i;
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8) continue;
      let near = 0, nearDist = Infinity;
      for (let k = 0; k < palette.length; k++) {
        const c = palette[k], d = (c[0] - px[i]) ** 2 + (c[1] - px[i + 1]) ** 2 + (c[2] - px[i + 2]) ** 2;
        if (d < nearDist) { nearDist = d; near = k; }
      }
      if (near !== mine) continue;
      for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, px[i + k] + shift[k]));
    }
    ctx.putImageData(data, 0, 0);
    o.href = canvas.toDataURL('image/png');
  }
}
