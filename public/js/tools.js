// Everything that happens when you press, drag and release on the canvas.
import {
  S, hooks, refresh, liveRefresh, commit, activeLayer, layerOf, findObj, selected, select, posed, edit,
} from './state.js';
import {
  toDoc, objectEl, liveLayer, worldBox, selectionFrame, placeFrame, zoomAt, drawOverlay,
} from './stage.js';
import {
  newPath, newText, newImage, clone, pathD, fitSubpaths, strokeToSubpath, splitSegment, smoothNode, sharpenNode,
  worldToLocal, worldVectorToLocal, rad, simplify, pathBounds,
} from './model.js';
import { floodRegion, dilate, traceLoops } from './bucket.js';
import { exportSVG, rasterize, esc } from './render.js';
import { toast, $ } from './ui.js';

let drag = null;
let spaceHeld = false;
let textBox = null;
let lastPress = { time: 0, x: 0, y: 0 };

const DOUBLE_PRESS_MS = 350;

export const setSpaceHeld = (v) => { spaceHeld = v; };

export const TOOLS = {
  select: { label: 'Select', key: 'V', hint: 'Click something to pick it, then drag to move. Drag the corners to resize and the round handle to turn it.' },
  vertices: { label: 'Vertices', key: 'A', hint: 'Click a shape, then drag its points. Click a small dot to add a point. Double-click a point to curve it.' },
  pencil: { label: 'Pencil', key: 'P', hint: 'Drag to draw a thin, sharp line.' },
  marker: { label: 'Marker', key: 'M', hint: 'Drag to draw a thick, see-through line.' },
  shapes: { label: 'Shapes', key: 'S', hint: 'Pick a shape, then drag on the canvas to draw it. Or just click to drop one in.' },
  bucket: { label: 'Bucket', key: 'B', hint: 'Click inside a shape or a closed drawing to fill it with colour.' },
  text: { label: 'Text', key: 'T', hint: 'Click on the canvas and start typing.' },
  eraser: { label: 'Eraser', key: 'E', hint: 'Drag over your art to rub it out. It only erases the layer you have picked.' },
  hand: { label: 'Move view', key: 'H', hint: 'Drag to move around. You can also hold Space anywhere, and scroll to zoom.' },
};

const DRAWING = new Set(['pencil', 'marker', 'shapes', 'text', 'eraser', 'bucket']);

function layerReady() {
  const layer = activeLayer();
  if (layer.locked) { toast('This layer is locked. Unlock it in the Layers panel.', 'warn'); return false; }
  if (!layer.visible) { toast('This layer is hidden. Show it in the Layers panel.', 'warn'); return false; }
  return true;
}

const pickable = (e) => {
  const el = e.target.closest?.('[data-id]');
  if (!el) return null;
  const o = findObj(el.dataset.id);
  return o && !layerOf(o.id).locked ? o : null;
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
  if (h && h !== 'move') { startTransform(h, p, e); return; }
  if (h === 'move' && !e.shiftKey) { startMove(p); return; }
  let hit = pickable(e);
  if (h === 'move') {
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.closest('[data-id]'));
    hit = under ? findObj(under.closest('[data-id]').dataset.id) : null;
  }
  if (hit) {
    if (e.shiftKey) {
      const next = new Set(S.sel);
      next.has(hit.id) ? next.delete(hit.id) : next.add(hit.id);
      select([...next]);
    } else if (!S.sel.has(hit.id)) {
      select([hit.id]);
    }
    refresh();
    startMove(p);
    return;
  }
  if (!e.shiftKey && S.sel.size) { select([]); refresh(); }
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
  for (const layer of S.doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const o of layer.objects) {
      const b = worldBox([o.id]);
      if (b && b.x < r.x + r.w && b.x + b.width > r.x && b.y < r.y + r.h && b.y + b.height > r.y) ids.push(o.id);
    }
  }
  select(ids);
  refresh();
}

/* ---------- Vertices ---------- */

function verticesDown(e, p) {
  const t = e.target.dataset || {};
  const [item] = selected();
  if (item && (t.n || t.hd || t.mid)) {
    const s = posed(item);
    const subpaths = clone(s.subpaths);
    if (t.mid) {
      const [sp, i] = t.mid.split(':').map(Number);
      const index = splitSegment(subpaths[sp], i);
      S.nodeSel = new Set([`${sp}:${index}`]);
      edit(item, { subpaths });
      refresh();
      drag = { type: 'nodes', item, pose: s, base: clone(subpaths), p0: p, moved: true };
      return;
    }
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

export function deleteNodes() {
  const [item] = selected();
  if (!item || !S.nodeSel.size) return false;
  const subpaths = clone(posed(item).subpaths);
  const doomed = new Set(S.nodeSel);
  const kept = subpaths
    .map((sp, s) => ({ ...sp, nodes: sp.nodes.filter((_, i) => !doomed.has(`${s}:${i}`)) }))
    .filter((sp) => sp.nodes.length > 1);
  S.nodeSel.clear();
  if (!kept.length) { deleteSelection(); return true; }
  edit(item, { subpaths: kept });
  commit();
  return true;
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
  activeLayer().objects.push(newPath({
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
  if (!touched) toast('Nothing to erase here on this layer.');
  commit();
}

/* ---------- Shapes ---------- */

const DEFAULT_SHAPE_SIZE = 0.25;

function shapePaint(shape) {
  if (shape.lineOnly) return { fill: 'none', stroke: S.stroke, strokeWidth: Math.max(S.shapeOutline, 6) };
  return { fill: S.fill, stroke: S.stroke, strokeWidth: S.shapeOutline };
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
  activeLayer().objects.push(obj);
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
    edit(hit, onFill ? { fill: S.fill } : { stroke: S.fill });
    commit();
    return;
  }
  for (const layer of [...doc.layers].reverse()) {
    if (!layer.visible || layer.locked) continue;
    for (const o of [...layer.objects].reverse()) {
      if (o.type !== 'path' || o.fill !== 'none' || !o.subpaths.every((sp) => sp.closed)) continue;
      const el = objectEl(o.id)?.querySelector('path');
      if (el && isInFill(el, e)) { edit(o, { fill: S.fill }); commit(); return; }
    }
  }
  if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
  const blank = !doc.layers.some((l) => l.visible && l.objects.length);
  if (blank) { doc.background = S.fill; commit(); return; }
  if (!layerReady()) return;

  const scale = Math.min(2, 1800 / Math.max(doc.width, doc.height));
  const w = Math.round(doc.width * scale), h = Math.round(doc.height * scale);
  const canvas = await rasterize(exportSVG(doc, { frame: S.frame }), w, h);
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const { mask, area } = floodRegion(data, w, h, Math.floor(p.x * scale), Math.floor(p.y * scale));
  if (area === w * h) { doc.background = S.fill; commit(); return; }
  const loops = traceLoops(dilate(mask, w, h), w, h);
  if (!loops.length) return;
  const subpaths = loops.map((loop) => ({ closed: true, nodes: loop.map((q) => ({ x: q.x / scale, y: q.y / scale })) }));
  const b = pathBounds(subpaths);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  subpaths.forEach((sp) => sp.nodes.forEach((n) => { n.x -= cx; n.y -= cy; }));
  activeLayer().objects.push(newPath({ name: 'Fill', x: cx, y: cy, subpaths, fill: S.fill, fillRule: 'evenodd' }));
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
  if (!layerReady()) return;
  const obj = newText({ x: p.x, y: p.y, fill: S.fill, ...S.font });
  activeLayer().objects.push(obj);
  select([obj.id]);
  refresh();
  // Wait for the press to finish, or the new box loses focus straight away.
  setTimeout(() => openTextEditor(obj));
}

/* ---------- Actions ---------- */

export function setTool(name) {
  closeTextEditor();
  S.tool = name;
  S.nodeSel.clear();
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
  for (const o of selected()) {
    const layer = layerOf(o.id);
    const copy = { ...clone(o), id: `${o.id}c${Math.random().toString(36).slice(2, 7)}` };
    copy.x += 24; copy.y += 24;
    for (const k of copy.keys) { k.pose.x += 24; k.pose.y += 24; }
    layer.objects.push(copy);
    ids.push(copy.id);
  }
  select(ids);
  commit();
}

export function copySelection() {
  S.clipboard = selected().map(clone);
}

export function pasteClipboard() {
  if (!S.clipboard?.length || !layerReady()) return;
  const ids = [];
  for (const o of S.clipboard) {
    const copy = { ...clone(o), id: `${o.id}c${Math.random().toString(36).slice(2, 7)}` };
    copy.x += 24; copy.y += 24;
    for (const k of copy.keys) { k.pose.x += 24; k.pose.y += 24; }
    activeLayer().objects.push(copy);
    ids.push(copy.id);
  }
  select(ids);
  commit();
}

export function reorderSelection(direction) {
  for (const layer of S.doc.layers) {
    const list = layer.objects;
    const chosen = list.filter((o) => S.sel.has(o.id));
    if (!chosen.length) continue;
    const rest = list.filter((o) => !S.sel.has(o.id));
    if (direction === 'front') layer.objects = [...rest, ...chosen];
    else if (direction === 'back') layer.objects = [...chosen, ...rest];
    else {
      const step = direction === 'up' ? 1 : -1;
      const order = direction === 'up' ? [...list].reverse() : list;
      for (const o of order) {
        if (!S.sel.has(o.id)) continue;
        const i = list.indexOf(o), j = i + step;
        if (j >= 0 && j < list.length && !S.sel.has(list[j].id)) { list[i] = list[j]; list[j] = o; }
      }
    }
  }
  commit();
}

export function flipSelection(axis) {
  for (const o of selected()) {
    const s = posed(o);
    edit(o, axis === 'x' ? { scaleX: -s.scaleX } : { scaleY: -s.scaleY });
  }
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
  if (!layerReady()) return;
  const img = new Image();
  img.src = href;
  await img.decode();
  const w = img.naturalWidth || 300, h = img.naturalHeight || 300;
  const fit = Math.min(1, (S.doc.width * 0.8) / w, (S.doc.height * 0.8) / h);
  const obj = newImage({
    x: x ?? S.doc.width / 2, y: y ?? S.doc.height / 2, href, w: w * fit, h: h * fit,
  });
  activeLayer().objects.push(obj);
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
  if (e.button === 2 || e.target.closest('.text-edit')) return;
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
  if (DRAWING.has(S.tool) && S.tool !== 'bucket' && S.tool !== 'text' && !layerReady()) return;
  if (S.tool === 'select') selectDown(e, p);
  else if (S.tool === 'vertices') verticesDown(e, p);
  else if (S.tool === 'pencil' || S.tool === 'marker' || S.tool === 'eraser') startStroke(S.tool, p);
  else if (S.tool === 'shapes') drag = { type: 'shape', p0: p };
  else if (S.tool === 'text') textDown(e, p);
  else if (S.tool === 'bucket') bucket(e, p).catch(() => toast('That fill did not work. Try again.', 'warn'));
}

function move(e) {
  moveBrushRing(e);
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
    default: return;
  }
  liveRefresh();
}

function up() {
  document.body.classList.remove('busy');
  if (!drag) return;
  const d = drag;
  if (d.type === 'marquee') { finishMarquee(); drag = null; drawOverlay(); return; }
  if (d.type === 'stroke') finishStroke();
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
  wk.addEventListener('pointerleave', () => { $('#brush').hidden = true; });
  wk.addEventListener('wheel', wheel, { passive: false });
}
