// Takes an SVG apart into separate objects that keep their real colours. Each
// piece becomes an ordinary path, so it can be moved, recoloured and warped.
// The file's markup is only read, never added to the page.
import { parseD, mapSubpaths, pathBounds, newPath, newImage, newText, uid } from './model.js';
import { elementD, GEOMETRY } from './shapes.js';
import { imageToPieces } from './trace.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const NOT_ART = 'defs,clipPath,mask,symbol,pattern,marker,filter,style,title,desc,metadata,script,linearGradient,radialGradient,animate,animateTransform,animateMotion,set'.split(',');
const SCALED_LOOKS = ['stroke-dasharray', 'stroke-dashoffset'];
const TEXT_WIDTH_GUESS = 0.55;
const MAX_TILES = 400;

const declarations = (text) => Object.fromEntries((text || '').split(';')
  .map((part) => {
    const at = part.indexOf(':');
    return at < 0 ? null : [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).replace(/!important/, '').trim()];
  })
  .filter(Boolean));

function readRules(svg) {
  const rules = [];
  for (const style of svg.querySelectorAll('style')) {
    const text = style.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      rules.push({ selector: selector.trim(), props: declarations(body) });
    }
  }
  return rules;
}

const hrefOf = (el) => el.getAttribute('href') || el.getAttributeNS(XLINK_NS, 'href') || '';

// A <use> becomes a plain copy of what it points at.
function expandUses(svg, ids) {
  for (let pass = 0; pass < 5; pass++) {
    const uses = [...svg.querySelectorAll('use')];
    if (!uses.length) return;
    for (const use of uses) {
      const target = ids.get(hrefOf(use).replace(/^#/, ''));
      const g = svg.ownerDocument.createElementNS(SVG_NS, 'g');
      for (const { name, value } of use.attributes) {
        if (!/^(x|y|width|height|href|xlink:href|id)$/.test(name)) g.setAttribute(name, value);
      }
      const x = parseFloat(use.getAttribute('x')) || 0, y = parseFloat(use.getAttribute('y')) || 0;
      g.setAttribute('transform', `${use.getAttribute('transform') || ''} translate(${x} ${y})`);
      if (target && !target.contains(use)) g.append(target.cloneNode(true));
      use.replaceWith(g);
    }
  }
}

const canvasColor = document.createElement('canvas').getContext('2d');

function cssColor(value) {
  canvasColor.fillStyle = '#000000';
  canvasColor.fillStyle = value;
  return canvasColor.fillStyle;
}

const fraction = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).trim().endsWith('%') ? parseFloat(value) / 100 : parseFloat(value);
};

const matrixList = (m) => [m.a, m.b, m.c, m.d, m.e, m.f];
const bake = (sp, m) => mapSubpaths([sp], (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }))[0];

class Reader {
  constructor(svg) {
    this.svg = svg;
    this.ids = new Map([...svg.querySelectorAll('[id]')].map((el) => [el.id, el]));
    expandUses(svg, this.ids);
    this.rules = readRules(svg);
    this.styles = new Map();
    this.scratch = document.createElementNS(SVG_NS, 'g');
    this.pieces = [];
  }

  own(el) {
    let style = this.styles.get(el);
    if (style) return style;
    style = {};
    for (const { name, value } of el.attributes) style[name] = value;
    for (const rule of this.rules) {
      try { if (el.matches(rule.selector)) Object.assign(style, rule.props); } catch { /* A selector we do not need. */ }
    }
    Object.assign(style, declarations(el.getAttribute('style')));
    this.styles.set(el, style);
    return style;
  }

  inherited(el, prop) {
    for (let n = el; n?.getAttribute; n = n.parentNode) {
      const value = this.own(n)[prop];
      if (value && value !== 'inherit') return value;
    }
    return undefined;
  }

  matrixOf(el, parent) {
    const transform = this.own(el).transform;
    if (!transform) return parent;
    this.scratch.setAttribute('transform', transform);
    const m = this.scratch.transform.baseVal.consolidate()?.matrix;
    return m ? parent.multiply(new DOMMatrix(matrixList(m))) : parent;
  }

  gradientChain(el) {
    const chain = [];
    for (let n = el; n && !chain.includes(n); n = this.ids.get(hrefOf(n).replace(/^#/, ''))) chain.push(n);
    return chain;
  }

  // Everything but the art's own position, which is added once the piece is placed.
  readGradient(el, matrix, elementBox) {
    const chain = this.gradientChain(el);
    const attr = (name) => chain.map((g) => g.getAttribute(name)).find((v) => v !== null) ?? null;
    const stopsFrom = chain.find((g) => g.querySelector('stop'));
    const stops = [...(stopsFrom?.querySelectorAll('stop') || [])].map((stop) => {
      const style = this.own(stop);
      return [fraction(style.offset, 0), cssColor(style['stop-color'] || '#000000'), fraction(style['stop-opacity'], 1)];
    });
    if (!stops.length) return null;
    const type = el.localName === 'radialGradient' ? 'radial' : 'linear';
    const coords = type === 'linear'
      ? { x1: fraction(attr('x1'), 0), y1: fraction(attr('y1'), 0), x2: fraction(attr('x2'), 1), y2: fraction(attr('y2'), 0) }
      : { cx: fraction(attr('cx'), 0.5), cy: fraction(attr('cy'), 0.5), r: fraction(attr('r'), 0.5) };
    if (type === 'radial') { coords.fx = fraction(attr('fx'), coords.cx); coords.fy = fraction(attr('fy'), coords.cy); }
    let m = matrix;
    if (attr('gradientUnits') !== 'userSpaceOnUse') {
      m = m.multiply(new DOMMatrix([elementBox.width, 0, 0, elementBox.height, elementBox.x, elementBox.y]));
    }
    const transform = attr('gradientTransform');
    if (transform) {
      this.scratch.setAttribute('transform', transform);
      const g = this.scratch.transform.baseVal.consolidate()?.matrix;
      if (g) m = m.multiply(new DOMMatrix(matrixList(g)));
    }
    return { type, coords, stops, matrix: m, spread: attr('spreadMethod') || 'pad' };
  }

  // Patterns have no match in the editor, so the tile is repeated as real
  // pieces, each cut to the shape it fills.
  addTiles(pattern, outline, box, m, opacity, clips) {
    const w = parseFloat(pattern.getAttribute('width')), h = parseFloat(pattern.getAttribute('height'));
    if (!(w > 0 && h > 0) || pattern.getAttribute('patternUnits') !== 'userSpaceOnUse') return;
    const x0 = parseFloat(pattern.getAttribute('x')) || 0, y0 = parseFloat(pattern.getAttribute('y')) || 0;
    this.own(pattern).transform = pattern.getAttribute('patternTransform') || '';
    const base = this.matrixOf(pattern, m);
    const inverse = base.inverse().multiply(m);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => inverse.transformPoint(new DOMPoint(box.x + a * box.width, box.y + b * box.height)));
    const xs = corners.map((p) => (p.x - x0) / w), ys = corners.map((p) => (p.y - y0) / h);
    const [i0, i1] = [Math.floor(Math.min(...xs)), Math.ceil(Math.max(...xs))];
    const [j0, j1] = [Math.floor(Math.min(...ys)), Math.ceil(Math.max(...ys))];
    if ((i1 - i0) * (j1 - j0) > MAX_TILES) return;
    for (let i = i0; i < i1; i++) {
      for (let j = j0; j < j1; j++) {
        const tile = base.translate(x0 + i * w, y0 + j * h);
        const cell = { rule: 'nonzero', subpaths: parseD(`M0 0H${w}V${h}H0Z`).map((sp) => bake(sp, tile)) };
        for (const child of pattern.children) this.walk(child, tile, opacity, [...clips, [outline], [cell]]);
      }
    }
  }

  paint(el, prop, matrix, box) {
    const value = (this.inherited(el, prop) ?? (prop === 'fill' ? '#000000' : 'none')).trim();
    const url = value.match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/);
    if (url) {
      const target = this.ids.get(url[1]);
      if (target?.localName === 'pattern') return { color: 'none', pattern: target };
      if (target) {
        const raw = this.readGradient(target, matrix, box);
        if (raw) return { color: raw.stops[0][1], raw };
      }
      return url[2] ? { color: url[2] === 'none' ? 'none' : cssColor(url[2]) } : { color: 'none' };
    }
    if (value === 'none' || value === 'transparent') return { color: 'none' };
    if (value === 'currentColor') return { color: cssColor(this.inherited(el, 'color') || '#000000') };
    return { color: cssColor(value) };
  }

  clipFor(el, matrix) {
    const ref = (this.own(el)['clip-path'] || '').match(/url\(\s*['"]?#([^'")\s]+)/);
    const clip = ref && this.ids.get(ref[1]);
    if (!clip) return null;
    const base = this.matrixOf(clip, matrix);
    const parts = [];
    for (const shape of clip.querySelectorAll(GEOMETRY)) {
      let subs;
      try { subs = parseD(elementD(shape)); } catch { continue; }
      const m = this.matrixOf(shape, base);
      parts.push({
        subpaths: subs.map((sp) => bake(sp, m)),
        rule: this.inherited(shape, 'clip-rule') === 'evenodd' ? 'evenodd' : 'nonzero',
      });
    }
    return parts.length ? parts : null;
  }

  walk(el, parent, opacity, clips) {
    if (NOT_ART.includes(el.localName)) return;
    const style = this.own(el);
    if (style.display === 'none') return;
    const matrix = this.matrixOf(el, parent);
    const alpha = opacity * fraction(style.opacity, 1);
    const clip = this.clipFor(el, matrix);
    const cut = clip ? [...clips, clip] : clips;
    if (el.matches(GEOMETRY)) this.addPath(el, matrix, alpha, cut);
    else if (el.localName === 'image') this.addImage(el, matrix, alpha);
    else if (el.localName === 'text') this.addText(el, matrix, alpha);
    else for (const child of el.children) this.walk(child, matrix, alpha, cut);
  }

  addPath(el, m, opacity, clips) {
    if (this.inherited(el, 'visibility') === 'hidden') return;
    let subs;
    try { subs = parseD(elementD(el)); } catch { return; }
    if (!subs.length) return;
    const elementBox = pathBounds(subs);
    const baked = subs.map((sp) => bake(sp, m));
    const rule = this.inherited(el, 'fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero';
    const fill = this.paint(el, 'fill', m, elementBox);
    if (fill.pattern) this.addTiles(fill.pattern, { rule, subpaths: baked }, elementBox, m, opacity, clips);
    const stroke = this.paint(el, 'stroke', m, elementBox);
    const width = fraction(this.inherited(el, 'stroke-width'), 1) || 0;
    const strokes = stroke.color !== 'none' && width > 0;
    if (fill.color === 'none' && !strokes) return;
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;

    const look = {};
    const fillOpacity = fraction(this.inherited(el, 'fill-opacity'), 1);
    const strokeOpacity = fraction(this.inherited(el, 'stroke-opacity'), 1);
    if (fillOpacity !== 1) look['fill-opacity'] = fillOpacity;
    if (strokes) {
      if (strokeOpacity !== 1) look['stroke-opacity'] = strokeOpacity;
      look['stroke-linecap'] = this.inherited(el, 'stroke-linecap') || 'butt';
      look['stroke-linejoin'] = this.inherited(el, 'stroke-linejoin') || 'miter';
      look['stroke-miterlimit'] = this.inherited(el, 'stroke-miterlimit') || 4;
      for (const prop of SCALED_LOOKS) {
        const value = this.inherited(el, prop);
        if (value && value !== 'none' && value !== '0') look[prop] = scaleLengths(value, scale);
      }
      const order = this.inherited(el, 'paint-order');
      if (order && order !== 'normal') look['paint-order'] = order;
    }
    this.pieces.push({
      kind: 'path',
      subpaths: baked, fill, stroke: strokes ? stroke : { color: 'none' }, strokeWidth: strokes ? width * scale : 0,
      fillRule: rule, opacity, look, clips,
    });
  }

  addImage(el, m, opacity) {
    const href = hrefOf(el);
    if (!href.startsWith('data:image/')) return;
    const x = parseFloat(el.getAttribute('x')) || 0, y = parseFloat(el.getAttribute('y')) || 0;
    const w = parseFloat(el.getAttribute('width')) || 0, h = parseFloat(el.getAttribute('height')) || 0;
    const center = m.transformPoint(new DOMPoint(x + w / 2, y + h / 2));
    this.pieces.push({
      kind: 'image', href, w, h, opacity, center,
      rotation: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      scaleX: Math.hypot(m.a, m.b), scaleY: Math.hypot(m.c, m.d) * Math.sign(m.a * m.d - m.b * m.c || 1),
    });
  }

  // Pieces of text are centred in the editor, so their middle is estimated.
  addText(el, m, opacity) {
    const text = el.textContent.trim();
    if (!text) return;
    const fontSize = parseFloat(this.inherited(el, 'font-size')) || 16;
    const x = parseFloat(el.getAttribute('x')) || 0, y = parseFloat(el.getAttribute('y')) || 0;
    this.pieces.push({
      kind: 'text', text, fontSize, opacity,
      center: m.transformPoint(new DOMPoint(x + (text.length * fontSize * TEXT_WIDTH_GUESS) / 2, y - fontSize / 3)),
      rotation: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      scale: Math.hypot(m.a, m.b),
      fill: this.paint(el, 'fill', m, { x: 0, y: 0, width: 1, height: 1 }).color,
    });
  }
}

const scaleLengths = (value, scale) => String(value).split(/[\s,]+/).filter(Boolean).map((v) => (parseFloat(v) || 0) * scale).join(' ');

export function readPieces(text) {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (parsed.querySelector('parsererror') || svg.localName !== 'svg') throw new Error('This file is not a valid SVG.');
  const reader = new Reader(svg);
  for (const child of svg.children) reader.walk(child, new DOMMatrix(), 1, []);
  if (!reader.pieces.length) throw new Error('No pieces were found in this SVG.');
  const view = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const box = view.length === 4 && view.every(Number.isFinite)
    ? { x: view[0], y: view[1], width: view[2], height: view[3] }
    : { x: 0, y: 0, width: parseFloat(svg.getAttribute('width')) || 300, height: parseFloat(svg.getAttribute('height')) || 300 };
  return { box, pieces: reader.pieces };
}

function gradientFor(paint, cx, cy) {
  if (!paint.raw) return null;
  const { raw } = paint;
  const matrix = matrixList(new DOMMatrix().translate(-cx, -cy).multiply(raw.matrix));
  const stops = raw.stops;
  return {
    from: stops[0][1], to: stops[stops.length - 1][1], angle: 90,
    raw: { type: raw.type, coords: raw.coords, stops, matrix, spread: raw.spread },
  };
}

// SVGs come apart along their real pieces. Other pictures split by colour.
export async function piecesFromPicture(href) {
  if (!href.startsWith('data:image/svg')) return imageToPieces(href);
  return readPieces(await (await fetch(href)).text());
}

export async function fetchBlooks() {
  try {
    const res = await fetch('/api/blooks');
    return (await res.json()).blooks || [];
  } catch {
    return [];
  }
}

// Places the pieces so the whole picture is `size` wide or tall, centred at (x, y).
export function piecesToObjects({ box, pieces }, name, x, y, size) {
  const k = size / Math.max(box.width, box.height);
  const midX = box.x + box.width / 2, midY = box.y + box.height / 2;
  const group = uid('t');
  const place = (px, py) => ({ x: x + (px - midX) * k, y: y + (py - midY) * k });
  return pieces.map((p, i) => {
    const base = { name: `${name} ${i + 1}`, group };
    if (p.kind === 'image') {
      return newImage({
        ...base, ...place(p.center.x, p.center.y), href: p.href, w: p.w, h: p.h,
        rotation: p.rotation, scaleX: p.scaleX * k, scaleY: p.scaleY * k, opacity: p.opacity,
      });
    }
    if (p.kind === 'text') {
      return newText({
        ...base, ...place(p.center.x, p.center.y), text: p.text, fontSize: p.fontSize, fill: p.fill,
        rotation: p.rotation, scaleX: p.scale * k, scaleY: p.scale * k, opacity: p.opacity,
      });
    }
    const b = pathBounds(p.subpaths);
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const toLocal = (subpaths) => mapSubpaths(subpaths, (px, py) => ({ x: px - cx, y: py - cy }));
    return newPath({
      ...base, ...place(cx, cy), scaleX: k, scaleY: k, opacity: p.opacity,
      subpaths: toLocal(p.subpaths), fillRule: p.fillRule,
      fill: p.fill.color, gradient: gradientFor(p.fill, cx, cy),
      stroke: p.stroke.color, strokeWidth: p.strokeWidth, look: p.look,
      clips: p.clips.map((parts) => parts.map((c) => ({ rule: c.rule, subpaths: toLocal(c.subpaths) }))),
    });
  });
}
