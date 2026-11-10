// Turns a document into SVG markup. The editor, thumbnails, the bucket tool and
// export all use this file, so what you see is what you get.
import { pathD, pathBounds, localToWorld, sample, round, rad, isPages, objectsOn } from './model.js';
import { overlayMarkup } from './templates.js';
import { patternMarkup } from './textures.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MASK_SIZE = 20000;

const transformOf = (o) => `translate(${round(o.x)} ${round(o.y)}) rotate(${round(o.rotation)}) scale(${round(o.scaleX, 4)} ${round(o.scaleY, 4)})`;

function strokeAttrs(o) {
  if (!o.stroke || o.stroke === 'none' || !o.strokeWidth) return 'stroke="none"';
  const cap = o.look?.['stroke-linecap'] || 'round', join = o.look?.['stroke-linejoin'] || 'round';
  return `stroke="${esc(o.stroke)}" stroke-width="${round(o.strokeWidth)}" stroke-linecap="${esc(cap)}" stroke-linejoin="${esc(join)}"`;
}

// Extra drawing settings kept from imported art, like fill-opacity or dashes.
function lookAttrs(o) {
  return Object.entries(o.look || {})
    .filter(([k]) => k !== 'stroke-linecap' && k !== 'stroke-linejoin')
    .map(([k, v]) => ` ${esc(k)}="${esc(v)}"`).join('');
}

function gradientPoints(g) {
  const a = rad(g.angle), c = Math.cos(a) / 2, s = Math.sin(a) / 2;
  return [round(0.5 - c, 4), round(0.5 - s, 4), round(0.5 + c, 4), round(0.5 + s, 4)];
}

// Imported gradients keep all their stops and their exact place on the art.
function rawGradientMarkup(r, id) {
  const tag = r.type === 'radial' ? 'radialGradient' : 'linearGradient';
  const coords = Object.entries(r.coords).map(([k, v]) => `${esc(k)}="${round(v, 5)}"`).join(' ');
  const stops = r.stops.map(([offset, color, opacity]) => `<stop offset="${round(offset, 4)}" stop-color="${esc(color)}" stop-opacity="${round(opacity, 3)}"/>`).join('');
  return `<${tag} id="${id}" gradientUnits="userSpaceOnUse" spreadMethod="${esc(r.spread)}" gradientTransform="matrix(${r.matrix.map((v) => round(v, 6)).join(' ')})" ${coords}>${stops}</${tag}>`;
}

function gradientMarkup(g, id, animate = () => '') {
  if (g.raw) return rawGradientMarkup(g.raw, id);
  const [x1, y1, x2, y2] = gradientPoints(g);
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`
    + ['x1', 'y1', 'x2', 'y2'].map((attr, i) => animate(attr, (h) => gradientPoints(h)[i])).join('')
    + `<stop offset="0" stop-color="${esc(g.from)}">${animate('stop-color', (h) => h.from)}</stop>`
    + `<stop offset="1" stop-color="${esc(g.to)}">${animate('stop-color', (h) => h.to)}</stop></linearGradient>`;
}

const fillOf = (o, gradientId) => (o.gradient ? `url(#${gradientId})` : esc(o.fill));

// Fonts stored in the file, because a saved or exported SVG cannot reach the
// app's own font files.
const embeddedFonts = new Map();
export const embedFont = (family, base64) => embeddedFonts.set(family, base64);

function fontStyle(doc) {
  const used = new Set(doc.layers.flatMap((l) => l.objects).filter((o) => o.type === 'text').map((o) => o.fontFamily));
  const faces = [...embeddedFonts].filter(([family]) => used.has(family))
    .map(([family, base64]) => `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${base64}) format("woff2")}`);
  return faces.length ? `<style>${faces.join('')}</style>` : '';
}

const SHADOW_X = 0.045, SHADOW_Y = 0.06;

// A texture is the same outline drawn again on top, filled with the pattern.
// Outline-only shapes get it on their outline instead.
function texturePaint(o, textureId) {
  if (o.fill !== 'none') return `fill="url(#${textureId})" stroke="none"`;
  return `fill="none" ${strokeAttrs({ ...o, stroke: `url(#${textureId})` })}`;
}

function body(o, inner = '', gradientId = '', textureId = '', textureInner = '') {
  const textured = textureId && o.texture;
  if (o.type === 'path') {
    const d = pathD(o.subpaths);
    return `<path d="${d}" fill="${fillOf(o, gradientId)}" fill-rule="${o.fillRule}" ${strokeAttrs(o)}${lookAttrs(o)}>${inner}</path>`
      + (textured ? `<path d="${d}" fill-rule="${o.fillRule}" ${texturePaint(o, textureId)}>${textureInner}</path>` : '');
  }
  if (o.type === 'text') {
    const lines = o.text.split('\n');
    const height = o.fontSize * 1.2;
    const top = (-(lines.length - 1) * height) / 2;
    const spans = lines.map((line, i) => `<tspan x="0" y="${round(top + i * height)}">${esc(line) || ' '}</tspan>`).join('');
    const style = `font-family="${esc(o.fontFamily)}" font-size="${round(o.fontSize)}" font-weight="${o.bold ? 700 : 400}" font-style="${o.italic ? 'italic' : 'normal'}"`;
    const text = `${style} text-anchor="middle" dominant-baseline="central" xml:space="preserve"`;
    const shadow = o.shadow ? `<text ${text} fill="#000000" fill-opacity="0.24" transform="translate(${round(o.fontSize * SHADOW_X)} ${round(o.fontSize * SHADOW_Y)})">${spans}</text>` : '';
    return `${shadow}<text ${text} fill="${fillOf(o, gradientId)}" ${strokeAttrs(o)}>${inner}${spans}</text>`
      + (textured ? `<text ${text} ${texturePaint(o, textureId)}>${spans}</text>` : '');
  }
  return `<image href="${esc(o.href)}" x="${round(-o.w / 2)}" y="${round(-o.h / 2)}" width="${round(o.w)}" height="${round(o.h)}" preserveAspectRatio="none"/>`;
}

function eraseMask(o, id) {
  const lines = o.erase.map((e) => `<path d="${pathD([e.path])}" fill="none" stroke="#000" stroke-width="${round(e.width)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const half = MASK_SIZE / 2;
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}"><rect x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}" fill="#fff"/>${lines}</mask>`;
}

// Imported pieces can stay cut to the shape they were clipped by in the file.
function clipsOf(o, id) {
  const list = o.clips || [];
  return {
    defs: list.map((paths, i) => `<clipPath id="${id}-c${i}">${paths.map((c) => `<path d="${pathD(c.subpaths)}" clip-rule="${esc(c.rule)}"/>`).join('')}</clipPath>`).join(''),
    open: list.map((_, i) => `<g clip-path="url(#${id}-c${i})">`).join(''),
    close: '</g>'.repeat(list.length),
  };
}

export const newUnderbelly = () => ({ size: 1, strength: 0.28, color: '#000000' });

// How deep the band is at size 100%, as a share of the thing's height.
const BELLY_DEPTH = 0.14;

// How tall a thing is in its own units.
function localHeight(o) {
  if (o.type === 'path') return pathBounds(o.subpaths).height + (o.stroke && o.stroke !== 'none' ? o.strokeWidth : 0);
  if (o.type === 'image') return o.h;
  return o.text.split('\n').length * o.fontSize * 1.2;
}

// The underbelly: a see-through band along the bottom of anything (shapes,
// pictures, text), made from its own outline. The outline moved up is cut out of
// the outline, so the band follows the bottom edge and curves up wherever the
// edge does. The cut-out edge is sharpened so straight sides leave no faint line.
function underbellyFilter(o, id) {
  if (!o.underbelly) return '';
  const u = { ...newUnderbelly(), ...o.underbelly };
  const depth = localHeight(o) * BELLY_DEPTH * u.size * Math.sign(o.scaleY || 1);
  if (!depth || !(u.strength > 0)) return '';
  const half = MASK_SIZE / 2;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}" color-interpolation-filters="sRGB">`
    + `<feOffset in="SourceAlpha" dx="0" dy="${round(-depth, 2)}" result="up"/>`
    + '<feComposite in="SourceAlpha" in2="up" operator="out"/>'
    + '<feComponentTransfer result="band"><feFuncA type="linear" slope="2" intercept="-0.5"/></feComponentTransfer>'
    + `<feFlood flood-color="${esc(u.color)}" flood-opacity="${round(u.strength, 3)}"/>`
    + '<feComposite in2="band" operator="in" result="belly"/>'
    + '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="belly"/></feMerge></filter>';
}

// Blur is measured on the canvas, so it sits outside the piece's own scale.
// values: an animated blur, one stdDeviation per frame.
function blurred(markup, id, amount, values = '') {
  if (!(amount > 0) && !values) return markup;
  const half = MASK_SIZE / 2;
  return `<g filter="url(#${id})"><filter id="${id}" filterUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}"><feGaussianBlur stdDeviation="${round(amount || 0, 2)}">${values}</feGaussianBlur></filter>${markup}</g>`;
}

function objectMarkup(raw, frame, opt) {
  const o = sample(raw, frame);
  const maskId = `${opt.prefix || 'erase'}-${raw.id}`;
  const masked = raw.erase?.length > 0;
  const tag = opt.editor ? ` data-id="${raw.id}"` : '';
  const gradientId = `${maskId}-paint`;
  const textureId = `${maskId}-tex`;
  const clip = clipsOf(raw, maskId);
  const texture = o.texture && o.type !== 'image' ? patternMarkup(o.texture, textureId, o, frame, opt) : '';
  const belly = underbellyFilter(o, `${maskId}-belly`);
  const defs = (masked ? eraseMask(raw, maskId) : '') + (o.gradient ? gradientMarkup(o.gradient, gradientId) : '') + texture + clip.defs + belly;
  return blurred(`<g${tag} transform="${transformOf(o)}" opacity="${round(o.opacity, 3)}">${defs}<g class="b"${masked ? ` mask="url(#${maskId})"` : ''}${belly ? ` filter="url(#${maskId}-belly)"` : ''}>${clip.open}${body(o, '', gradientId, texture && textureId)}${clip.close}</g></g>`, `${maskId}-blur`, o.blur);
}

// One object in an animated export, sampled once per frame.
function animatedObject(raw, doc, opt) {
  const count = doc.frames;
  const dur = `${round(count / doc.fps, 3)}s`;
  const samples = Array.from({ length: count }, (_, f) => sample(raw, f));
  samples.push(samples[count - 1]);

  const animate = (attr, fn) => {
    const values = samples.map(fn);
    if (new Set(values).size < 2) return '';
    return `<animate attributeName="${attr}" values="${values.join(';')}" dur="${dur}" repeatCount="indefinite"/>`;
  };
  const motion = (type, fn) => `<animateTransform attributeName="transform" type="${type}" additive="sum" values="${samples.map(fn).join(';')}" dur="${dur}" repeatCount="indefinite"/>`;

  const shape = raw.type === 'path' ? animate('d', (s) => pathD(s.subpaths, { uniform: true })) : '';
  const inner = animate('fill', (s) => s.fill) + animate('stroke', (s) => s.stroke)
    + animate('stroke-width', (s) => round(s.strokeWidth)) + shape;

  const first = samples[0];
  const maskId = `${opt.prefix || 'erase'}-${raw.id}`;
  const masked = raw.erase?.length > 0;
  const gradientId = `${maskId}-paint`;
  const painted = samples.find((s) => s.gradient)?.gradient;
  const gradientTag = (attr, fn) => animate(attr, (s) => fn(s.gradient || painted));
  const clip = clipsOf(raw, maskId);
  const textureId = `${maskId}-tex`;
  const texture = raw.texture && raw.type !== 'image' ? patternMarkup(raw.texture, textureId, first, 0, opt) : '';
  const belly = underbellyFilter(first, `${maskId}-belly`);
  const blurs = animate('stdDeviation', (s) => round(s.blur || 0, 2));
  return blurred(`<g opacity="${round(first.opacity, 3)}">`
    + motion('translate', (s) => `${round(s.x)} ${round(s.y)}`)
    + motion('rotate', (s) => round(s.rotation))
    + motion('scale', (s) => `${round(s.scaleX, 4)} ${round(s.scaleY, 4)}`)
    + animate('opacity', (s) => round(s.opacity, 3))
    + (masked ? eraseMask(raw, maskId) : '')
    + (painted ? gradientMarkup(painted, gradientId, gradientTag) : '') + texture + clip.defs + belly
    + `<g${masked ? ` mask="url(#${maskId})"` : ''}${belly ? ` filter="url(#${maskId}-belly)"` : ''}>${clip.open}${body({ ...first, gradient: painted }, raw.type === 'image' ? '' : inner, gradientId, texture && textureId, shape)}${clip.close}</g></g>`, `${maskId}-blur`, first.blur, blurs);
}

/* ---------- Shadows ---------- */

// Shadows are flat and see-through, like Blooket's art, rather than soft and fading.
export const newDropShadow = () => ({ strength: 0.3, distance: 10, soft: 0, angle: 90 });
export const newAutoShadow = () => ({ on: true, strength: 0.25, size: 10 });

// Roughly where a piece sits on the canvas, to find the ones it overlaps.
function worldBounds(raw, frame) {
  const o = sample(raw, frame);
  let b;
  if (o.type === 'path') {
    const p = pathBounds(o.subpaths), w = o.stroke && o.stroke !== 'none' ? o.strokeWidth / 2 : 0;
    b = { x: p.x - w, y: p.y - w, width: p.width + w * 2, height: p.height + w * 2 };
  } else if (o.type === 'image') {
    b = { x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h };
  } else {
    const lines = o.text.split('\n');
    const width = Math.max(...lines.map((l) => l.length)) * o.fontSize * 0.7, height = lines.length * o.fontSize * 1.2;
    b = { x: -width / 2, y: -height / 2, width, height };
  }
  const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => localToWorld(o, x, y));
  const grow = (o.blur || 0) * 2;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs) - grow, y0: Math.min(...ys) - grow, x1: Math.max(...xs) + grow, y1: Math.max(...ys) + grow };
}

const touching = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Big enough for any canvas, measured on the canvas itself.
const region = () => `filterUnits="userSpaceOnUse" x="${-MASK_SIZE / 2}" y="${-MASK_SIZE / 2}" width="${MASK_SIZE}" height="${MASK_SIZE}"`;

// A see-through black copy of whatever the filter is on, moved by dx, dy.
// Solid unless soft is above 0.
const shadeFilter = (id, strength, soft, dx, dy) => `<filter id="${id}" ${region()}>`
  + (soft > 0 ? `<feGaussianBlur in="SourceAlpha" stdDeviation="${round(soft, 2)}"/><feOffset dx="${round(dx, 2)}" dy="${round(dy, 2)}"/>`
    : `<feOffset in="SourceAlpha" dx="${round(dx, 2)}" dy="${round(dy, 2)}"/>`)
  + `<feComponentTransfer><feFuncA type="linear" slope="${round(strength, 3)}"/></feComponentTransfer></filter>`;

// The pieces a drop shadow is made of: a Blook's pieces share one shadow, so
// they don't darken each other. Keyed by the first piece, where it is drawn.
function shadowTeams(list) {
  const teams = new Map(), byGroup = new Map();
  list.forEach((o, i) => {
    if (!o.dropShadow) return;
    const team = o.group && byGroup.get(o.group);
    if (team) { team.push(o); return; }
    const fresh = [o];
    teams.set(i, fresh);
    if (o.group) byGroup.set(o.group, fresh);
  });
  return teams;
}

// Shadows are copies (<use>) of the art itself, so they follow it in animations.
// Auto shadow: each piece casts a flat see-through shadow, only onto the pieces under it.
// Because the piece is drawn over its own shadow, just a solid band shows below its edge.
function withShadows(list, frame, opt, layer, draw) {
  const prefix = `${opt.prefix || 'erase'}-${layer.id}`;
  const ref = (o) => `${prefix}-o-${o.id}`;
  const uses = (items) => items.map((o) => `<use href="#${ref(o)}"/>`).join('');
  const used = new Set();
  const auto = opt.doc?.autoShadow;
  const autoOn = auto?.on && auto.strength > 0 && auto.size > 0;
  const moves = (o) => opt.animate && o.keys?.length;
  const boxes = autoOn ? list.map((o) => worldBounds(o, frame)) : [];
  const teams = shadowTeams(list);
  let defs = autoOn ? `<filter id="${prefix}-solid" ${region()}><feFlood flood-color="#fff"/><feComposite in2="SourceAlpha" operator="in"/></filter>`
    + shadeFilter(`${prefix}-shade`, auto.strength, 0, 0, auto.size) : '';
  const parts = list.map((o, i) => {
    let before = '';
    const team = teams.get(i);
    if (team) {
      const s = { ...newDropShadow(), ...o.dropShadow }, a = rad(s.angle);
      defs += shadeFilter(`${prefix}-ds-${o.id}`, s.strength, s.soft, Math.cos(a) * s.distance, Math.sin(a) * s.distance);
      team.forEach((t) => used.add(t.id));
      before += `<g pointer-events="none" filter="url(#${prefix}-ds-${o.id})">${uses(team)}</g>`;
    }
    const under = autoOn ? list.slice(0, i).filter((b, j) => moves(o) || moves(b) || touching(boxes[i], boxes[j])) : [];
    if (under.length) {
      [o, ...under].forEach((t) => used.add(t.id));
      defs += `<mask id="${prefix}-as-${o.id}" maskUnits="userSpaceOnUse" x="${-MASK_SIZE / 2}" y="${-MASK_SIZE / 2}" width="${MASK_SIZE}" height="${MASK_SIZE}"><g filter="url(#${prefix}-solid)">${uses(under)}</g></mask>`;
      before += `<g pointer-events="none" mask="url(#${prefix}-as-${o.id})"><use href="#${ref(o)}" filter="url(#${prefix}-shade)"/></g>`;
    }
    return { o, before, markup: draw(o) };
  });
  return (defs ? `<defs>${defs}</defs>` : '')
    + parts.map(({ o, before, markup }) => before + (used.has(o.id) ? `<g id="${ref(o)}">${markup}</g>` : markup)).join('');
}

export function layerMarkup(layer, frame, opt = {}) {
  const list = opt.doc ? objectsOn(opt.doc, layer, frame) : layer.objects;
  const draw = (o) => (opt.animate && o.keys?.length ? animatedObject(o, opt.doc, opt) : objectMarkup(o, frame, opt));
  const objects = withShadows(list, frame, opt, layer, draw);
  const attrs = opt.editor ? ` data-layer="${layer.id}"` : ` id="${esc(layer.name.replace(/[^\w-]+/g, '-'))}"`;
  return `<g${attrs} opacity="${round(layer.opacity, 3)}">${objects}</g>`;
}

// A looping flipbook: each page shows for its turn, then hides again.
function pagesMarkup(doc, opt) {
  const count = doc.pages.length;
  const dur = `${round(count / doc.fps, 3)}s`;
  const time = (i) => round(i / count, 5);
  return doc.pages.map((_, i) => {
    const art = doc.layers.filter((l) => l.visible).map((l) => layerMarkup(l, i, { ...opt, doc, animate: false, prefix: `page${i}` })).join('');
    if (count < 2) return art;
    const last = i === count - 1;
    const steps = i === 0 ? ['inline', 'none'] : ['none', 'inline', ...(last ? [] : ['none'])];
    const times = i === 0 ? [0, time(1)] : [0, time(i), ...(last ? [] : [time(i + 1)])];
    return `<g display="${i ? 'none' : 'inline'}"><animate attributeName="display" values="${steps.join(';')}" keyTimes="${times.join(';')}" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>${art}</g>`;
  }).join('');
}

export function layersMarkup(doc, frame, opt = {}) {
  if (opt.animate && isPages(doc)) return pagesMarkup(doc, opt);
  return doc.layers.filter((l) => l.visible).map((l) => layerMarkup(l, frame, { ...opt, doc })).join('');
}

export function backgroundMarkup(doc, prefix = 'frame', frame = 0, opt = {}) {
  const texture = doc.bgTexture ? `${patternMarkup(doc.bgTexture, `${prefix}-bgtex`, null, frame, { ...opt, doc })}<rect width="${doc.width}" height="${doc.height}" fill="url(#${prefix}-bgtex)"/>` : '';
  if (doc.bgGradient) {
    const id = `${prefix}-bg`;
    return `${gradientMarkup(doc.bgGradient, id)}<rect width="${doc.width}" height="${doc.height}" fill="url(#${id})"/>${texture}`;
  }
  if (!doc.background || doc.background === 'none') return texture;
  return `<rect width="${doc.width}" height="${doc.height}" fill="${esc(doc.background)}"/>${texture}`;
}

// Rounded canvases are cut to shape with a clip around all the art.
export function frameClip(doc, prefix = 'frame') {
  if (!doc.cornerRadius) return { defs: '', attr: '' };
  const id = `${prefix}-clip`;
  return {
    defs: `<clipPath id="${id}"><rect width="${doc.width}" height="${doc.height}" rx="${round(doc.cornerRadius)}"/></clipPath>`,
    attr: ` clip-path="url(#${id})"`,
  };
}

// animate: true writes a looping animated SVG. Otherwise a single frame.
// box: draws just the art, with no background or canvas shape, over that area.
export function exportSVG(doc, { frame = 0, animate = false, box = null, overlay = true } = {}) {
  if (box) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">${fontStyle(doc)}${layersMarkup(doc, frame)}</svg>`;
  }
  const clip = frameClip(doc);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`
    + `<title>${esc(doc.name)}</title>${fontStyle(doc)}${clip.defs}<g${clip.attr}>${backgroundMarkup(doc, 'frame', frame, { animate })}${layersMarkup(doc, frame, { animate })}${overlay ? overlayMarkup(doc) : ''}</g></svg>`;
}

export const svgDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export async function rasterize(svg, width, height) {
  const img = new Image();
  img.src = svgDataUrl(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas;
}
