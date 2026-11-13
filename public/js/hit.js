// What a click lands on. Pictures only count where they can be seen: a click on
// a see-through part of a picture goes through to whatever is under it.
import { findObj } from './state.js';

const SAMPLE_PX = 1024;
const SOLID = 16;

// A small copy of each picture's see-through-ness, made once per picture.
const alphas = new Map();

export function primeAlpha(href) {
  if (!href || alphas.has(href)) return;
  alphas.set(href, null);
  const img = new Image();
  img.onload = () => {
    const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512;
    const k = Math.min(1, SAMPLE_PX / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    try {
      const data = ctx.getImageData(0, 0, w, h).data;
      const alpha = new Uint8Array(w * h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
      alphas.set(href, { w, h, alpha });
    } catch { alphas.delete(href); }
  };
  img.src = href;
}

// Whether the picture element shows anything at this point on the screen. Until
// a picture has been looked at, it counts as solid everywhere.
function solidAt(picture, clientX, clientY) {
  const href = picture.getAttribute('href');
  const map = alphas.get(href);
  if (!map) { primeAlpha(href); return true; }
  const m = picture.getScreenCTM();
  if (!m) return true;
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  const x = +picture.getAttribute('x'), y = +picture.getAttribute('y');
  const w = +picture.getAttribute('width'), h = +picture.getAttribute('height');
  const u = (p.x - x) / w, v = (p.y - y) / h;
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
  return map.alpha[Math.floor(v * map.h) * map.w + Math.floor(u * map.w)] >= SOLID;
}

// The top thing that can be seen at this point, skipping locked and hidden ones.
export function solidHit(clientX, clientY) {
  const seen = new Set();
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const host = el.closest?.('#art [data-id]');
    if (!host || seen.has(host)) continue;
    seen.add(host);
    const o = findObj(host.dataset.id);
    if (!o || o.locked || o.hidden) continue;
    if (o.type === 'image') {
      const picture = host.querySelector('image');
      if (picture && !solidAt(picture, clientX, clientY)) continue;
    }
    return o;
  }
  return null;
}
