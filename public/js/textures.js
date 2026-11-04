// Textures: a repeating pattern drawn over a fill. They line up across the whole
// canvas, so pieces that share one look like one surface. In an animation they
// can slide, a whole number of tiles per loop so the loop never jumps.
import { round } from './model.js';
import { esc } from './render.js';

const star = (t) => {
  const c = t / 2, a = t * 0.32, q = t * 0.04;
  return `M${c} ${c - a}Q${c + q} ${c - q} ${c + a} ${c}Q${c + q} ${c + q} ${c} ${c + a}Q${c - q} ${c + q} ${c - a} ${c}Q${c - q} ${c - q} ${c} ${c - a}Z`;
};

export const TEXTURES = {
  dots: { name: 'Dots', tile: (t, c) => `<circle cx="${t / 2}" cy="${t / 2}" r="${round(t * 0.2)}" fill="${c}"/>` },
  stripes: { name: 'Stripes', tile: (t, c) => `<rect width="${t}" height="${round(t * 0.4)}" fill="${c}"/>` },
  checks: { name: 'Checks', tile: (t, c) => `<rect width="${t / 2}" height="${t / 2}" fill="${c}"/><rect x="${t / 2}" y="${t / 2}" width="${t / 2}" height="${t / 2}" fill="${c}"/>` },
  grid: { name: 'Grid', tile: (t, c) => `<path d="M0 ${t / 2}H${t}M${t / 2} 0V${t}" fill="none" stroke="${c}" stroke-width="${round(t * 0.1)}"/>` },
  waves: { name: 'Waves', tile: (t, c) => `<path d="M0 ${t / 2}Q${t / 4} ${round(t * 0.2)} ${t / 2} ${t / 2}T${t} ${t / 2}" fill="none" stroke="${c}" stroke-width="${round(t * 0.12)}"/>` },
  sparkles: { name: 'Sparkles', tile: (t, c) => `<path d="${star(t)}" fill="${c}"/>` },
  picture: { name: 'Picture', tile: (t, c, tex) => (tex.href ? `<image href="${esc(tex.href)}" width="${t}" height="${t}" preserveAspectRatio="xMidYMid slice"/>` : '') },
};

export const MOVES = {
  none: { name: 'Still', dx: 0, dy: 0 },
  right: { name: 'Right', dx: 1, dy: 0 },
  left: { name: 'Left', dx: -1, dy: 0 },
  down: { name: 'Down', dx: 0, dy: 1 },
  up: { name: 'Up', dx: 0, dy: -1 },
  diagonal: { name: 'Diagonal', dx: 1, dy: 1 },
};

export const newTexture = (kind = 'dots') => ({ kind, color: '#ffffff', size: 40, angle: 0, opacity: 0.5, move: 'none', speed: 1 });

const moving = (tex, doc) => !!(doc?.animated && doc.frames > 1 && (MOVES[tex.move]?.dx || MOVES[tex.move]?.dy));
const tileOf = (tex) => Math.max(4, tex.size || 40);

// How far the texture has slid on a frame: speed is tiles per loop.
export function textureOffset(tex, frame, doc) {
  if (!moving(tex, doc)) return [0, 0];
  const move = MOVES[tex.move];
  const k = ((frame % doc.frames) / doc.frames) * (tex.speed || 1) * tileOf(tex);
  return [move.dx * k, move.dy * k];
}

// o: where the textured thing sits, so the pattern can undo that and stay put
// on the canvas. Leave it out for the background.
export function patternMarkup(tex, id, o, frame, opt = {}) {
  const kind = TEXTURES[tex.kind];
  if (!kind) return '';
  const t = tileOf(tex);
  const color = esc(tex.color || '#ffffff');
  const undo = o ? `scale(${round(1 / (o.scaleX || 1), 6)} ${round(1 / (o.scaleY || 1), 6)}) rotate(${round(-o.rotation)}) translate(${round(-o.x)} ${round(-o.y)}) ` : '';
  const live = opt.animate && moving(tex, opt.doc);
  const [ox, oy] = live ? [0, 0] : textureOffset(tex, frame, opt.doc);
  const move = MOVES[tex.move];
  const slide = live
    ? `<animateTransform attributeName="patternTransform" type="translate" additive="sum" from="0 0" to="${round(move.dx * (tex.speed || 1) * t)} ${round(move.dy * (tex.speed || 1) * t)}" dur="${round(opt.doc.frames / opt.doc.fps, 3)}s" repeatCount="indefinite"/>`
    : '';
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${t}" height="${t}" patternTransform="${undo}rotate(${round(tex.angle || 0)}) translate(${round(ox)} ${round(oy)})">${slide}<g opacity="${round(tex.opacity ?? 0.5, 3)}">${kind.tile(t, color, tex)}</g></pattern>`;
}
