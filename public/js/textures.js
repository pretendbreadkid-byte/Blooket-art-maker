// Textures: a repeating pattern drawn over a fill. They line up across the whole
// canvas, so pieces that share one look like one surface. In an animation they
// can slide, a whole number of tiles per loop so the loop never jumps.
import { round } from './model.js';
import { esc } from './render.js';
import { BLOOKS_TILE } from './texture-art.js';

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
  // Like the two strips across a pack, one thick and one thin. In an animation it sweeps.
  shine: {
    name: 'Shine',
    look: { size: 220, angle: 35, opacity: 0.3, move: 'right', speed: 1 },
    tile: (t, c) => `<rect x="${round(t * 0.1)}" width="${round(t * 0.26)}" height="${t}" fill="${c}"/><rect x="${round(t * 0.46)}" width="${round(t * 0.09)}" height="${t}" fill="${c}"/>`,
  },
  // Lines on both edges of a tile meet the next tile's, so every joint is the same width.
  bricks: {
    name: 'Bricks',
    look: { size: 60, angle: 0, opacity: 0.35 },
    tile: (t, c) => `<path d="M0 0H${t}M0 ${t / 2}H${t}M0 ${t}H${t}M0 0V${t / 2}M${t} 0V${t / 2}M${t / 2} ${t / 2}V${t}" fill="none" stroke="${c}" stroke-width="${round(t * 0.07)}"/>`,
  },
  planks: {
    name: 'Planks',
    look: { size: 90, angle: 0, opacity: 0.3 },
    tile: (t, c) => `<path d="M0 0H${t}M0 ${round(t / 3)}H${t}M0 ${round((t * 2) / 3)}H${t}M0 ${t}H${t}M${round(t * 0.3)} 0V${round(t / 3)}M${round(t * 0.8)} ${round(t / 3)}V${round((t * 2) / 3)}M${round(t * 0.55)} ${round((t * 2) / 3)}V${t}" fill="none" stroke="${c}" stroke-width="${round(t * 0.04)}"/>`,
  },
  scales: {
    name: 'Scales',
    look: { size: 40, angle: 0, opacity: 0.35 },
    tile: (t, c) => `<path d="M0 ${t / 2}A${t / 2} ${t / 2} 0 0 0 ${t} ${t / 2}M${-t / 2} ${t}A${t / 2} ${t / 2} 0 0 0 ${t / 2} ${t}A${t / 2} ${t / 2} 0 0 0 ${round(t * 1.5)} ${t}M${-t / 2} 0A${t / 2} ${t / 2} 0 0 0 ${t / 2} 0A${t / 2} ${t / 2} 0 0 0 ${round(t * 1.5)} 0" fill="none" stroke="${c}" stroke-width="${round(t * 0.08)}"/>`,
  },
  zigzag: {
    name: 'Zigzag',
    look: { size: 40, angle: 0, opacity: 0.4 },
    tile: (t, c) => `<path d="M0 ${round(t * 0.7)}L${t / 4} ${round(t * 0.3)}L${t / 2} ${round(t * 0.7)}L${round(t * 0.75)} ${round(t * 0.3)}L${t} ${round(t * 0.7)}" fill="none" stroke="${c}" stroke-width="${round(t * 0.12)}" stroke-linejoin="round"/>`,
  },
  diamonds: {
    name: 'Diamonds',
    look: { size: 36, angle: 0, opacity: 0.4 },
    tile: (t, c) => `<path d="M${t / 2} ${round(t * 0.12)}L${round(t * 0.88)} ${t / 2}L${t / 2} ${round(t * 0.88)}L${round(t * 0.12)} ${t / 2}Z" fill="${c}"/>`,
  },
  hearts: {
    name: 'Hearts',
    look: { size: 44, angle: 0, opacity: 0.45 },
    tile: (t, c) => {
      const k = t / 24;
      return `<path transform="scale(${round(k, 4)})" d="M12 19.5C6 15 4 12.3 4 9.6 4 7.5 5.7 6 7.700 6c1.700 0 3.200 1 4.300 2.600C13.100 7 14.600 6 16.300 6 18.300 6 20 7.500 20 9.600c0 2.700-2 5.400-8 9.900z" fill="${c}"/>`;
    },
  },
  // White Blook shapes like the pattern behind Blooket's screens. The picture is a
  // mask, so the texture colour tints it.
  blooks: {
    name: 'Blooks',
    ratio: BLOOKS_TILE.height / BLOOKS_TILE.width,
    look: { size: 200, angle: 0, opacity: 0.25 },
    tile: (t, c, tex, id, th) => `<mask id="${id}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${th}">`
      + `<image href="data:image/webp;base64,${BLOOKS_TILE.data}" width="${t}" height="${th}" preserveAspectRatio="none"/></mask>`
      + `<rect width="${t}" height="${th}" fill="${c}" mask="url(#${id}-m)"/>`,
  },
  picture: { name: 'Picture', tile: (t, c, tex) => (tex.href ? `<image href="${esc(tex.href)}" width="${t}" height="${t}" preserveAspectRatio="xMidYMid slice"/>` : '') },
};

// How a kind starts out when picked. animated: only a moving project gets a move.
export function kindLook(kind, animated = false) {
  const { move, speed, ...look } = TEXTURES[kind]?.look || {};
  return { ...look, ...(animated && move ? { move, speed } : {}) };
}

export const MOVES = {
  none: { name: 'Still', dx: 0, dy: 0 },
  right: { name: 'Right', dx: 1, dy: 0 },
  left: { name: 'Left', dx: -1, dy: 0 },
  down: { name: 'Down', dx: 0, dy: 1 },
  up: { name: 'Up', dx: 0, dy: -1 },
  diagonal: { name: 'Diagonal', dx: 1, dy: 1 },
};

// A thing's textures, top last. Older art kept just one, as `texture`.
export const texturesOf = (o) => (Array.isArray(o?.textures) ? o.textures : o?.texture ? [o.texture] : []);
export const bgTexturesOf = (doc) => (Array.isArray(doc?.bgTextures) ? doc.bgTextures : doc?.bgTexture ? [doc.bgTexture] : []);

export const newTexture = (kind = 'dots', animated = false) => ({
  kind, color: '#ffffff', size: 40, angle: 0, opacity: 0.5, move: 'none', speed: 1, ...kindLook(kind, animated),
});

const moving = (tex, doc) => !!(doc?.animated && doc.frames > 1 && (MOVES[tex.move]?.dx || MOVES[tex.move]?.dy));
const tileOf = (tex) => Math.max(4, tex.size || 40);

// How far the texture has slid on a frame: speed is tiles per loop.
export function textureOffset(tex, frame, doc) {
  if (!moving(tex, doc)) return [0, 0];
  const move = MOVES[tex.move];
  const k = ((frame % doc.frames) / doc.frames) * (tex.speed || 1) * tileOf(tex);
  return [move.dx * k, move.dy * k * (TEXTURES[tex.kind]?.ratio || 1)];
}

// o: where the textured thing sits, so the pattern can undo that and stay put
// on the canvas. Leave it out for the background.
export function patternMarkup(tex, id, o, frame, opt = {}) {
  const kind = TEXTURES[tex.kind];
  if (!kind) return '';
  const t = tileOf(tex);
  const th = round(t * (kind.ratio || 1), 2);
  const color = esc(tex.color || '#ffffff');
  const undo = o ? `scale(${round(1 / (o.scaleX || 1), 6)} ${round(1 / (o.scaleY || 1), 6)}) rotate(${round(-o.rotation)}) translate(${round(-o.x)} ${round(-o.y)}) ` : '';
  const live = opt.animate && moving(tex, opt.doc);
  const [ox, oy] = live ? [0, 0] : textureOffset(tex, frame, opt.doc);
  const move = MOVES[tex.move];
  const slide = live
    ? `<animateTransform attributeName="patternTransform" type="translate" additive="sum" from="0 0" to="${round(move.dx * (tex.speed || 1) * t)} ${round(move.dy * (tex.speed || 1) * th)}" dur="${round(opt.doc.frames / opt.doc.fps, 3)}s" repeatCount="indefinite"/>`
    : '';
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${t}" height="${th}" patternTransform="${undo}rotate(${round(tex.angle || 0)}) translate(${round(ox)} ${round(oy)})">${slide}<g opacity="${round(tex.opacity ?? 0.5, 3)}">${kind.tile(t, color, tex, id, th)}</g></pattern>`;
}
