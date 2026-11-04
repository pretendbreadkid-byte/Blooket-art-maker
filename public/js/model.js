// The document model. Pure logic with no DOM, so it can run in tests.
//
// A path is a list of subpaths; a subpath is a list of nodes:
//   { x, y, ix, iy, ox, oy, r }
// (ix,iy) and (ox,oy) are curve handles relative to the node. r rounds a corner.

export const uid = (prefix = '') => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clone = (v) => JSON.parse(JSON.stringify(v));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, places = 2) => +(+v).toFixed(places);
export const rad = (deg) => (deg * Math.PI) / 180;
export const lerp = (a, b, t) => a + (b - a) * t;

// All art lives in one stack, in drawing order. Each object is its own step in it.
export function flattenLayers(doc) {
  const [first, ...others] = doc.layers;
  if (!others.length && first.opacity === 1 && first.visible && !first.locked) return;
  for (const layer of doc.layers) {
    if (layer.opacity === 1) continue;
    for (const o of layer.objects) {
      o.opacity *= layer.opacity;
      for (const k of o.keys) if (k.pose.opacity !== undefined) k.pose.opacity *= layer.opacity;
    }
  }
  doc.layers = [{ ...first, opacity: 1, visible: true, locked: false, objects: doc.layers.flatMap((l) => l.objects) }];
  doc.activeLayerId = first.id;
}

export const newLayer = (name) => ({ id: uid('l'), name, visible: true, locked: false, opacity: 1, objects: [] });

// animMode: 'keys' slides between keyframes, 'pages' flips between whole drawings.
export function newDoc({ name, folderId = null, animated = false, animMode = 'keys', width = 1024, height = 1024 }) {
  const layer = newLayer('Layer 1');
  const doc = {
    id: uid('p'), name, folderId, animated, animMode, width, height,
    background: '#ffffff', bgGradient: null, cornerRadius: 0, fps: 12, frames: 48,
    layers: [layer], activeLayerId: layer.id,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (animated && animMode === 'pages') Object.assign(doc, { fps: 6, frames: 1, pages: [{ id: uid('g') }] });
  return doc;
}

function baseObject(type, props) {
  return {
    id: uid('o'), type, name: type, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
    fill: 'none', gradient: null, stroke: 'none', strokeWidth: 0, keys: [], erase: [], ...props,
  };
}

export const newPath = (props) => baseObject('path', { subpaths: [], fillRule: 'nonzero', ...props });
export const newText = (props) => baseObject('text', {
  name: 'Text', text: '', fontFamily: 'Arial', fontSize: 48, bold: false, italic: false, shadow: false, ...props,
});
export const newImage = (props) => baseObject('image', { name: 'Image', href: '', w: 100, h: 100, ...props });

/* ---------- Path geometry ---------- */

const hasOut = (n) => !!(n.ox || n.oy);
const hasIn = (n) => !!(n.ix || n.iy);
export const isCorner = (sp, i) => {
  const { nodes, closed } = sp;
  const N = nodes.length;
  if (N < 3 || (!closed && (i === 0 || i === N - 1))) return false;
  const n = nodes[i];
  return !hasIn(n) && !hasOut(n) && !hasOut(nodes[(i - 1 + N) % N]) && !hasIn(nodes[(i + 1) % N]);
};

function cornerGeometry(sp, i) {
  const n = sp.nodes[i];
  const plain = { inn: n, out: n, r: 0 };
  if (!n.r || !isCorner(sp, i)) return plain;
  const N = sp.nodes.length;
  const prev = sp.nodes[(i - 1 + N) % N];
  const next = sp.nodes[(i + 1) % N];
  const ax = prev.x - n.x, ay = prev.y - n.y, bx = next.x - n.x, by = next.y - n.y;
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (!la || !lb) return plain;
  const ux = ax / la, uy = ay / la, vx = bx / lb, vy = by / lb;
  const angle = Math.acos(clamp(ux * vx + uy * vy, -1, 1));
  if (angle < 0.01 || angle > Math.PI - 0.01) return plain;
  const tan = Math.tan(angle / 2);
  const t = Math.min(n.r / tan, Math.min(la, lb) / 2);
  return {
    inn: { x: n.x + ux * t, y: n.y + uy * t },
    out: { x: n.x + vx * t, y: n.y + vy * t },
    r: t * tan,
    sweep: ux * vy - uy * vx < 0 ? 1 : 0,
  };
}

// uniform writes every frame of an animation with the same commands, which
// animated SVG needs before it will warp smoothly between them.
function subpathD(sp, uniform) {
  const { nodes, closed } = sp;
  const N = nodes.length;
  if (!N) return '';
  const geo = nodes.map((_, i) => cornerGeometry(sp, i));
  const f = (v) => round(v);
  let d = `M${f(geo[0].out.x)} ${f(geo[0].out.y)}`;
  const last = closed ? N : N - 1;
  for (let k = 0; k < last; k++) {
    const a = nodes[k], j = (k + 1) % N, b = nodes[j], g = geo[j];
    const from = geo[k].out;
    if (hasOut(a) || hasIn(b)) {
      d += `C${f(a.x + (a.ox || 0))} ${f(a.y + (a.oy || 0))} ${f(b.x + (b.ix || 0))} ${f(b.y + (b.iy || 0))} ${f(g.inn.x)} ${f(g.inn.y)}`;
    } else if (uniform) {
      const c = (p, q, t) => f(p + (q - p) * t);
      d += `C${c(from.x, g.inn.x, 1 / 3)} ${c(from.y, g.inn.y, 1 / 3)} ${c(from.x, g.inn.x, 2 / 3)} ${c(from.y, g.inn.y, 2 / 3)} ${f(g.inn.x)} ${f(g.inn.y)}`;
    } else {
      d += `L${f(g.inn.x)} ${f(g.inn.y)}`;
    }
    if (uniform) {
      const c = (p, q) => f(p + (q - p) * ARC_HANDLE);
      d += `C${c(g.inn.x, b.x)} ${c(g.inn.y, b.y)} ${c(g.out.x, b.x)} ${c(g.out.y, b.y)} ${f(g.out.x)} ${f(g.out.y)}`;
    } else if (g.r) {
      d += `A${f(g.r)} ${f(g.r)} 0 0 ${g.sweep} ${f(g.out.x)} ${f(g.out.y)}`;
    }
  }
  return closed ? d + 'Z' : d;
}

const ARC_HANDLE = 0.5523;

export const pathD = (subpaths, { uniform = false } = {}) => subpaths.map((sp) => subpathD(sp, uniform)).join('');

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const cubicAt = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

export function pathBounds(subpaths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const sp of subpaths) {
    const N = sp.nodes.length;
    const last = sp.closed ? N : N - 1;
    if (N) add(sp.nodes[0].x, sp.nodes[0].y);
    for (let i = 0; i < last; i++) {
      const a = sp.nodes[i], b = sp.nodes[(i + 1) % N];
      add(b.x, b.y);
      if (!hasOut(a) && !hasIn(b)) continue;
      for (let s = 1; s < 12; s++) {
        const t = s / 12;
        add(
          cubicAt(a.x, a.x + (a.ox || 0), b.x + (b.ix || 0), b.x, t),
          cubicAt(a.y, a.y + (a.oy || 0), b.y + (b.iy || 0), b.y, t),
        );
      }
    }
  }
  if (x0 === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// Moves and scales geometry. Handles and corner radii follow the same scale.
export function mapSubpaths(subpaths, fn) {
  return subpaths.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => {
      const p = fn(n.x, n.y);
      const out = { ...p };
      if (hasIn(n)) { const q = fn(n.x + n.ix, n.y + n.iy); out.ix = q.x - p.x; out.iy = q.y - p.y; }
      if (hasOut(n)) { const q = fn(n.x + n.ox, n.y + n.oy); out.ox = q.x - p.x; out.oy = q.y - p.y; }
      if (n.r) out.r = n.r;
      return out;
    }),
  }));
}

// Scales geometry to fit a width and height, centred on (0,0).
export function fitSubpaths(subpaths, width, height) {
  const b = pathBounds(subpaths);
  const sx = b.width ? width / b.width : 1;
  const sy = b.height ? height / b.height : 1;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  return mapSubpaths(subpaths, (x, y) => ({ x: (x - cx) * sx, y: (y - cy) * sy }));
}

// Inserts a node part way along the segment that starts at index i. The curve
// keeps its exact shape.
export function splitSegment(sp, i, t = 0.5) {
  const N = sp.nodes.length;
  const j = (i + 1) % N;
  const a = sp.nodes[i], b = sp.nodes[j];
  if (!hasOut(a) && !hasIn(b)) {
    sp.nodes.splice(i + 1, 0, { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
    return i + 1;
  }
  const p1x = a.x + (a.ox || 0), p1y = a.y + (a.oy || 0);
  const p2x = b.x + (b.ix || 0), p2y = b.y + (b.iy || 0);
  const m = (p, q) => lerp(p, q, t);
  const q0x = m(a.x, p1x), q0y = m(a.y, p1y), q1x = m(p1x, p2x), q1y = m(p1y, p2y), q2x = m(p2x, b.x), q2y = m(p2y, b.y);
  const r0x = m(q0x, q1x), r0y = m(q0y, q1y), r1x = m(q1x, q2x), r1y = m(q1y, q2y);
  const x = m(r0x, r1x), y = m(r0y, r1y);
  a.ox = q0x - a.x; a.oy = q0y - a.y;
  b.ix = q2x - b.x; b.iy = q2y - b.y;
  sp.nodes.splice(i + 1, 0, { x, y, ix: r0x - x, iy: r0y - y, ox: r1x - x, oy: r1y - y });
  return i + 1;
}

function growTo(sp, count) {
  const out = clone(sp);
  while (out.nodes.length < count) {
    const N = out.nodes.length;
    const last = out.closed ? N : N - 1;
    let longest = 0, best = -1;
    for (let i = 0; i < last; i++) {
      const a = out.nodes[i], b = out.nodes[(i + 1) % N];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > best) { best = len; longest = i; }
    }
    splitSegment(out, longest);
  }
  return out;
}

function pointLike(sp) {
  const b = pathBounds([sp]);
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  return { closed: sp.closed, nodes: sp.nodes.map(() => ({ x, y })) };
}

// Gives two outlines the same points so one can warp into the other. Extra
// outlines grow from a single point.
export function matchSubpaths(a, b) {
  const left = [], right = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const p = a[i] || pointLike(b[i]), q = b[i] || pointLike(a[i]);
    const count = Math.max(p.nodes.length, q.nodes.length);
    left.push(growTo(p, count));
    right.push(growTo(q, count));
  }
  return [left, right];
}

const allPoses = (obj) => [obj, ...obj.keys.map((k) => k.pose)];

// Adds a point on every keyframe, at the same place on the outline, so the
// animation can warp to and from it. Returns the new point's index.
export function addVertex(obj, s, i, t = 0.5) {
  let index = i + 1;
  for (const pose of allPoses(obj)) {
    const sp = pose.subpaths?.[s];
    if (sp && i < sp.nodes.length) index = splitSegment(sp, i, t);
  }
  return index;
}

function segmentPoint(a, b, t) {
  if (!hasOut(a) && !hasIn(b)) return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  return {
    x: cubicAt(a.x, a.x + (a.ox || 0), b.x + (b.ix || 0), b.x, t),
    y: cubicAt(a.y, a.y + (a.oy || 0), b.y + (b.iy || 0), b.y, t),
  };
}

const SPOT_SAMPLES = 24;
const SPOT_REFINES = 14;

// Finds the closest place on an outline to (x, y). `place` turns the outline's
// own coordinates into the ones (x, y) is measured in.
export function nearestOnOutline(subpaths, x, y, place = (px, py) => ({ x: px, y: py })) {
  let best = null;
  const dist = (a, b, t) => {
    const q = segmentPoint(a, b, t);
    const p = place(q.x, q.y);
    return { ...p, dist: Math.hypot(p.x - x, p.y - y) };
  };
  subpaths.forEach((sp, s) => {
    const N = sp.nodes.length;
    const last = sp.closed ? N : N - 1;
    for (let i = 0; i < last; i++) {
      const a = sp.nodes[i], b = sp.nodes[(i + 1) % N];
      let bestT = 0, bestDist = Infinity;
      for (let k = 0; k <= SPOT_SAMPLES; k++) {
        const d = dist(a, b, k / SPOT_SAMPLES).dist;
        if (d < bestDist) { bestDist = d; bestT = k / SPOT_SAMPLES; }
      }
      let step = 1 / SPOT_SAMPLES;
      for (let k = 0; k < SPOT_REFINES; k++) {
        step /= 2;
        for (const t of [bestT - step, bestT + step]) {
          if (t < 0 || t > 1) continue;
          const d = dist(a, b, t).dist;
          if (d < bestDist) { bestDist = d; bestT = t; }
        }
      }
      if (!best || bestDist < best.dist) best = { s, i, t: bestT, ...dist(a, b, bestT) };
    }
  });
  return best;
}

export function removeVertices(obj, keys) {
  for (const pose of allPoses(obj)) {
    if (!pose.subpaths) continue;
    pose.subpaths = pose.subpaths
      .map((sp, s) => ({ ...sp, nodes: sp.nodes.filter((_, i) => !keys.has(`${s}:${i}`)) }))
      .filter((sp) => sp.nodes.length > 1);
  }
}

// Sets a node's handles along the line between its neighbours.
export function smoothNode(sp, i) {
  const { nodes, closed } = sp;
  const N = nodes.length;
  const n = nodes[i];
  const prev = i > 0 || closed ? nodes[(i - 1 + N) % N] : n;
  const next = i < N - 1 || closed ? nodes[(i + 1) % N] : n;
  const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
  n.ix = -tx; n.iy = -ty; n.ox = tx; n.oy = ty; n.r = 0;
}

export const sharpenNode = (n) => { delete n.ix; delete n.iy; delete n.ox; delete n.oy; };

/* ---------- Freehand strokes ---------- */

export function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    const a = points[lo], b = points[hi];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    let worst = -1, index = -1;
    for (let i = lo + 1; i < hi; i++) {
      const p = points[i];
      const dist = len ? Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len : Math.hypot(p.x - a.x, p.y - a.y);
      if (dist > worst) { worst = dist; index = i; }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([lo, index], [index, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function strokeToSubpath(points, tolerance = 0.8) {
  const pts = simplify(points, tolerance);
  if (pts.length === 1) pts.push({ x: pts[0].x + 0.01, y: pts[0].y });
  const sp = { closed: false, nodes: pts.map((p) => ({ x: p.x, y: p.y })) };
  if (pts.length > 2) sp.nodes.forEach((_, i) => smoothNode(sp, i));
  return sp;
}

/* ---------- Keyframes ---------- */

export const POSE_PROPS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity', 'blur', 'fill', 'gradient', 'stroke', 'strokeWidth', 'subpaths'];

export const EASINGS = {
  linear: { label: 'Steady', fn: (t) => t },
  ease: { label: 'Smooth', fn: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2) },
  in: { label: 'Speed up', fn: (t) => t * t },
  out: { label: 'Slow down', fn: (t) => 1 - (1 - t) ** 2 },
  hold: { label: 'Jump (no slide)', fn: () => 0 },
};

function pose(o) {
  const p = {};
  for (const k of POSE_PROPS) if (o[k] !== undefined) p[k] = clone(o[k]);
  return p;
}

function lerpColor(a, b, t) {
  if (a === b) return a;
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return t < 0.5 ? a : b;
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const hex = (i) => Math.round(lerp(channel(a, i), channel(b, i), t)).toString(16).padStart(2, '0');
  return `#${hex(0)}${hex(1)}${hex(2)}`;
}

function lerpGradient(a, b, t) {
  if (!a || !b || a.raw || b.raw) return t < 0.5 ? a ?? null : b ?? null;
  return { from: lerpColor(a.from, b.from, t), to: lerpColor(a.to, b.to, t), angle: lerp(a.angle, b.angle, t) };
}

function sameShape(a, b) {
  return a.length === b.length && a.every((sp, i) => sp.nodes.length === b[i].nodes.length);
}

function lerpSubpaths(a, b, t) {
  const [from, to] = sameShape(a, b) ? [a, b] : matchSubpaths(a, b);
  return from.map((sp, s) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n, i) => {
      const m = to[s].nodes[i];
      const out = {};
      for (const k of ['x', 'y', 'ix', 'iy', 'ox', 'oy', 'r']) out[k] = lerp(n[k] || 0, m[k] || 0, t);
      return out;
    }),
  }));
}

function lerpPose(a, b, t) {
  const out = {};
  for (const k of POSE_PROPS) {
    // Older art has no blur, so a missing one counts as none.
    if (k === 'blur' && (a.blur || b.blur)) { out.blur = lerp(a.blur || 0, b.blur || 0, t); continue; }
    if (a[k] === undefined) continue;
    if (k === 'fill' || k === 'stroke') out[k] = lerpColor(a[k], b[k], t);
    else if (k === 'gradient') out[k] = lerpGradient(a[k], b[k], t);
    else if (k === 'subpaths') out[k] = lerpSubpaths(a[k], b[k], t);
    else out[k] = lerp(a[k], b[k], t);
  }
  return out;
}

// The object as it looks on a frame.
export function sample(obj, frame) {
  const keys = obj.keys;
  if (!keys || !keys.length) return obj;
  if (frame <= keys[0].f) return { ...obj, ...keys[0].pose };
  const last = keys[keys.length - 1];
  if (frame >= last.f) return { ...obj, ...last.pose };
  let i = 0;
  while (keys[i + 1].f <= frame) i++;
  const a = keys[i], b = keys[i + 1];
  const t = (frame - a.f) / (b.f - a.f);
  return { ...obj, ...lerpPose(a.pose, b.pose, EASINGS[a.ease || 'linear'].fn(t)) };
}

// Applies an edit. In an animation, anything that can move gets a keyframe here.
export function setProps(doc, obj, frame, patch) {
  const posed = {}, plain = {};
  for (const [k, v] of Object.entries(patch)) (POSE_PROPS.includes(k) ? posed : plain)[k] = v;
  Object.assign(obj, plain);
  if (!Object.keys(posed).length) return;
  if (!doc.animated || isPages(doc) || (!obj.keys.length && frame === 0)) {
    Object.assign(obj, posed);
    return;
  }
  if (!obj.keys.length) obj.keys.push({ f: 0, ease: 'ease', pose: pose(obj) });
  const existing = obj.keys.find((k) => k.f === frame);
  if (existing) { Object.assign(existing.pose, clone(posed)); return; }
  addKey(obj, frame, posed);
}

export function addKey(obj, frame, patch = {}) {
  const current = pose(sample(obj, frame));
  const existing = obj.keys.find((k) => k.f === frame);
  if (existing) { Object.assign(existing.pose, clone(patch)); return existing; }
  const key = { f: frame, ease: 'ease', pose: { ...current, ...clone(patch) } };
  obj.keys.push(key);
  obj.keys.sort((a, b) => a.f - b.f);
  return key;
}

export function removeKey(obj, frame) {
  const before = sample(obj, frame);
  obj.keys = obj.keys.filter((k) => k.f !== frame);
  // Removing the last key leaves the object where it was on that frame.
  if (!obj.keys.length) Object.assign(obj, pose(before));
}

export function moveKey(obj, from, to) {
  if (from === to || obj.keys.some((k) => k.f === to)) return false;
  const key = obj.keys.find((k) => k.f === from);
  if (!key) return false;
  key.f = to;
  obj.keys.sort((a, b) => a.f - b.f);
  return true;
}

const BACKWARDS = { in: 'out', out: 'in' };
const reversedEase = (key) => BACKWARDS[key.ease] || key.ease || 'ease';

// Mirrors the animation so it plays backwards to where it began. Everything
// turns around on the same frame, so things animated together stay together.
// Returns the last frame used, or null if nothing has moved yet.
export function loopBack(objects) {
  const moving = objects.filter((o) => o.keys.length > 1);
  if (!moving.length) return null;
  const turn = Math.max(...moving.map((o) => o.keys[o.keys.length - 1].f));
  let end = turn;
  for (const o of moving) {
    addKey(o, turn);
    const { keys } = o;
    const pivot = keys.length - 1;
    keys[pivot].ease = reversedEase(keys[pivot - 1]);
    for (let i = pivot - 1; i >= 0; i--) {
      keys.push({ f: 2 * turn - keys[i].f, ease: i ? reversedEase(keys[i - 1]) : 'ease', pose: clone(keys[i].pose) });
    }
    end = Math.max(end, keys[keys.length - 1].f);
  }
  return end;
}

/* ---------- Pages ---------- */

export const isPages = (doc) => !!doc.animated && doc.animMode === 'pages';

// In a page animation, each object lives on one page.
export const onFrame = (doc, o, frame) => !isPages(doc) || o.page === doc.pages[frame]?.id;
export const objectsOn = (doc, layer, frame) => layer.objects.filter((o) => onFrame(doc, o, frame));

// Gives copies their own groups, so picking one never picks the original too.
export function regroup(objects) {
  const fresh = new Map();
  for (const o of objects) {
    if (!o.group) continue;
    if (!fresh.has(o.group)) fresh.set(o.group, uid('t'));
    o.group = fresh.get(o.group);
  }
  return objects;
}

function copyPageObjects(doc, fromId, toId) {
  for (const layer of doc.layers) {
    const copies = layer.objects.filter((o) => o.page === fromId)
      .map((o) => ({ ...clone(o), id: uid('o'), page: toId }));
    layer.objects.push(...regroup(copies));
  }
}

// Adds a page after index `at`. With `copyFrom`, it starts as a copy of that page.
export function addPage(doc, at, copyFrom = null) {
  const page = { id: uid('g') };
  const source = copyFrom === null ? null : doc.pages[copyFrom];
  doc.pages.splice(at + 1, 0, page);
  if (source) copyPageObjects(doc, source.id, page.id);
  doc.frames = doc.pages.length;
  return at + 1;
}

export function removePage(doc, index) {
  if (doc.pages.length < 2) return false;
  const [gone] = doc.pages.splice(index, 1);
  for (const layer of doc.layers) layer.objects = layer.objects.filter((o) => o.page !== gone.id);
  doc.frames = doc.pages.length;
  return true;
}

export function movePage(doc, from, to) {
  doc.pages.splice(to, 0, doc.pages.splice(from, 1)[0]);
}

// 1 2 3 becomes 1 2 3 2 1.
export function loopPagesBack(doc) {
  if (doc.pages.length < 2) return false;
  for (let i = doc.pages.length - 2; i >= 0; i--) addPage(doc, doc.pages.length - 1, i);
  return true;
}

/* ---------- Connecting lines ---------- */

const closeTo = (a, b, gap) => Math.hypot(a.x - b.x, a.y - b.y) <= gap;

export function reverseSubpath(sp) {
  return {
    closed: sp.closed,
    nodes: [...sp.nodes].reverse().map((n) => {
      const out = { x: n.x, y: n.y };
      if (n.ox || n.oy) { out.ix = n.ox; out.iy = n.oy; }
      if (n.ix || n.iy) { out.ox = n.ix; out.oy = n.iy; }
      return out;
    }),
  };
}

function appendSubpath(a, b, gap) {
  const last = a.nodes[a.nodes.length - 1], first = b.nodes[0];
  const touching = closeTo(last, first, gap);
  if (touching && (first.ox || first.oy)) { last.ox = first.ox; last.oy = first.oy; }
  return { closed: false, nodes: [...a.nodes, ...(touching ? b.nodes.slice(1) : b.nodes)] };
}

function closeIfTouching(sp, gap) {
  const { nodes } = sp;
  if (nodes.length < 3 || !closeTo(nodes[0], nodes[nodes.length - 1], gap)) return sp;
  const last = nodes[nodes.length - 1];
  const first = { ...nodes[0] };
  if (last.ix || last.iy) { first.ix = last.ix; first.iy = last.iy; }
  return { closed: true, nodes: [first, ...nodes.slice(1, -1)] };
}

// Chains open lines into one, always taking the nearest loose end next. Ends
// within `gap` become one point. If the two final ends meet, the line closes.
export function chainSubpaths(subpaths, gap = 1e-3) {
  const rest = clone(subpaths);
  let chain = rest.shift();
  while (rest.length) {
    const head = chain.nodes[0], tail = chain.nodes[chain.nodes.length - 1];
    let best = null;
    rest.forEach((sp, i) => {
      const first = sp.nodes[0], last = sp.nodes[sp.nodes.length - 1];
      const options = [[tail, first, 'after', false], [tail, last, 'after', true], [head, last, 'before', false], [head, first, 'before', true]];
      for (const [mine, theirs, side, flip] of options) {
        const dist = Math.hypot(mine.x - theirs.x, mine.y - theirs.y);
        if (!best || dist < best.dist) best = { i, side, flip, dist };
      }
    });
    const [next] = rest.splice(best.i, 1);
    const piece = best.flip ? reverseSubpath(next) : next;
    chain = best.side === 'after' ? appendSubpath(chain, piece, gap) : appendSubpath(piece, chain, gap);
  }
  return closeIfTouching(chain, gap);
}

/* ---------- Transforms ---------- */

export function localToWorld(o, x, y) {
  const a = rad(o.rotation), c = Math.cos(a), s = Math.sin(a);
  const lx = x * o.scaleX, ly = y * o.scaleY;
  return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c };
}

export function worldToLocal(o, x, y) {
  const a = -rad(o.rotation), c = Math.cos(a), s = Math.sin(a);
  const dx = x - o.x, dy = y - o.y;
  return { x: (dx * c - dy * s) / (o.scaleX || 1), y: (dx * s + dy * c) / (o.scaleY || 1) };
}

export function worldVectorToLocal(o, dx, dy) {
  const a = -rad(o.rotation), c = Math.cos(a), s = Math.sin(a);
  return { x: (dx * c - dy * s) / (o.scaleX || 1), y: (dx * s + dy * c) / (o.scaleY || 1) };
}

// Mirrors a posed object across a line through (cx, cy). The turn reverses too,
// so a tilted piece stays in the right place in a flipped group.
export function flipped(o, axis, cx, cy) {
  return axis === 'x'
    ? { x: 2 * cx - o.x, rotation: -o.rotation, scaleX: -o.scaleX }
    : { y: 2 * cy - o.y, rotation: -o.rotation, scaleY: -o.scaleY };
}

/* ---------- SVG path parsing ---------- */

function arcToCubics(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const phi = rad(phiDeg), cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const scale = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (scale > 1) { rx *= Math.sqrt(scale); ry *= Math.sqrt(scale); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const parts = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9) || 1;
  const step = dt / parts, k = (4 / 3) * Math.tan(step / 4);
  const point = (t) => ({
    x: cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp,
    y: cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp,
  });
  const deriv = (t) => ({
    x: -rx * Math.sin(t) * cp - ry * Math.cos(t) * sp,
    y: -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp,
  });
  const out = [];
  for (let i = 0; i < parts; i++) {
    const a = t1 + i * step, b = a + step;
    const pa = point(a), pb = point(b), da = deriv(a), db = deriv(b);
    out.push([pa.x + k * da.x, pa.y + k * da.y, pb.x - k * db.x, pb.y - k * db.y, pb.x, pb.y]);
  }
  return out;
}

export function parseD(d) {
  const subs = [];
  const numberAt = /[\s,]*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/y;
  const flagAt = /[\s,]*([01])/y;
  let pos = 0;
  const read = (re) => {
    re.lastIndex = pos;
    const m = re.exec(d);
    if (!m) throw new Error('Could not read this path.');
    pos = re.lastIndex;
    return parseFloat(m[1]);
  };
  const num = () => read(numberAt);
  const flag = () => read(flagAt);

  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', prevCmd = '', cx = 0, cy = 0;
  const start = (px, py) => { cur = { closed: false, nodes: [{ x: px, y: py }] }; subs.push(cur); x = sx = px; y = sy = py; };
  const ensure = () => { if (!cur) start(x, y); };
  const line = (px, py) => { ensure(); cur.nodes.push({ x: px, y: py }); x = px; y = py; };
  const curve = (x1, y1, x2, y2, ex, ey) => {
    ensure();
    const n = cur.nodes[cur.nodes.length - 1];
    n.ox = x1 - n.x; n.oy = y1 - n.y;
    cur.nodes.push({ x: ex, y: ey, ix: x2 - ex, iy: y2 - ey });
    x = ex; y = ey;
  };
  const quad = (qx, qy, ex, ey) => {
    const k = 2 / 3;
    curve(x + k * (qx - x), y + k * (qy - y), ex + k * (qx - ex), ey + k * (qy - ey), ex, ey);
  };

  const next = /[\s,]*([a-zA-Z])/y;
  while (pos < d.length) {
    next.lastIndex = pos;
    const m = next.exec(d);
    if (m) { cmd = m[1]; pos = next.lastIndex; }
    else if (!/\S/.test(d.slice(pos))) break;
    else if (!cmd || /[zZ]/.test(cmd)) throw new Error('Could not read this path.');
    const rel = cmd === cmd.toLowerCase();
    const dx = rel ? x : 0, dy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': { const px = num() + dx, py = num() + dy; start(px, py); cmd = rel ? 'l' : 'L'; break; }
      case 'L': { const px = num() + dx, py = num() + dy; line(px, py); break; }
      case 'H': line(num() + dx, y); break;
      case 'V': line(x, num() + dy); break;
      case 'C': { const a = num() + dx, b = num() + dy, c = num() + dx, e = num() + dy, f = num() + dx, g = num() + dy; curve(a, b, c, e, f, g); cx = c; cy = e; break; }
      case 'S': {
        const smooth = /[CS]/i.test(prevCmd);
        const a = smooth ? 2 * x - cx : x, b = smooth ? 2 * y - cy : y;
        const c = num() + dx, e = num() + dy, f = num() + dx, g = num() + dy;
        curve(a, b, c, e, f, g); cx = c; cy = e; break;
      }
      case 'Q': { const a = num() + dx, b = num() + dy, f = num() + dx, g = num() + dy; quad(a, b, f, g); cx = a; cy = b; break; }
      case 'T': {
        const smooth = /[QT]/i.test(prevCmd);
        const a = smooth ? 2 * x - cx : x, b = smooth ? 2 * y - cy : y;
        const f = num() + dx, g = num() + dy;
        quad(a, b, f, g); cx = a; cy = b; break;
      }
      case 'A': {
        const rx = num(), ry = num(), phi = num(), large = flag(), sweep = flag(), ex = num() + dx, ey = num() + dy;
        for (const c of arcToCubics(x, y, rx, ry, phi, large, sweep, ex, ey)) curve(...c);
        break;
      }
      case 'Z': {
        if (cur) {
          cur.closed = true;
          const nodes = cur.nodes, first = nodes[0], last = nodes[nodes.length - 1];
          if (nodes.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-3) {
            if (last.ix || last.iy) { first.ix = last.ix; first.iy = last.iy; }
            nodes.pop();
          }
        }
        cur = null; x = sx; y = sy;
        break;
      }
      default: throw new Error('Could not read this path.');
    }
    prevCmd = cmd;
  }
  return subs.filter((s) => s.nodes.length > 1);
}
