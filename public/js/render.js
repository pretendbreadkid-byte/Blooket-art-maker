// Turns a document into SVG markup. The editor, thumbnails, the bucket tool and
// export all use this file, so what you see is what you get.
import { pathD, sample, round, rad } from './model.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MASK_SIZE = 20000;

const transformOf = (o) => `translate(${round(o.x)} ${round(o.y)}) rotate(${round(o.rotation)}) scale(${round(o.scaleX, 4)} ${round(o.scaleY, 4)})`;

function strokeAttrs(o) {
  if (!o.stroke || o.stroke === 'none' || !o.strokeWidth) return 'stroke="none"';
  return `stroke="${esc(o.stroke)}" stroke-width="${round(o.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"`;
}

function gradientPoints(g) {
  const a = rad(g.angle), c = Math.cos(a) / 2, s = Math.sin(a) / 2;
  return [round(0.5 - c, 4), round(0.5 - s, 4), round(0.5 + c, 4), round(0.5 + s, 4)];
}

function gradientMarkup(g, id, animate = () => '') {
  const [x1, y1, x2, y2] = gradientPoints(g);
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`
    + ['x1', 'y1', 'x2', 'y2'].map((attr, i) => animate(attr, (h) => gradientPoints(h)[i])).join('')
    + `<stop offset="0" stop-color="${esc(g.from)}">${animate('stop-color', (h) => h.from)}</stop>`
    + `<stop offset="1" stop-color="${esc(g.to)}">${animate('stop-color', (h) => h.to)}</stop></linearGradient>`;
}

const fillOf = (o, gradientId) => (o.gradient ? `url(#${gradientId})` : esc(o.fill));

function body(o, inner = '', gradientId = '') {
  if (o.type === 'path') {
    return `<path d="${pathD(o.subpaths)}" fill="${fillOf(o, gradientId)}" fill-rule="${o.fillRule}" ${strokeAttrs(o)}>${inner}</path>`;
  }
  if (o.type === 'text') {
    const lines = o.text.split('\n');
    const height = o.fontSize * 1.2;
    const top = (-(lines.length - 1) * height) / 2;
    const spans = lines.map((line, i) => `<tspan x="0" y="${round(top + i * height)}">${esc(line) || ' '}</tspan>`).join('');
    const style = `font-family="${esc(o.fontFamily)}" font-size="${round(o.fontSize)}" font-weight="${o.bold ? 700 : 400}" font-style="${o.italic ? 'italic' : 'normal'}"`;
    return `<text ${style} text-anchor="middle" dominant-baseline="central" xml:space="preserve" fill="${fillOf(o, gradientId)}" ${strokeAttrs(o)}>${inner}${spans}</text>`;
  }
  return `<image href="${esc(o.href)}" x="${round(-o.w / 2)}" y="${round(-o.h / 2)}" width="${round(o.w)}" height="${round(o.h)}" preserveAspectRatio="none"/>`;
}

function eraseMask(o, id) {
  const lines = o.erase.map((e) => `<path d="${pathD([e.path])}" fill="none" stroke="#000" stroke-width="${round(e.width)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const half = MASK_SIZE / 2;
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}"><rect x="${-half}" y="${-half}" width="${MASK_SIZE}" height="${MASK_SIZE}" fill="#fff"/>${lines}</mask>`;
}

function objectMarkup(raw, frame, opt) {
  const o = sample(raw, frame);
  const maskId = `${opt.prefix || 'erase'}-${raw.id}`;
  const masked = raw.erase?.length > 0;
  const tag = opt.editor ? ` data-id="${raw.id}"` : '';
  const gradientId = `${maskId}-paint`;
  const defs = (masked ? eraseMask(raw, maskId) : '') + (o.gradient ? gradientMarkup(o.gradient, gradientId) : '');
  return `<g${tag} transform="${transformOf(o)}" opacity="${round(o.opacity, 3)}">${defs}<g class="b"${masked ? ` mask="url(#${maskId})"` : ''}>${body(o, '', gradientId)}</g></g>`;
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

  const inner = animate('fill', (s) => s.fill) + animate('stroke', (s) => s.stroke)
    + animate('stroke-width', (s) => round(s.strokeWidth))
    + (raw.type === 'path' ? animate('d', (s) => pathD(s.subpaths, { uniform: true })) : '');

  const first = samples[0];
  const maskId = `${opt.prefix || 'erase'}-${raw.id}`;
  const masked = raw.erase?.length > 0;
  const gradientId = `${maskId}-paint`;
  const painted = samples.find((s) => s.gradient)?.gradient;
  const gradientTag = (attr, fn) => animate(attr, (s) => fn(s.gradient || painted));
  return `<g opacity="${round(first.opacity, 3)}">`
    + motion('translate', (s) => `${round(s.x)} ${round(s.y)}`)
    + motion('rotate', (s) => round(s.rotation))
    + motion('scale', (s) => `${round(s.scaleX, 4)} ${round(s.scaleY, 4)}`)
    + animate('opacity', (s) => round(s.opacity, 3))
    + (masked ? eraseMask(raw, maskId) : '')
    + (painted ? gradientMarkup(painted, gradientId, gradientTag) : '')
    + `<g${masked ? ` mask="url(#${maskId})"` : ''}>${body({ ...first, gradient: painted }, raw.type === 'image' ? '' : inner, gradientId)}</g></g>`;
}

export function layerMarkup(layer, frame, opt = {}) {
  const objects = layer.objects.map((o) => (opt.animate && o.keys?.length ? animatedObject(o, opt.doc, opt) : objectMarkup(o, frame, opt))).join('');
  const attrs = opt.editor ? ` data-layer="${layer.id}"` : ` id="${esc(layer.name.replace(/[^\w-]+/g, '-'))}"`;
  return `<g${attrs} opacity="${round(layer.opacity, 3)}">${objects}</g>`;
}

export function layersMarkup(doc, frame, opt = {}) {
  return doc.layers.filter((l) => l.visible).map((l) => layerMarkup(l, frame, { ...opt, doc })).join('');
}

export function backgroundMarkup(doc, prefix = 'frame') {
  if (doc.bgGradient) {
    const id = `${prefix}-bg`;
    return `${gradientMarkup(doc.bgGradient, id)}<rect width="${doc.width}" height="${doc.height}" fill="url(#${id})"/>`;
  }
  if (!doc.background || doc.background === 'none') return '';
  return `<rect width="${doc.width}" height="${doc.height}" fill="${esc(doc.background)}"/>`;
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
export function exportSVG(doc, { frame = 0, animate = false, box = null } = {}) {
  if (box) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">${layersMarkup(doc, frame)}</svg>`;
  }
  const clip = frameClip(doc);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`
    + `<title>${esc(doc.name)}</title>${clip.defs}<g${clip.attr}>${backgroundMarkup(doc)}${layersMarkup(doc, frame, { animate })}</g></svg>`;
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
