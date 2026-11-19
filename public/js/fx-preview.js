// Little previews for the Effects tab: each effect shown on your art, a sample
// scene, a Blook or a picture of your own.
import { newDoc, newImage, clone } from './model.js';
import { exportSVG, svgDataUrl, rasterize } from './render.js';

export const SUBJECTS = { art: 'Your art', scene: 'Scene', blook: 'Blook', mine: 'Your picture' };
const MINE_KEY = 'bb-fx-photo';
const SUBJECT_PX = 220;
const TILE = 160;
const FILL = 0.74;

// Pieces with every effect taken off, so a preview shows just the one effect.
const EFFECT_PROPS = ['fx', 'dropShadow', 'underbelly', 'textures', 'texture'];
function plain(o) {
  const c = clone(o);
  for (const k of EFFECT_PROPS) delete c[k];
  c.blur = 0;
  c.pixel = 0;
  c.keys = [];
  return c;
}

const canvasUrl = (c) => c.toDataURL('image/png');

// A sunny hill, drawn here so every computer has it.
function drawScene() {
  const c = Object.assign(document.createElement('canvas'), { width: SUBJECT_PX, height: SUBJECT_PX });
  const x = c.getContext('2d'), S = SUBJECT_PX;
  const sky = x.createLinearGradient(0, 0, 0, S);
  sky.addColorStop(0, '#3a8ee8'); sky.addColorStop(0.6, '#9fd3ff'); sky.addColorStop(1, '#ffe2b0');
  x.fillStyle = sky; x.fillRect(0, 0, S, S);
  x.fillStyle = '#ffd23f'; x.beginPath(); x.arc(S * 0.74, S * 0.26, S * 0.12, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255,255,255,.9)';
  for (const [cx, cy, r] of [[0.2, 0.2, 0.07], [0.29, 0.18, 0.09], [0.37, 0.21, 0.06]]) { x.beginPath(); x.arc(S * cx, S * cy, S * r, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#4caf50'; x.beginPath(); x.moveTo(0, S * 0.7); x.quadraticCurveTo(S * 0.3, S * 0.5, S * 0.65, S * 0.68); x.quadraticCurveTo(S * 0.85, S * 0.6, S, S * 0.66); x.lineTo(S, S); x.lineTo(0, S); x.fill();
  x.fillStyle = '#2e7d32'; x.beginPath(); x.moveTo(0, S * 0.85); x.quadraticCurveTo(S * 0.5, S * 0.7, S, S * 0.82); x.lineTo(S, S); x.lineTo(0, S); x.fill();
  x.fillStyle = '#6d4c2f'; x.fillRect(S * 0.18, S * 0.5, S * 0.05, S * 0.18);
  x.fillStyle = '#1b5e20'; x.beginPath(); x.arc(S * 0.205, S * 0.47, S * 0.09, 0, Math.PI * 2); x.fill();
  for (const [fx, col] of [[0.45, '#e8453c'], [0.55, '#ff8fc7'], [0.7, '#ffffff'], [0.82, '#e8453c']]) { x.fillStyle = col; x.beginPath(); x.arc(S * fx, S * 0.9, S * 0.025, 0, Math.PI * 2); x.fill(); }
  return canvasUrl(c);
}

async function imageUrl(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: SUBJECT_PX, height: SUBJECT_PX });
  const k = SUBJECT_PX / Math.max(img.naturalWidth || SUBJECT_PX, img.naturalHeight || SUBJECT_PX);
  const w = (img.naturalWidth || SUBJECT_PX) * k, h = (img.naturalHeight || SUBJECT_PX) * k;
  c.getContext('2d').drawImage(img, (SUBJECT_PX - w) / 2, (SUBJECT_PX - h) / 2, w, h);
  return canvasUrl(c);
}

// The picked art on its own, as a small picture.
async function artUrl(items, box) {
  if (!items.length || !box?.width || !box?.height) return drawScene();
  const doc = newDoc({ name: 'p', width: Math.ceil(box.width), height: Math.ceil(box.height) });
  doc.background = 'none';
  doc.cornerRadius = 0;
  doc.layers[0].objects = items.map((o) => { const c = plain(o); c.x -= box.x; c.y -= box.y; delete c.page; return c; });
  const k = SUBJECT_PX / Math.max(box.width, box.height);
  const canvas = await rasterize(exportSVG(doc, { overlay: false }), Math.max(1, Math.round(box.width * k)), Math.max(1, Math.round(box.height * k)));
  return canvasUrl(canvas);
}

const cache = new Map();

// The picture every tile starts from. key: anything that changes when the art does.
export async function subjectUrl(kind, items, box, key) {
  const id = `${kind}:${kind === 'art' ? key : kind === 'mine' ? mineUrl()?.length : ''}`;
  if (!cache.has(id)) {
    const make = kind === 'art' ? artUrl(items, box)
      : kind === 'blook' ? imageUrl('/showcase/pumpkin-dragon.svg')
        : kind === 'mine' && mineUrl() ? Promise.resolve(mineUrl())
          : Promise.resolve(drawScene());
    cache.set(id, make.catch(() => drawScene()));
  }
  return cache.get(id);
}

export function mineUrl() {
  try { return localStorage.getItem(MINE_KEY); } catch { return null; }
}

// Shrinks a picture you chose and keeps it in this browser for next time.
export async function setMine(dataUrl) {
  const small = await imageUrl(dataUrl);
  try { localStorage.setItem(MINE_KEY, small); } catch { /* Just for now, then. */ }
  return small;
}

// One tile: the picture with one effect on, through the same drawing code as the art.
export function tileUrl(subject, apply) {
  const doc = newDoc({ name: 't', width: TILE, height: TILE });
  doc.background = '#eef1f6';
  doc.cornerRadius = 0;
  const size = TILE * FILL;
  const o = newImage({ name: 'p', href: subject, x: TILE / 2, y: TILE / 2, w: size, h: size });
  apply(o);
  doc.layers[0].objects.push(o);
  return svgDataUrl(exportSVG(doc, { overlay: false }));
}
