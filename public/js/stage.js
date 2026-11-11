// The canvas: zoom and pan, drawing the art, and drawing handles on top of it.
import { S, posed, selected, findObj } from './state.js';
import { layersMarkup, backgroundMarkup, frameClip } from './render.js';
import { overlayMarkup } from './templates.js';
import { localToWorld, isCorner, clamp, mapSubpaths, pathBounds } from './model.js';
import { $ } from './ui.js';

let art, overlay, frameEl, workspace;

export function mountStage(root) {
  workspace = $('#wk', root);
  frameEl = $('#frame', root);
  art = $('#art', root);
  overlay = $('#overlay', root);
}

export function placeFrame() {
  const { width, height } = S.doc;
  const w = width * S.zoom, h = height * S.zoom;
  Object.assign(frameEl.style, {
    width: `${w}px`, height: `${h}px`, left: `${S.panX}px`, top: `${S.panY}px`,
    borderRadius: `${(S.doc.cornerRadius || 0) * S.zoom}px`,
  });
  art.setAttribute('width', w);
  art.setAttribute('height', h);
  overlay.setAttribute('width', w);
  overlay.setAttribute('height', h);
}

export function fitView() {
  const r = workspace.getBoundingClientRect();
  const pad = 48;
  S.zoom = clamp(Math.min((r.width - pad * 2) / S.doc.width, (r.height - pad * 2) / S.doc.height), 0.05, 4);
  S.panX = (r.width - S.doc.width * S.zoom) / 2;
  S.panY = (r.height - S.doc.height * S.zoom) / 2;
  S.fitted = true;
  placeFrame();
}

export function zoomAt(next, clientX, clientY) {
  const r = workspace.getBoundingClientRect();
  const cx = clientX === undefined ? r.width / 2 : clientX - r.left;
  const cy = clientY === undefined ? r.height / 2 : clientY - r.top;
  const z = clamp(next, 0.05, 16);
  S.panX = cx - ((cx - S.panX) * z) / S.zoom;
  S.panY = cy - ((cy - S.panY) * z) / S.zoom;
  S.zoom = z;
  S.fitted = false;
  placeFrame();
}

export function toDoc(e) {
  const r = art.getBoundingClientRect();
  return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
}

export function drawStage() {
  const d = S.doc;
  art.setAttribute('viewBox', `0 0 ${d.width} ${d.height}`);
  const ghost = S.onion && d.animated && S.frame > 0
    ? `<g opacity="0.3" pointer-events="none">${layersMarkup(d, S.frame - 1, { prefix: 'onion' })}</g>`
    : '';
  const clip = frameClip(d, 'stage');
  art.innerHTML = `${clip.defs}<g${clip.attr}>${backgroundMarkup(d, 'stage', S.frame)}${ghost}${layersMarkup(d, S.frame, { editor: true, prefix: 'stage' })}${overlayMarkup(d)}</g><g id="live" pointer-events="none"></g>`;
}

export const liveLayer = () => $('#live', art);
export const objectEl = (id) => art.querySelector(`[data-id="${id}"]`);

export function localBox(id) {
  const el = objectEl(id)?.querySelector('.b');
  return el ? el.getBBox() : null;
}

// Selection box in document units.
// A shape's box, from its own points placed on the canvas. The browser's box for
// a turned shape is the box around its unturned box, which is too big once it leans.
function shapeBox(raw) {
  const o = posed(raw);
  if (o.type !== 'path' || !o.subpaths?.length) return null;
  const b = pathBounds(mapSubpaths(o.subpaths, (x, y) => localToWorld(o, x, y)));
  const line = o.stroke && o.stroke !== 'none' ? (o.strokeWidth / 2) * Math.max(Math.abs(o.scaleX), Math.abs(o.scaleY)) : 0;
  return { x0: b.x - line, y0: b.y - line, x1: b.x + b.width + line, y1: b.y + b.height + line };
}

export function worldBox(ids) {
  const r = art.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const obj = findObj(id);
    const own = obj && shapeBox(obj);
    if (own) {
      x0 = Math.min(x0, own.x0); y0 = Math.min(y0, own.y0); x1 = Math.max(x1, own.x1); y1 = Math.max(y1, own.y1);
      continue;
    }
    const b = objectEl(id)?.querySelector('.b')?.getBoundingClientRect();
    if (!b) continue;
    const z = S.zoom;
    x0 = Math.min(x0, (b.left - r.left) / z); y0 = Math.min(y0, (b.top - r.top) / z);
    x1 = Math.max(x1, (b.right - r.left) / z); y1 = Math.max(y1, (b.bottom - r.top) / z);
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// Corner points of the selection, in document units, with the box's rotation.
export function selectionFrame() {
  const items = selected().filter((o) => objectEl(o.id));
  if (!items.length) return null;
  if (items.length === 1) {
    const o = posed(items[0]);
    const b = localBox(o.id);
    const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]];
    return { single: true, obj: o, box: b, pts: corners.map(([x, y]) => localToWorld(o, x, y)) };
  }
  const b = worldBox(items.map((o) => o.id));
  const pts = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }];
  return { single: false, box: b, pts };
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const HANDLES = [
  ['nw', 0, null], ['ne', 1, null], ['se', 2, null], ['sw', 3, null],
  ['n', 0, 1], ['e', 1, 2], ['s', 2, 3], ['w', 3, 0],
];

// The line being drawn, plus a ring on any point it would connect to.
function lineOverlay() {
  const z = S.zoom;
  const { line, lineSnap } = S;
  let out = '';
  if (line) {
    const pts = line.pts.map((p) => `${p.x * z},${p.y * z}`).join(' ');
    const last = line.pts[line.pts.length - 1];
    const to = lineSnap || line.hover;
    if (to) out += `<line class="line-next" x1="${last.x * z}" y1="${last.y * z}" x2="${to.x * z}" y2="${to.y * z}"/>`;
    out += `<polyline class="line-draft" points="${pts}"/>`;
    out += line.pts.map((p, i) => `<circle class="line-dot ${i ? '' : 'first'}" cx="${p.x * z}" cy="${p.y * z}" r="${i ? 4 : 6}"/>`).join('');
  }
  if (lineSnap) out += `<circle class="line-snap" cx="${lineSnap.x * z}" cy="${lineSnap.y * z}" r="11"/>`;
  return out;
}

function selectionOverlay() {
  const f = selectionFrame();
  if (!f) return '';
  const z = S.zoom;
  const pts = f.pts.map((p) => ({ x: p.x * z, y: p.y * z }));
  const outline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  let out = `<polygon class="sel-box" points="${outline}" data-h="move"/>`;
  if (S.tool !== 'select') return `<polygon class="sel-line" points="${outline}"/>`;
  const top = mid(pts[0], pts[1]), bottom = mid(pts[2], pts[3]);
  const len = Math.hypot(top.x - bottom.x, top.y - bottom.y) || 1;
  const rot = { x: top.x + ((top.x - bottom.x) / len) * 30, y: top.y + ((top.y - bottom.y) / len) * 30 };
  out += `<line class="sel-stem" x1="${top.x}" y1="${top.y}" x2="${rot.x}" y2="${rot.y}"/>`;
  out += `<circle class="handle rot" cx="${rot.x}" cy="${rot.y}" r="8" data-h="rot"/>`;
  for (const [name, a, b] of HANDLES) {
    const p = b === null ? pts[a] : mid(pts[a], pts[b]);
    out += `<rect class="handle h-${name}" x="${p.x - 6}" y="${p.y - 6}" width="12" height="12" rx="3" data-h="${name}"/>`;
  }
  return out;
}

const MAX_MIDPOINTS = 160;

function verticesOverlay() {
  const [item] = selected();
  if (!item || item.type !== 'path' || !objectEl(item.id)) return '';
  const o = posed(item);
  const z = S.zoom;
  const px = (x, y) => { const p = localToWorld(o, x, y); return { x: p.x * z, y: p.y * z }; };
  const total = o.subpaths.reduce((n, sp) => n + sp.nodes.length, 0);
  let mids = '', handles = '', nodes = '';
  o.subpaths.forEach((sp, s) => {
    const N = sp.nodes.length;
    sp.nodes.forEach((n, i) => {
      const key = `${s}:${i}`;
      const p = px(n.x, n.y);
      const on = S.nodeSel.has(key);
      if (on) {
        for (const [side, hx, hy] of [['in', n.ix, n.iy], ['out', n.ox, n.oy]]) {
          if (!hx && !hy) continue;
          const q = px(n.x + hx, n.y + hy);
          handles += `<line class="v-stem" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/>`
            + `<circle class="v-handle" cx="${q.x}" cy="${q.y}" r="6" data-hd="${key}:${side}"/>`;
        }
      }
      nodes += `<rect class="vertex ${on ? 'on' : ''} ${n.ix || n.ox ? 'curve' : ''}" x="${p.x - 7}" y="${p.y - 7}" width="14" height="14" rx="${n.ix || n.ox ? 7 : 3}" data-n="${key}"/>`;
      if (total <= MAX_MIDPOINTS && (i < N - 1 || sp.closed)) {
        const m = sp.nodes[(i + 1) % N];
        const t = px(
          (n.x + m.x) / 2 + (3 * ((n.ox || 0) + (m.ix || 0))) / 8,
          (n.y + m.y) / 2 + (3 * ((n.oy || 0) + (m.iy || 0))) / 8,
        );
        mids += `<circle class="v-mid" cx="${t.x}" cy="${t.y}" r="5" data-mid="${key}"/>`;
      }
    });
  });
  const spot = S.vertexSpot ? `<circle class="v-add" cx="${S.vertexSpot.x * z}" cy="${S.vertexSpot.y * z}" r="7"/>` : '';
  return mids + handles + nodes + spot;
}

export function drawOverlay() {
  if (S.tool === 'line') overlay.innerHTML = lineOverlay();
  else overlay.innerHTML = S.tool === 'vertices' ? verticesOverlay() : selectionOverlay();
}

export const hasCorners = (o) => o.type === 'path' && o.subpaths.some((sp) => sp.nodes.some((_, i) => isCorner(sp, i)));

