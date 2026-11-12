// Built-in shapes, the uploaded catalog, and turning SVG files into editable shapes.
import { parseD, pathD, fitSubpaths, mapSubpaths, pathBounds, round } from './model.js';

function polygonD(sides, startDeg = -90) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = ((startDeg + (i * 360) / sides) * Math.PI) / 180;
    pts.push(`${round(50 * Math.cos(a))} ${round(50 * Math.sin(a))}`);
  }
  return `M${pts.join('L')}Z`;
}

function starD(points, inner) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = ((-90 + (i * 180) / points) * Math.PI) / 180;
    const r = i % 2 ? 50 * inner : 50;
    pts.push(`${round(r * Math.cos(a))} ${round(r * Math.sin(a))}`);
  }
  return `M${pts.join('L')}Z`;
}

const CIRCLE = 'M50 0A50 50 0 1 1 -50 0A50 50 0 1 1 50 0Z';

const roundedAll = (d, r) => parseD(d).map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => ({ ...n, r })) }));

const BASIC_DEFS = [
  ['square', 'Square', 'M-50 -50H50V50H-50Z'],
  ['rounded', 'Rounded', null, () => roundedAll('M-50 -50H50V50H-50Z', 18)],
  ['circle', 'Circle', CIRCLE],
  ['triangle', 'Triangle', 'M0 -50L50 50H-50Z'],
  ['right-triangle', 'Corner', 'M-50 -50L50 50H-50Z'],
  ['diamond', 'Diamond', 'M0 -50L50 0L0 50L-50 0Z'],
  ['pentagon', 'Pentagon', polygonD(5)],
  ['hexagon', 'Hexagon', polygonD(6)],
  ['octagon', 'Octagon', polygonD(8, -67.5)],
  ['star', 'Star', starD(5, 0.45)],
  ['burst', 'Burst', starD(12, 0.7)],
  ['heart', 'Heart', 'M0 -22C12 -50 50 -48 50 -14C50 14 16 32 0 48C-16 32 -50 14 -50 -14C-50 -48 -12 -50 0 -22Z'],
  ['arrow', 'Arrow', 'M-50 -18H5V-45L50 0L5 45V18H-50Z'],
  ['plus', 'Plus', 'M-16 -50H16V-16H50V16H16V50H-16V16H-50V-16H-16Z'],
  ['bubble', 'Speech', 'M-50 -40H50V25H-5L-30 50V25H-50Z'],
  ['moon', 'Moon', 'M15 -50A50 50 0 1 0 15 50A38 50 0 1 1 15 -50Z'],
  ['ring', 'Ring', `${CIRCLE}M28 0A28 28 0 1 1 -28 0A28 28 0 1 1 28 0Z`, null, 'evenodd'],
  ['line', 'Line', 'M-50 0L50 0', null, 'nonzero', true],
];

export const BASIC_SHAPES = BASIC_DEFS.map(([id, name, d, make, fillRule = 'nonzero', lineOnly = false]) => ({
  id, name, category: 'Basic', fillRule, lineOnly,
  subpaths: fitSubpaths(make ? make() : parseD(d), 100, 100),
}));

function flowerD(petals) {
  const point = (i) => {
    const a = ((-90 + (i * 360) / petals) * Math.PI) / 180;
    return `${round(30 * Math.cos(a))} ${round(30 * Math.sin(a))}`;
  };
  let d = `M${point(0)}`;
  for (let i = 1; i <= petals; i++) d += `A19 19 0 1 1 ${point(i)}`;
  return `${d}Z`;
}

const MORE_DEFS = [
  ['cloud', 'Cloud', 'M-30 30A22 22 0 0 1 -32 -14A26 26 0 0 1 16 -24A20 20 0 0 1 34 30Z'],
  ['bolt', 'Lightning', 'M10 -50L-30 8H-4L-14 50L30 -12H4Z'],
  ['crown', 'Crown', 'M-50 35V-30L-22 0L0 -40L22 0L50 -30V35Z'],
  ['gem', 'Gem', 'M-30 -40H30L50 -12L0 45L-50 -12Z'],
  ['shield', 'Shield', 'M0 -50L42 -34V4C42 28 20 42 0 50C-20 42 -42 28 -42 4V-34Z'],
  ['drop', 'Drop', 'M0 -50C14 -26 38 -8 38 16A38 34 0 0 1 -38 16C-38 -8 -14 -26 0 -50Z'],
  ['flower', 'Flower', flowerD(6)],
  ['ghost', 'Ghost', 'M-38 50V-10A38 40 0 0 1 38 -10V50L19 34L0 50L-19 34Z'],
  ['leaf', 'Leaf', 'M-42 42C-50 -20 -10 -46 45 -45C46 10 20 50 -42 42Z'],
  ['cat', 'Cat', 'M-42 -45L-14 -24H14L42 -45V10A42 38 0 0 1 -42 10Z'],
  ['tree', 'Tree', 'M0 -50L30 -14H14L40 18H8V50H-8V18H-40L-14 -14H-30Z'],
  ['mushroom', 'Mushroom', 'M-46 4A46 46 0 0 1 46 4C46 10 22 8 14 8V40A8 8 0 0 1 6 48H-6A8 8 0 0 1 -14 40V8C-22 8 -46 10 -46 4Z'],
];

export const MORE_SHAPES = MORE_DEFS.map(([id, name, d]) => ({
  id, name, category: 'More shapes', fillRule: 'nonzero', lineOnly: false,
  subpaths: fitSubpaths(parseD(d), 100, 100),
}));

export async function fetchCatalog() {
  try {
    const res = await fetch('/api/shapes');
    return (await res.json()).shapes || [];
  } catch {
    return [];
  }
}

/* ---------- Reading an uploaded SVG ---------- */

export const GEOMETRY = 'path,rect,circle,ellipse,polygon,polyline,line';
const SKIP_PARENTS = 'defs,clipPath,mask,symbol,pattern,marker';

function rectD(el) {
  const num = (k, d = 0) => parseFloat(el.getAttribute(k)) || d;
  const x = num('x'), y = num('y'), w = num('width'), h = num('height');
  let rx = num('rx', NaN), ry = num('ry', NaN);
  if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
  if (Number.isNaN(ry)) ry = rx;
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
}

function ellipseD(cx, cy, rx, ry) {
  return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`;
}

export function elementD(el) {
  const num = (k) => parseFloat(el.getAttribute(k)) || 0;
  const tag = el.localName;
  if (tag === 'path') return el.getAttribute('d') || '';
  if (tag === 'rect') return rectD(el);
  if (tag === 'circle') return ellipseD(num('cx'), num('cy'), num('r'), num('r'));
  if (tag === 'ellipse') return ellipseD(num('cx'), num('cy'), num('rx'), num('ry'));
  if (tag === 'line') return `M${num('x1')} ${num('y1')}L${num('x2')} ${num('y2')}`;
  const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
  const pairs = [];
  for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i]} ${pts[i + 1]}`);
  return `M${pairs.join('L')}${tag === 'polygon' ? 'Z' : ''}`;
}

function inheritedAttr(el, attr) {
  for (let n = el; n && n.getAttribute; n = n.parentNode) {
    if (n.getAttribute(attr)) return n.getAttribute(attr);
    const m = (n.getAttribute('style') || '').match(new RegExp(`(?:^|;)\\s*${attr}\\s*:\\s*([^;]+)`));
    if (m) return m[1].trim();
  }
  return null;
}

function transformChain(el) {
  const parts = [];
  for (let n = el; n && n.getAttribute; n = n.parentNode) {
    if (n.getAttribute('transform')) parts.unshift(n.getAttribute('transform'));
  }
  return parts.join(' ');
}

// Reads geometry out of the file as plain numbers. The file's own markup is
// never added to the page, so scripts inside an upload cannot run.
export function svgToShape(text) {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') {
    throw new Error('This file is not a valid SVG.');
  }
  const scratch = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const subpaths = [];
  let fillRule = 'nonzero', outlinesOnly = true;
  for (const el of parsed.querySelectorAll(GEOMETRY)) {
    if (el.closest(SKIP_PARENTS)) continue;
    let subs;
    try { subs = parseD(elementD(el)); } catch { continue; }
    scratch.setAttribute('transform', transformChain(el));
    const m = scratch.transform.baseVal.consolidate()?.matrix;
    if (m) subs = mapSubpaths(subs, (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
    subpaths.push(...subs);
    if (inheritedAttr(el, 'fill-rule') === 'evenodd') fillRule = 'evenodd';
    if (inheritedAttr(el, 'fill') !== 'none') outlinesOnly = false;
  }
  if (!subpaths.length) throw new Error('No shapes were found in this SVG.');
  const b = pathBounds(subpaths);
  const scale = 100 / Math.max(b.width, b.height, 1e-6);
  return {
    subpaths: fitSubpaths(subpaths, b.width * scale, b.height * scale)
      .map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map(cleanNode) })),
    fillRule,
    lineOnly: outlinesOnly,
  };
}

function cleanNode(n) {
  const out = {};
  for (const k of Object.keys(n)) out[k] = round(n[k], 3);
  return out;
}

// A small inline picture of a shape for the catalog.
export function shapeThumb(shape) {
  const d = pathD(shape.subpaths);
  const paint = shape.lineOnly ? 'fill="none" stroke="currentColor" stroke-width="6"' : 'fill="currentColor"';
  return `<svg viewBox="-56 -56 112 112" aria-hidden="true"><path d="${d}" fill-rule="${shape.fillRule}" ${paint}/></svg>`;
}
