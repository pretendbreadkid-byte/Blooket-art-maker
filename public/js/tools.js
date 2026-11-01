// Everything that happens when you press, drag and release on the canvas.
import {
  S, hooks, refresh, liveRefresh, commit, activeLayer, layerOf, findObj, selected, select, posed, edit, fillPatch,
  addObject, visibleObjects, groupOf,
} from './state.js';
import {
  toDoc, objectEl, liveLayer, worldBox, selectionFrame, placeFrame, zoomAt, drawOverlay,
} from './stage.js';
import {
  newPath, newText, newImage, clone, pathD, fitSubpaths, strokeToSubpath, addVertex, removeVertices, smoothNode, sharpenNode,
  pointInPolygon, localToWorld, pathBounds, mapSubpaths, chainSubpaths, objectsOn, isPages, regroup, uid, nearestOnOutline, flipped,
  worldToLocal, worldVectorToLocal, rad, simplify,
} from './model.js';
import { floodRegion, dilate, traceLoops } from './bucket.js';
import { exportSVG, rasterize, esc } from './render.js';
import { loopSelection } from './timeline.js';
import { piecesFromPicture, piecesToObjects } from './pieces.js';
import { toast, menu, $ } from './ui.js';

let drag = null;
let spaceHeld = false;
let textBox = null;
let lastPress = { time: 0, x: 0, y: 0 };

const DOUBLE_PRESS_MS = 350;

export const setSpaceHeld = (v) => { spaceHeld = v; };

export const TOOLS = {
  select: { label: 'Select', key: 'V', hint: 'Click to pick something and drag to move it. Ctrl+click picks more. Right-click for more options.' },
  lasso: { label: 'Lasso', key: 'L', hint: 'Draw a loop around things to pick them. Hold Ctrl to add to what you have picked.' },
  vertices: { label: 'Vertices', key: 'A', hint: 'Click a shape, then drag its points. Click anywhere on its line to add a point there. Choose Pointed or Rounded up top.' },
  line: { label: 'Line', key: 'N', hint: 'Click to add points. Click the first point to close it, or double-click or press Enter to finish. Lines that touch connect.' },
  pencil: { label: 'Pencil', key: 'P', hint: 'Drag to draw a thin, sharp line.' },
  marker: { label: 'Marker', key: 'M', hint: 'Drag to draw a thick, see-through line.' },
  shapes: { label: 'Shapes', key: 'S', hint: 'Pick a shape, then drag on the canvas to draw it. Or just click to drop one in.' },
  bucket: { label: 'Bucket', key: 'B', hint: 'Click inside a shape or a closed drawing to fill it with colour.' },
  text: { label: 'Text', key: 'T', hint: 'Click on the canvas and start typing.' },
  eraser: { label: 'Eraser', key: 'E', hint: 'Drag over your art to rub it out.' },
  hand: { label: 'Move view', key: 'H', hint: 'Drag to move around. You can also hold Space anywhere, and scroll to zoom.' },
};

// Each group shares one button with a drop-down under it.
export const TOOL_GROUPS = [['select', 'vertices', 'hand', 'lasso'], ['line', 'pencil', 'marker', 'bucket']];

const pickable = (e) => {
  const el = e.target.closest?.('[data-id]');
  if (!el) return null;
  return findObj(el.dataset.id) || null;
};

/* ---------- Select ---------- */

function startMove(p) {
  drag = {
    type: 'move', p0: p, moved: false,
    items: selected().map((o) => { const s = posed(o); return { o, x: s.x, y: s.y }; }),
  };
}

function startTransform(handle, p, e) {
  const f = selectionFrame();
  if (!f) return;
  const items = selected().map((o) => {
    const s = posed(o);
    return { o, x: s.x, y: s.y, rotation: s.rotation, scaleX: s.scaleX, scaleY: s.scaleY };
  });
  if (handle === 'rot') {
    const center = { x: (f.pts[0].x + f.pts[2].x) / 2, y: (f.pts[0].y + f.pts[2].y) / 2 };
    drag = { type: 'rotate', center, items, a0: Math.atan2(p.y - center.y, p.x - center.x), moved: false };
    return;
  }
  const opposite = { nw: 2, ne: 3, se: 0, sw: 1, n: 3, e: 0, s: 0, w: 1 }[handle];
  const anchor = f.pts[opposite];
  const usesX = handle !== 'n' && handle !== 's';
  const usesY = handle !== 'e' && handle !== 'w';
  const grab = handle.length === 2
    ? f.pts[{ nw: 0, ne: 1, se: 2, sw: 3 }[handle]]
    : { n: f.pts[0], s: f.pts[2], e: f.pts[2], w: f.pts[0] }[handle];
  drag = {
    type: 'scale', handle, anchor, grab, items, usesX, usesY, moved: false, single: f.single,
    box: f.box, rotation: f.single ? f.obj.rotation : 0,
    aspectLocked: !f.single || (f.obj.type === 'image' && !e.shiftKey),
  };
}

function moveScale(p, e) {
  const d = drag;
  const a = rad(-d.rotation), c = Math.cos(a), s = Math.sin(a);
  const inBox = (v) => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c });
  const start = inBox({ x: d.grab.x - d.anchor.x, y: d.grab.y - d.anchor.y });
  const now = inBox({ x: p.x - d.anchor.x, y: p.y - d.anchor.y });
  const limit = (v) => (Math.abs(v) < 0.02 ? (v < 0 ? -0.02 : 0.02) : v);
  let fx = d.usesX && start.x ? limit(now.x / start.x) : 1;
  let fy = d.usesY && start.y ? limit(now.y / start.y) : 1;
  const keep = d.handle.length === 2 && (d.aspectLocked ? !e.shiftKey : e.shiftKey);
  if (keep || !d.single) {
    const f = d.usesX && d.usesY ? Math.max(Math.abs(fx), Math.abs(fy)) : (d.usesX ? Math.abs(fx) : Math.abs(fy));
    fx = Math.sign(fx || 1) * f;
    fy = Math.sign(fy || 1) * f;
  }
  const R = rad(d.rotation), rc = Math.cos(R), rs = Math.sin(R);
  for (const it of d.items) {
    const v = inBox({ x: it.x - d.anchor.x, y: it.y - d.anchor.y });
    const sx = v.x * fx, sy = v.y * fy;
    edit(it.o, {
      x: d.anchor.x + sx * rc - sy * rs,
      y: d.anchor.y + sx * rs + sy * rc,
      scaleX: it.scaleX * fx,
      scaleY: it.scaleY * fy,
    });
  }
}

function moveRotate(p, e) {
  const d = drag;
  let delta = Math.atan2(p.y - d.center.y, p.x - d.center.x) - d.a0;
  if (e.shiftKey) delta = Math.round(delta / rad(15)) * rad(15);
  const c = Math.cos(delta), s = Math.sin(delta);
  for (const it of d.items) {
    const dx = it.x - d.center.x, dy = it.y - d.center.y;
    edit(it.o, {
      x: d.center.x + dx * c - dy * s,
      y: d.center.y + dx * s + dy * c,
      rotation: it.rotation + (delta * 180) / Math.PI,
    });
  }
}

function selectDown(e, p) {
  const h = e.target.dataset?.h;
  const adding = e.shiftKey || e.ctrlKey || e.metaKey;
  if (h && h !== 'move') { startTransform(h, p, e); return; }
  if (h === 'move' && !adding) { startMove(p); return; }
  let hit = pickable(e);
  if (h === 'move') {
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.closest('[data-id]'));
    hit = under ? findObj(under.closest('[data-id]').dataset.id) : null;
  }
  if (hit) {
    const team = groupOf(hit);
    if (adding) {
      const next = new Set(S.sel);
      const remove = next.has(hit.id);
      team.forEach((id) => (remove ? next.delete(id) : next.add(id)));
      select([...next]);
    } else if (!S.sel.has(hit.id)) {
      select(team);
    }
    refresh();
    startMove(p);
    return;
  }
  if (!adding && S.sel.size) { select([]); refresh(); }
  drag = { type: 'marquee', p0: p };
}

function marquee(p) {
  const { p0 } = drag;
  const x = Math.min(p.x, p0.x), y = Math.min(p.y, p0.y), w = Math.abs(p.x - p0.x), h = Math.abs(p.y - p0.y);
  drag.rect = { x, y, w, h };
  const z = S.zoom;
  drawOverlay();
  $('#overlay').insertAdjacentHTML('beforeend', `<rect class="marquee" x="${x * z}" y="${y * z}" width="${w * z}" height="${h * z}"/>`);
}

function finishMarquee() {
  const r = drag.rect;
  if (!r) return;
  const ids = [];
  for (const o of visibleObjects()) {
    const b = worldBox([o.id]);
    if (b && b.x < r.x + r.w && b.x + b.width > r.x && b.y < r.y + r.h && b.y + b.height > r.y) ids.push(o.id);
  }
  select(ids);
  refresh();
}

/* ---------- Vertices ---------- */

const OUTLINE_REACH_PX = 9;

// The place on the picked shape's line that is under the pointer, if any.
function outlineSpot(p) {
  const [item] = selected();
  if (item?.type !== 'path' || selected().length !== 1) return null;
  const o = posed(item);
  const spot = nearestOnOutline(o.subpaths, p.x, p.y, (x, y) => localToWorld(o, x, y));
  return spot && spot.dist * S.zoom <= OUTLINE_REACH_PX ? spot : null;
}

function insertPoint(item, s, i, t, p) {
  const index = addVertex(item, s, i, t);
  lastPress = { time: 0, x: 0, y: 0 };
  S.vertexSpot = null;
  S.nodeSel = new Set([`${s}:${index}`]);
  if (S.nodeKind === 'rounded') setNodesKind('rounded');
  refresh();
  const fresh = posed(item);
  drag = { type: 'nodes', item, pose: fresh, base: clone(fresh.subpaths), p0: p, moved: true };
}

function vertexHover(e, p) {
  const onHandle = e.target.dataset?.n || e.target.dataset?.hd || e.target.dataset?.mid;
  const spot = onHandle ? null : outlineSpot(p);
  if (!spot && !S.vertexSpot) return;
  S.vertexSpot = spot;
  drawOverlay();
}

function verticesDown(e, p) {
  const t = e.target.dataset || {};
  const [item] = selected();
  if (item && (t.n || t.hd || t.mid)) {
    if (t.mid) {
      const [sp, i] = t.mid.split(':').map(Number);
      insertPoint(item, sp, i, 0.5, p);
      return;
    }
    const s = posed(item);
    const subpaths = clone(s.subpaths);
    if (t.hd) {
      const [sp, i, side] = t.hd.split(':');
      drag = { type: 'handle', item, pose: s, base: subpaths, sp: +sp, i: +i, side, p0: p };
      return;
    }
    if (e.shiftKey) {
      S.nodeSel.has(t.n) ? S.nodeSel.delete(t.n) : S.nodeSel.add(t.n);
    } else if (!S.nodeSel.has(t.n)) {
      S.nodeSel = new Set([t.n]);
    }
    refresh();
    drag = { type: 'nodes', item, pose: s, base: subpaths, p0: p, moved: false };
    return;
  }
  const spot = outlineSpot(p);
  if (spot) { insertPoint(item, spot.s, spot.i, spot.t, p); return; }
  const hit = pickable(e);
  if (!hit) { S.nodeSel.clear(); if (!S.sel.size) return; select([]); refresh(); return; }
  if (hit.type !== 'path') { toast('Only shapes and drawings have points to edit.'); return; }
  select([hit.id]);
  refresh();
}

function moveNodes(p) {
  const d = drag;
  const v = worldVectorToLocal(d.pose, p.x - d.p0.x, p.y - d.p0.y);
  const subpaths = clone(d.base);
  for (const key of S.nodeSel) {
    const [sp, i] = key.split(':').map(Number);
    subpaths[sp].nodes[i].x += v.x;
    subpaths[sp].nodes[i].y += v.y;
  }
  edit(d.item, { subpaths });
  d.moved = true;
}

function moveHandle(p, e) {
  const d = drag;
  const subpaths = clone(d.base);
  const n = subpaths[d.sp].nodes[d.i];
  const local = worldToLocal(d.pose, p.x, p.y);
  const hx = local.x - n.x, hy = local.y - n.y;
  const [own, other] = d.side === 'in' ? [['ix', 'iy'], ['ox', 'oy']] : [['ox', 'oy'], ['ix', 'iy']];
  n[own[0]] = hx; n[own[1]] = hy;
  // Keep a smooth curve smooth. Alt breaks the two handles apart.
  if (!e.altKey) { n[other[0]] = -hx; n[other[1]] = -hy; }
  edit(d.item, { subpaths });
}

export function toggleNodeCurve(key) {
  const [item] = selected();
  if (!item) return;
  const subpaths = clone(posed(item).subpaths);
  const [sp, i] = key.split(':').map(Number);
  const n = subpaths[sp].nodes[i];
  if (n.ix || n.iy || n.ox || n.oy) sharpenNode(n);
  else smoothNode(subpaths[sp], i);
  edit(item, { subpaths });
  commit();
}

export function setNodesKind(kind) {
  const [item] = selected();
  if (!item || !S.nodeSel.size) return;
  const subpaths = clone(posed(item).subpaths);
  for (const key of S.nodeSel) {
    const [sp, i] = key.split(':').map(Number);
    if (kind === 'rounded') smoothNode(subpaths[sp], i);
    else sharpenNode(subpaths[sp].nodes[i]);
  }
  edit(item, { subpaths });
}

export function deleteNodes() {
  const [item] = selected();
  if (!item || !S.nodeSel.size) return false;
  removeVertices(item, new Set(S.nodeSel));
  S.nodeSel.clear();
  if (!posed(item).subpaths.length) { deleteSelection(); return true; }
  commit();
  return true;
}

/* ---------- Line ---------- */

const SNAP_PX = 12;
const LINE_DRAG_PX = 6;

// Open lines that a new line could connect to.
const looseLines = () => objectsOn(S.doc, activeLayer(), S.frame)
  .filter((o) => o.type === 'path' && !o.erase.length && o.subpaths.some((sp) => !sp.closed));

const worldSubpaths = (raw) => {
  const o = posed(raw);
  return mapSubpaths(o.subpaths, (x, y) => localToWorld(o, x, y));
};

function looseEnds() {
  return looseLines().flatMap((o) => worldSubpaths(o).map((sp, i) => ({ sp, closed: o.subpaths[i].closed })))
    .filter((e) => !e.closed)
    .flatMap(({ sp }) => [sp.nodes[0], sp.nodes[sp.nodes.length - 1]]);
}

function snapFor(p) {
  const reach = SNAP_PX / S.zoom;
  const near = (q) => Math.hypot(q.x - p.x, q.y - p.y) <= reach;
  const pts = S.line?.pts;
  if (pts?.length > 2 && near(pts[0])) return { x: pts[0].x, y: pts[0].y, closes: true };
  const end = looseEnds().find(near);
  return end ? { x: end.x, y: end.y } : null;
}

function lineHover(p) {
  S.lineSnap = snapFor(p);
  if (S.line) S.line.hover = p;
  drawOverlay();
}

function lineDown(p) {
  const snap = snapFor(p);
  const at = snap ? { x: snap.x, y: snap.y } : p;
  if (snap?.closes) { finishLine(true); return; }
  if (S.line) S.line.pts.push(at);
  else S.line = { pts: [at], hover: null };
  drag = { type: 'line', p0: p };
  drawOverlay();
}

function lineUp(p) {
  const { pts } = S.line || {};
  if (!pts || Math.hypot(p.x - drag.p0.x, p.y - drag.p0.y) * S.zoom < LINE_DRAG_PX) return;
  const snap = snapFor(p);
  if (snap?.closes) { finishLine(true); return; }
  pts.push(snap ? { x: snap.x, y: snap.y } : p);
  drawOverlay();
}

export const lineInProgress = () => !!S.line;

export function cancelLine() {
  S.line = null;
  S.lineSnap = null;
  if (S.doc && S.tool === 'line') drawOverlay();
}

// Swaps lines for one new object in their place, using the first line's look.
function replaceWithChain(lines, subpath) {
  const [first] = lines;
  const layer = layerOf(first.id);
  const look = posed(first);
  const b = pathBounds([subpath]);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const obj = newPath({
    name: 'Line', x: cx, y: cy, fill: look.fill, gradient: look.gradient, stroke: look.stroke, opacity: look.opacity,
    strokeWidth: look.strokeWidth * ((Math.abs(look.scaleX) + Math.abs(look.scaleY)) / 2),
    subpaths: mapSubpaths([subpath], (x, y) => ({ x: x - cx, y: y - cy })),
  });
  const gone = new Set(lines.map((o) => o.id));
  for (const l of S.doc.layers) l.objects = l.objects.filter((o) => !gone.has(o.id));
  addObject(layer, obj);
  return obj;
}

function connect(lines, gap) {
  const parts = lines.flatMap((o) => worldSubpaths(o).filter((_, i) => !o.subpaths[i].closed));
  return replaceWithChain(lines, chainSubpaths(parts, gap));
}

export function finishLine(closed = false) {
  const line = S.line;
  S.line = null;
  S.lineSnap = null;
  const pts = (line?.pts || []).filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
  if (pts.length < 2) { drawOverlay(); return; }
  const b = pathBounds([{ closed: false, nodes: pts }]);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  let obj = newPath({
    name: 'Line', x: cx, y: cy, stroke: S.stroke, strokeWidth: S.sizes.line,
    subpaths: [{ closed, nodes: pts.map((p) => ({ x: p.x - cx, y: p.y - cy })) }],
  });
  addObject(activeLayer(), obj);
  if (!closed) {
    const gap = 0.5;
    const ends = [pts[0], pts[pts.length - 1]];
    const touching = looseLines().filter((o) => o !== obj && worldSubpaths(o).some((sp) => !sp.closed
      && ends.some((e) => [sp.nodes[0], sp.nodes[sp.nodes.length - 1]].some((q) => Math.hypot(q.x - e.x, q.y - e.y) <= gap))));
    if (touching.length) obj = connect([obj, ...touching], gap);
  }
  select([obj.id]);
  commit();
  if (obj.subpaths[0].closed) toast('Closed! Use the Bucket to fill it in.', 'ok');
}

const openLines = () => selected().filter((o) => o.type === 'path' && !o.erase.length && o.subpaths.some((sp) => !sp.closed));

// One line closes up. Two or more join end to end.
export function connectSelection() {
  const lines = openLines();
  if (!lines.length) { toast('Pick some open lines first.'); return; }
  if (lines.length === 1) {
    const [only] = lines;
    edit(only, { subpaths: posed(only).subpaths.map((sp) => ({ ...sp, closed: true })) });
    commit();
    return;
  }
  const obj = connect(lines, 0.5);
  select([obj.id]);
  commit();
}

/* ---------- Groups ---------- */

export const canTakeApart = () => selected().some((o) => o.group || o.type === 'image');

// Swaps a picture for its pieces, in the same place and at the same size and turn.
async function pictureToObjects(image) {
  const s = posed(image);
  const parsed = await piecesFromPicture(image.href);
  const objects = piecesToObjects(parsed, image.name, s.x, s.y, Math.max(parsed.box.width, parsed.box.height));
  const stretchX = (s.w * s.scaleX) / parsed.box.width, stretchY = (s.h * s.scaleY) / parsed.box.height;
  const a = rad(s.rotation), c = Math.cos(a), r = Math.sin(a);
  for (const o of objects) {
    const dx = (o.x - s.x) * stretchX, dy = (o.y - s.y) * stretchY;
    Object.assign(o, {
      x: s.x + dx * c - dy * r, y: s.y + dx * r + dy * c,
      rotation: o.rotation + s.rotation, scaleX: o.scaleX * stretchX, scaleY: o.scaleY * stretchY, opacity: o.opacity * s.opacity,
    });
    delete o.group;
    if (image.page) o.page = image.page;
  }
  return objects;
}

export async function takeApart() {
  const items = selected();
  const made = [];
  document.body.classList.add('busy');
  for (const o of items) {
    delete o.group;
    if (o.type !== 'image') continue;
    try {
      const pieces = await pictureToObjects(o);
      const layer = layerOf(o.id);
      layer.objects.splice(layer.objects.indexOf(o), 1, ...pieces);
      S.sel.delete(o.id);
      made.push(...pieces);
    } catch (error) {
      toast(error.message || 'That picture could not be taken apart.', 'warn');
    }
  }
  document.body.classList.remove('busy');
  commit();
  if (made.length) select(made.map((o) => o.id));
  refresh();
  toast(made.length ? `Taken apart into ${made.length} pieces!` : 'Taken apart! Click any piece to move it.', 'ok');
}

export function groupSelection() {
  const group = uid('t');
  selected().forEach((o) => { o.group = group; });
  commit();
}

/* ---------- Pencil, marker, eraser ---------- */

function strokeAttrsFor(tool) {
  if (tool === 'eraser') {
    const bg = S.doc.background === 'none' ? '#ffffff' : S.doc.background;
    return `stroke="${esc(bg)}" stroke-width="${S.sizes.eraser}" opacity="0.85"`;
  }
  const opacity = tool === 'marker' ? 0.6 : 1;
  return `stroke="${esc(S.stroke)}" stroke-width="${S.sizes[tool]}" opacity="${opacity}"`;
}

function startStroke(tool, p) {
  liveLayer().innerHTML = `<path fill="none" stroke-linecap="round" stroke-linejoin="round" ${strokeAttrsFor(tool)}/>`;
  drag = { type: 'stroke', tool, pts: [p], el: liveLayer().firstChild };
  updateStroke();
}

function updateStroke() {
  const { pts, el } = drag;
  el.setAttribute('d', `M${pts.map((q) => `${q.x} ${q.y}`).join('L')}${pts.length === 1 ? 'l.01 0' : ''}`);
}

function finishStroke() {
  const { tool, pts } = drag;
  liveLayer().innerHTML = '';
  if (tool === 'eraser') { eraseAlong(pts); return; }
  const c = pathBounds([{ closed: false, nodes: pts }]);
  const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
  const sp = strokeToSubpath(pts.map((q) => ({ x: q.x - cx, y: q.y - cy })), Math.max(0.5, 0.8 / S.zoom));
  addObject(activeLayer(), newPath({
    name: tool === 'pencil' ? 'Pencil line' : 'Marker line', x: cx, y: cy, subpaths: [sp],
    stroke: S.stroke, strokeWidth: S.sizes[tool], opacity: tool === 'marker' ? 0.6 : 1,
  }));
  commit();
}

function eraseAlong(pts) {
  const size = S.sizes.eraser;
  const b = pathBounds([{ closed: false, nodes: pts }]);
  const pad = size / 2;
  let touched = 0;
  for (const o of activeLayer().objects) {
    const box = worldBox([o.id]);
    if (!box) continue;
    const s = posed(o);
    const slack = pad + (s.strokeWidth || 0);
    if (box.x > b.x + b.width + slack || box.x + box.width < b.x - slack) continue;
    if (box.y > b.y + b.height + slack || box.y + box.height < b.y - slack) continue;
    const local = pts.map((p) => worldToLocal(s, p.x, p.y));
    o.erase.push({
      path: { closed: false, nodes: simplify(local, 0.4).map((q) => ({ x: q.x, y: q.y })) },
      width: size / ((Math.abs(s.scaleX) + Math.abs(s.scaleY)) / 2 || 1),
    });
    if (o.erase[o.erase.length - 1].path.nodes.length === 1) {
      const n = o.erase[o.erase.length - 1].path.nodes;
      n.push({ x: n[0].x + 0.01, y: n[0].y });
    }
    touched++;
  }
  if (!touched) toast('Nothing to erase here.');
  commit();
}

/* ---------- Shapes ---------- */

const DEFAULT_SHAPE_SIZE = 0.25;

function shapePaint(shape) {
  if (shape.lineOnly) return { fill: 'none', stroke: S.stroke, strokeWidth: Math.max(S.shapeOutline, 6) };
  return { ...fillPatch(), stroke: S.stroke, strokeWidth: S.shapeOutline };
}

function shapeRect(p, e) {
  const { p0 } = drag;
  let w = p.x - p0.x, h = p.y - p0.y;
  if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
  return { cx: p0.x + w / 2, cy: p0.y + h / 2, w: Math.abs(w), h: Math.abs(h) };
}

function previewShape(p, e) {
  const r = shapeRect(p, e);
  drag.rect = r;
  const paint = shapePaint(S.shape);
  const subs = fitSubpaths(S.shape.subpaths, Math.max(r.w, 1), Math.max(r.h, 1));
  liveLayer().innerHTML = `<path transform="translate(${r.cx} ${r.cy})" d="${pathD(subs)}" fill="${esc(paint.fill)}" fill-rule="${S.shape.fillRule}" stroke="${esc(paint.stroke)}" stroke-width="${paint.strokeWidth}" stroke-linejoin="round"/>`;
}

export function addShape(shape, cx, cy, w, h) {
  const subpaths = fitSubpaths(shape.subpaths, w, h);
  const obj = newPath({ name: shape.name, x: cx, y: cy, subpaths, fillRule: shape.fillRule, ...shapePaint(shape) });
  addObject(activeLayer(), obj);
  select([obj.id]);
  setTool('select');
  commit();
}

function finishShape() {
  const { rect, p0 } = drag;
  liveLayer().innerHTML = '';
  if (rect && (rect.w > 4 || rect.h > 4)) {
    addShape(S.shape, rect.cx, rect.cy, Math.max(rect.w, 1), Math.max(rect.h, 1));
    return;
  }
  const size = Math.min(S.doc.width, S.doc.height) * DEFAULT_SHAPE_SIZE;
  addShape(S.shape, p0.x, p0.y, size, size);
}

/* ---------- Bucket ---------- */

async function bucket(e, p) {
  const doc = S.doc;
  const hit = pickable(e);
  if (hit && hit.type !== 'image') {
    const el = objectEl(hit.id).querySelector('path,text');
    const hasOutline = hit.strokeWidth > 0 && hit.stroke !== 'none';
    const onFill = hit.type === 'text' || !hasOutline || (hit.fill !== 'none' && isInFill(el, e));
    edit(hit, onFill ? fillPatch() : { stroke: S.fill });
    commit();
    return;
  }
  for (const o of [...visibleObjects()].reverse()) {
    if (o.type !== 'path' || o.fill !== 'none' || !o.subpaths.every((sp) => sp.closed)) continue;
    const el = objectEl(o.id)?.querySelector('path');
    if (el && isInFill(el, e)) { edit(o, fillPatch()); commit(); return; }
  }
  if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
  if (!visibleObjects().length) { fillBackground(); return; }

  const scale = Math.min(2, 1800 / Math.max(doc.width, doc.height));
  const w = Math.round(doc.width * scale), h = Math.round(doc.height * scale);
  const canvas = await rasterize(exportSVG(doc, { frame: S.frame }), w, h);
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const { mask, area } = floodRegion(data, w, h, Math.floor(p.x * scale), Math.floor(p.y * scale));
  if (area === w * h) { fillBackground(); return; }
  const loops = traceLoops(dilate(mask, w, h), w, h);
  if (!loops.length) return;
  const subpaths = loops.map((loop) => ({ closed: true, nodes: loop.map((q) => ({ x: q.x / scale, y: q.y / scale })) }));
  const b = pathBounds(subpaths);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  subpaths.forEach((sp) => sp.nodes.forEach((n) => { n.x -= cx; n.y -= cy; }));
  addObject(activeLayer(), newPath({ name: 'Fill', x: cx, y: cy, subpaths, ...fillPatch(), fillRule: 'evenodd' }));
  commit();
}

function fillBackground() {
  S.doc.background = S.fill;
  S.doc.bgGradient = S.fillGradient;
  commit();
}

function isInFill(el, e) {
  const m = el.getScreenCTM();
  if (!m) return false;
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return el.isPointInFill ? el.isPointInFill(pt) : false;
}

/* ---------- Text ---------- */

export function openTextEditor(obj) {
  closeTextEditor();
  const s = posed(obj);
  const r = $('#art').getBoundingClientRect(), wk = $('#wk').getBoundingClientRect();
  const area = document.createElement('textarea');
  area.className = 'text-edit';
  area.value = obj.text;
  area.placeholder = 'Type here';
  const scale = S.zoom * Math.abs(s.scaleY);
  Object.assign(area.style, {
    left: `${r.left - wk.left + s.x * S.zoom}px`,
    top: `${r.top - wk.top + s.y * S.zoom}px`,
    fontFamily: obj.fontFamily,
    fontSize: `${obj.fontSize * scale}px`,
    fontWeight: obj.bold ? 700 : 400,
    fontStyle: obj.italic ? 'italic' : 'normal',
    color: obj.fill === 'none' ? '#000' : obj.fill,
  });
  const fit = () => {
    const lines = area.value.split('\n');
    area.rows = lines.length;
    area.cols = Math.max(4, ...lines.map((l) => l.length + 1));
  };
  fit();
  area.oninput = () => { obj.text = area.value; fit(); hooks.stage(); };
  area.onblur = closeTextEditor;
  area.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) area.blur();
  };
  textBox = { area, obj };
  $('#wk').append(area);
  area.focus();
  area.select();
}

export function closeTextEditor() {
  if (!textBox) return;
  const { area, obj } = textBox;
  textBox = null;
  area.onblur = null;
  area.remove();
  obj.text = area.value;
  if (!obj.text.trim()) {
    const layer = layerOf(obj.id);
    layer.objects = layer.objects.filter((o) => o !== obj);
    S.sel.delete(obj.id);
  } else {
    select([obj.id]);
  }
  commit();
}

function textDown(e, p) {
  const hit = pickable(e);
  if (hit?.type === 'text') { select([hit.id]); refresh(); openTextEditor(hit); return; }
  const obj = newText({ x: p.x, y: p.y, ...fillPatch(), ...S.font });
  addObject(activeLayer(), obj);
  select([obj.id]);
  refresh();
  // Wait for the press to finish, or the new box loses focus straight away.
  setTimeout(() => openTextEditor(obj));
}

/* ---------- Lasso ---------- */

function startLasso(p, e) {
  liveLayer().innerHTML = `<path fill="rgba(255,79,121,.12)" stroke="#ff4f79" stroke-width="${2 / S.zoom}" stroke-dasharray="${6 / S.zoom} ${4 / S.zoom}"/>`;
  drag = { type: 'lasso', pts: [p], el: liveLayer().firstChild, adding: e.shiftKey || e.ctrlKey || e.metaKey };
}

function insideLasso(raw, poly) {
  const o = posed(raw);
  if (o.type === 'path') {
    const nodes = o.subpaths.flatMap((sp) => sp.nodes);
    const inside = nodes.filter((n) => { const w = localToWorld(o, n.x, n.y); return pointInPolygon(w.x, w.y, poly); });
    return nodes.length > 0 && inside.length * 2 >= nodes.length;
  }
  const b = worldBox([raw.id]);
  return !!b && pointInPolygon(b.x + b.width / 2, b.y + b.height / 2, poly);
}

function finishLasso() {
  const { pts, adding } = drag;
  liveLayer().innerHTML = '';
  if (pts.length < 3) { if (!adding) { select([]); refresh(); } return; }
  const ids = adding ? [...S.sel] : [];
  for (const o of visibleObjects()) if (!ids.includes(o.id) && insideLasso(o, pts)) ids.push(o.id);
  select(ids);
  if (ids.length) setTool('select');
  else refresh();
}

/* ---------- Right-click menu ---------- */

function contextMenu(e) {
  e.preventDefault();
  if (S.tool === 'text') return;
  if (S.tool === 'line' && S.line) { finishLine(); return; }
  const hit = pickable(e);
  if (hit && !S.sel.has(hit.id)) { select(groupOf(hit)); refresh(); }
  const at = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX + 190, top: e.clientY, bottom: e.clientY }) };
  const paste = { label: 'Paste', icon: 'copy', onClick: pasteClipboard };
  if (!S.sel.size) {
    menu(at, [
      ...(S.clipboard?.length ? [paste] : []),
      {
        label: 'Pick everything', icon: 'select',
        onClick: () => { select(visibleObjects().map((o) => o.id)); refresh(); },
      },
    ]);
    return;
  }
  const lines = openLines().length;
  const keyed = S.doc.animated && !isPages(S.doc);
  const special = [
    ...(canTakeApart() ? [{ label: 'Take apart', icon: 'apart', onClick: takeApart }] : []),
    ...(S.sel.size > 1 && !selected().every((o) => o.group && o.group === selected()[0].group) ? [{ label: 'Group together', icon: 'link', onClick: groupSelection }] : []),
    ...(lines ? [{ label: lines > 1 ? 'Connect lines' : 'Close the line', icon: 'link', onClick: connectSelection }] : []),
    ...(keyed ? [{ label: 'Loop back to beginning', icon: 'loop', onClick: loopSelection }] : []),
  ];
  menu(at, [
    ...special,
    ...(special.length ? [null] : []),
    { label: 'Copy', icon: 'copy', onClick: copySelection },
    ...(S.clipboard?.length ? [paste] : []),
    { label: 'Duplicate', icon: 'copy', onClick: duplicateSelection },
    null,
    { label: 'Forward', icon: 'forward', onClick: () => reorderSelection('up') },
    { label: 'Backward', icon: 'backward', onClick: () => reorderSelection('down') },
    { label: 'Front', icon: 'front', onClick: () => reorderSelection('front') },
    { label: 'Back', icon: 'toback', onClick: () => reorderSelection('back') },
    { label: 'Flip sideways', icon: 'flipx', onClick: () => flipSelection('x') },
    { label: 'Flip up and down', icon: 'flipy', onClick: () => flipSelection('y') },
    null,
    { label: 'Delete', icon: 'trash', danger: true, onClick: deleteSelection },
  ]);
}

/* ---------- Actions ---------- */

export function setTool(name) {
  closeTextEditor();
  if (S.line) finishLine();
  S.lineSnap = null;
  S.vertexSpot = null;
  S.tool = name;
  S.nodeSel.clear();
  if (name === 'shapes') S.blooksOpen = false;
  $('#brush').hidden = true;
  if (name === 'vertices' && selected().length > 1) select([selected()[0].id]);
  document.body.dataset.tool = name;
  refresh();
}

export function deleteSelection() {
  if (!S.sel.size) return;
  for (const layer of S.doc.layers) layer.objects = layer.objects.filter((o) => !S.sel.has(o.id));
  S.sel.clear();
  commit();
}

export function duplicateSelection() {
  const ids = [];
  const copies = selected().map((o) => {
    const copy = { ...clone(o), id: `${o.id}c${Math.random().toString(36).slice(2, 7)}` };
    copy.x += 24; copy.y += 24;
    for (const k of copy.keys) { k.pose.x += 24; k.pose.y += 24; }
    layerOf(o.id).objects.push(copy);
    ids.push(copy.id);
    return copy;
  });
  regroup(copies);
  select(ids);
  commit();
}

export function copySelection() {
  S.clipboard = selected().map(clone);
}

export function pasteClipboard() {
  if (!S.clipboard?.length) return;
  const ids = [];
  const copies = S.clipboard.map((o) => {
    const copy = { ...clone(o), id: `${o.id}c${Math.random().toString(36).slice(2, 7)}` };
    copy.x += 24; copy.y += 24;
    for (const k of copy.keys) { k.pose.x += 24; k.pose.y += 24; }
    addObject(activeLayer(), copy);
    ids.push(copy.id);
    return copy;
  });
  regroup(copies);
  select(ids);
  commit();
}

// Whether what is picked already sits at the very top or bottom of what shows.
export function stackEnds() {
  const shown = visibleObjects();
  const count = shown.filter((o) => S.sel.has(o.id)).length;
  return {
    atFront: shown.slice(shown.length - count).every((o) => S.sel.has(o.id)),
    atBack: shown.slice(0, count).every((o) => S.sel.has(o.id)),
  };
}

// Only art that shows now counts, so a step always changes what you see.
export function reorderSelection(direction) {
  const layer = activeLayer();
  const shown = visibleObjects();
  const hidden = layer.objects.filter((o) => !shown.includes(o));
  const chosen = shown.filter((o) => S.sel.has(o.id));
  if (!chosen.length) return;
  const rest = shown.filter((o) => !S.sel.has(o.id));
  let order = shown;
  if (direction === 'front') order = [...rest, ...chosen];
  else if (direction === 'back') order = [...chosen, ...rest];
  else {
    const step = direction === 'up' ? 1 : -1;
    for (const o of direction === 'up' ? [...shown].reverse() : [...shown]) {
      if (!S.sel.has(o.id)) continue;
      const i = shown.indexOf(o), j = i + step;
      if (j >= 0 && j < shown.length && !S.sel.has(shown[j].id)) { shown[i] = shown[j]; shown[j] = o; }
    }
  }
  layer.objects = [...hidden, ...order];
  commit();
}

// Everything picked flips as one, around the middle of the whole selection.
export function flipSelection(axis) {
  const items = selected();
  const box = worldBox(items.map((o) => o.id));
  if (!box) return;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const o of items) edit(o, flipped(posed(o), axis, cx, cy));
  commit();
}

export function nudge(dx, dy) {
  for (const o of selected()) {
    const s = posed(o);
    edit(o, { x: s.x + dx, y: s.y + dy });
  }
  commit();
}

export async function addImageFromUrl(href, x, y) {
  const img = new Image();
  img.src = href;
  await img.decode();
  const w = img.naturalWidth || 300, h = img.naturalHeight || 300;
  const fit = Math.min(1, (S.doc.width * 0.8) / w, (S.doc.height * 0.8) / h);
  const obj = newImage({
    x: x ?? S.doc.width / 2, y: y ?? S.doc.height / 2, href, w: w * fit, h: h * fit,
  });
  addObject(activeLayer(), obj);
  select([obj.id]);
  setTool('select');
  commit();
}

/* ---------- Pointer wiring ---------- */

const BRUSHES = new Set(['pencil', 'marker', 'eraser']);

function moveBrushRing(e) {
  const ring = $('#brush');
  if (!ring) return;
  const wk = $('#wk').getBoundingClientRect();
  const inside = BRUSHES.has(S.tool) && e.clientX >= wk.left && e.clientX <= wk.right && e.clientY >= wk.top && e.clientY <= wk.bottom;
  ring.hidden = !inside;
  if (!inside) return;
  const size = Math.max(3, S.sizes[S.tool] * S.zoom);
  Object.assign(ring.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - wk.left}px`, top: `${e.clientY - wk.top}px` });
}

function down(e) {
  if (e.button === 2 || e.target.closest('.text-edit, .fit-ask')) return;
  if (S.playing) hooks.stop?.();
  document.querySelector('.popover')?.remove();
  closeTextEditor();
  const wk = e.currentTarget;
  wk.setPointerCapture(e.pointerId);
  if (S.tool === 'hand' || spaceHeld || e.button === 1) {
    drag = { type: 'pan', x: e.clientX, y: e.clientY, panX: S.panX, panY: S.panY };
    S.fitted = false;
    return;
  }
  if (isDoublePress(e) && doublePress(e)) return;
  document.body.classList.add('busy');
  const p = toDoc(e);
  if (S.tool === 'select') selectDown(e, p);
  else if (S.tool === 'lasso') startLasso(p, e);
  else if (S.tool === 'vertices') verticesDown(e, p);
  else if (S.tool === 'line') lineDown(p);
  else if (S.tool === 'pencil' || S.tool === 'marker' || S.tool === 'eraser') startStroke(S.tool, p);
  else if (S.tool === 'shapes') drag = { type: 'shape', p0: p };
  else if (S.tool === 'text') textDown(e, p);
  else if (S.tool === 'bucket') bucket(e, p).catch(() => toast('That fill did not work. Try again.', 'warn'));
}

function move(e) {
  moveBrushRing(e);
  if (S.tool === 'line') lineHover(toDoc(e));
  if (S.tool === 'vertices' && !drag) vertexHover(e, toDoc(e));
  if (!drag) return;
  if (drag.type === 'pan') {
    S.panX = drag.panX + e.clientX - drag.x;
    S.panY = drag.panY + e.clientY - drag.y;
    placeFrame();
    return;
  }
  const p = toDoc(e);
  switch (drag.type) {
    case 'move': {
      const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
      if (!drag.moved && Math.hypot(dx, dy) * S.zoom < 3) return;
      drag.moved = true;
      for (const it of drag.items) edit(it.o, { x: it.x + dx, y: it.y + dy });
      break;
    }
    case 'scale': drag.moved = true; moveScale(p, e); break;
    case 'rotate': drag.moved = true; moveRotate(p, e); break;
    case 'marquee': marquee(p); return;
    case 'nodes': moveNodes(p); break;
    case 'handle': moveHandle(p, e); drag.moved = true; break;
    case 'stroke': {
      const events = e.getCoalescedEvents?.() || [];
      for (const c of events.length ? events : [e]) drag.pts.push(toDoc(c));
      updateStroke();
      return;
    }
    case 'shape': previewShape(p, e); return;
    case 'lasso':
      drag.pts.push(p);
      drag.el.setAttribute('d', `M${drag.pts.map((q) => `${q.x} ${q.y}`).join('L')}Z`);
      return;
    default: return;
  }
  liveRefresh();
}

function up(e) {
  document.body.classList.remove('busy');
  if (!drag) return;
  const d = drag;
  if (d.type === 'line') { lineUp(toDoc(e)); drag = null; return; }
  if (d.type === 'marquee') { finishMarquee(); drag = null; drawOverlay(); return; }
  if (d.type === 'lasso') finishLasso();
  else if (d.type === 'stroke') finishStroke();
  else if (d.type === 'shape') finishShape();
  else if (d.moved) { drag = null; commit(); return; }
  drag = null;
}

// Pressing redraws the handles, which removes the element under the cursor, so
// the browser's own dblclick never fires. This watches for two quick presses.
function isDoublePress(e) {
  const now = performance.now();
  const double = now - lastPress.time < DOUBLE_PRESS_MS && Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 6;
  lastPress = double ? { time: 0, x: 0, y: 0 } : { time: now, x: e.clientX, y: e.clientY };
  return double;
}

function doublePress(e) {
  if (S.tool === 'line' && S.line) { finishLine(); return true; }
  if (S.tool === 'vertices' && e.target.dataset?.n) { toggleNodeCurve(e.target.dataset.n); return true; }
  const [only] = selected();
  if (S.tool !== 'select' || S.sel.size !== 1 || (!pickable(e) && !e.target.dataset?.h)) return false;
  if (only.type === 'text') { setTimeout(() => openTextEditor(only)); return true; }
  if (only.type === 'path') { setTool('vertices'); return true; }
  return false;
}

function wheel(e) {
  e.preventDefault();
  zoomAt(S.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  hooks.overlay();
  hooks.panels();
}

export function attachTools(wk) {
  wk.addEventListener('pointerdown', down);
  wk.addEventListener('pointermove', move);
  wk.addEventListener('pointerup', up);
  wk.addEventListener('pointercancel', up);
  wk.addEventListener('contextmenu', contextMenu);
  wk.addEventListener('pointerleave', () => { $('#brush').hidden = true; });
  wk.addEventListener('wheel', wheel, { passive: false });
}
