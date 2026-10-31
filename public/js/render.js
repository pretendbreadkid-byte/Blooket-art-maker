// Turns a document into SVG markup. The editor, thumbnails, the bucket tool and
// export all use this file, so what you see is what you get.
import { pathD, sample, round } from './model.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MASK_SIZE = 20000;

const transformOf = (o) => `translate(${round(o.x)} ${round(o.y)}) rotate(${round(o.rotation)}) scale(${round(o.scaleX, 4)} ${round(o.scaleY, 4)})`;

function strokeAttrs(o) {
  if (!o.stroke || o.stroke === 'none' || !o.strokeWidth) return 'stroke="none"';
  return `stroke="${esc(o.stroke)}" stroke-width="${round(o.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"`;
}

function body(o, inner = '') {
  if (o.type === 'path') {
    return `<path d="${pathD(o.subpaths)}" fill="${esc(o.fill)}" fill-rule="${o.fillRule}" ${strokeAttrs(o)}>${inner}</path>`;
  }
  if (o.type === 'text') {
    const lines = o.text.split('\n');
    const height = o.fontSize * 1.2;
    const top = (-(lines.length - 1) * height) / 2;
    const spans = lines.map((line, i) => `<tspan x="0" y="${round(top + i * height)}">${esc(line) || ' '}</tspan>`).join('');
    const style = `font-family="${esc(o.fontFamily)}" font-size="${round(o.fontSize)}" font-weight="${o.bold ? 700 : 400}" font-style="${o.italic ? 'italic' : 'normal'}"`;
    return `<text ${style} text-anchor="middle" dominant-baseline="central" xml:space="preserve" fill="${esc(o.fill)}" ${strokeAttrs(o)}>${inner}${spans}</text>`;
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
  return `<g${tag} transform="${transformOf(o)}" opacity="${round(o.opacity, 3)}">${masked ? eraseMask(raw, maskId) : ''}<g class="b"${masked ? ` mask="url(#${maskId})"` : ''}>${body(o)}</g></g>`;
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
    + (raw.type === 'path' ? animate('d', (s) => pathD(s.subpaths)) : '');

  const first = samples[0];
  const maskId = `${opt.prefix || 'erase'}-${raw.id}`;
  const masked = raw.erase?.length > 0;
  return `<g opacity="${round(first.opacity, 3)}">`
    + motion('translate', (s) => `${round(s.x)} ${round(s.y)}`)
    + motion('rotate', (s) => round(s.rotation))
    + motion('scale', (s) => `${round(s.scaleX, 4)} ${round(s.scaleY, 4)}`)
    + animate('opacity', (s) => round(s.opacity, 3))
    + (masked ? eraseMask(raw, maskId) : '')
    + `<g${masked ? ` mask="url(#${maskId})"` : ''}>${body(first, raw.type === 'image' ? '' : inner)}</g></g>`;
}

export function layerMarkup(layer, frame, opt = {}) {
  const objects = layer.objects.map((o) => (opt.animate && o.keys?.length ? animatedObject(o, opt.doc, opt) : objectMarkup(o, frame, opt))).join('');
  const attrs = opt.editor ? ` data-layer="${layer.id}"` : ` id="${esc(layer.name.replace(/[^\w-]+/g, '-'))}"`;
  return `<g${attrs} opacity="${round(layer.opacity, 3)}">${objects}</g>`;
}

export function layersMarkup(doc, frame, opt = {}) {
  return doc.layers.filter((l) => l.visible).map((l) => layerMarkup(l, frame, { ...opt, doc })).join('');
}

export const backgroundMarkup = (doc) => (doc.background && doc.background !== 'none'
  ? `<rect width="${doc.width}" height="${doc.height}" fill="${esc(doc.background)}"/>`
  : '');

// animate: true writes a looping animated SVG. Otherwise a single frame.
export function exportSVG(doc, { frame = 0, animate = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`
    + `<title>${esc(doc.name)}</title>${backgroundMarkup(doc)}${layersMarkup(doc, frame, { animate })}</svg>`;
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
