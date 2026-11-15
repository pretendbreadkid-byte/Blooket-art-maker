// Turns a flat picture (PNG, JPG…) into colour pieces with clean, smooth outlines.
//
// 1. Colours are grouped by how alike they look to a person (Lab colour), not by
//    raw numbers, so a shade and its highlight stay apart while near-copies merge.
// 2. The soft blend pixels between two colours are folded into a neighbour, so
//    they don't turn into slivers.
// 3. Pieces are stacked biggest first. A piece fills in any hole that pieces on top
//    of it will cover, and tucks a pixel under its neighbours, so no seams show.
// 4. Each outline is fitted with as few curves as follow it, keeping sharp corners sharp.
import { subjectMask, cleanMask } from './trace.js';
import { traceLoops } from './bucket.js';

// Pictures are traced at least this big (small ones enlarged), and big ones up to TRACE_MAX.
export const TRACE_PX = 640;
const TRACE_MAX = 820;
const MAX_COLOURS = 32;
const KMEANS_ROUNDS = 10;
const SAMPLE_COUNT = 40000;
const SAME_LOOK = 4; // Colours closer than this (in Lab) count as one.
const LOOKALIKE = 6; // A thin strip this close in colour to its neighbour is part of it.
const RARE_COLOUR = 0.0004;
const MIN_PIECE_SHARE = 0.00015;
const THIN = 1.7; // Patches thinner than this many pixels are blend lines.
const BLEND_THICK = 5; // Thicker than THIN, a patch is a blend only if its colour is between its neighbours'.
const MAX_PIECES = 260;
const FIT_ERROR = 0.8; // How far (in pixels) a curve may stray from the outline.
const SMOOTH_PASSES = 3;
const STRAIGHT = 0.4; // A curve whose handles stray less than this from straight is a line.

/* ---------- Colour ---------- */

const LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function toLab(r, g, b) {
  const R = LINEAR[r], G = LINEAR[g], B = LINEAR[b];
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function nearest(centres, lab) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < centres.length; i++) {
    const d = dist2(centres[i], lab);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// The picture's main colours: k-means in Lab, started from spread-out guesses,
// then near-copies merged and colours almost nobody uses dropped.
export function findColours(rgba, mask) {
  const picked = [];
  const total = mask.reduce((s, v) => s + v, 0);
  const stride = Math.max(1, Math.floor(total / SAMPLE_COUNT));
  let seen = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    if (seen++ % stride) continue;
    picked.push(toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]));
  }
  if (!picked.length) return [];
  // Spread-out starting guesses: each new one is the sample furthest from all the others.
  const centres = [picked[0]];
  const far = picked.map((p) => dist2(p, picked[0]));
  while (centres.length < MAX_COLOURS) {
    let at = -1, most = SAME_LOOK ** 2;
    for (let i = 0; i < picked.length; i++) if (far[i] > most) { most = far[i]; at = i; }
    if (at < 0) break;
    centres.push(picked[at]);
    for (let i = 0; i < picked.length; i++) far[i] = Math.min(far[i], dist2(picked[i], picked[at]));
  }
  let groups = centres.map((c) => ({ c, n: 0 }));
  for (let round = 0; round < KMEANS_ROUNDS; round++) {
    const sums = groups.map(() => [0, 0, 0, 0]);
    for (const p of picked) {
      const s = sums[nearest(groups.map((g) => g.c), p)];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    groups = sums.filter((s) => s[3]).map((s) => ({ c: [s[0] / s[3], s[1] / s[3], s[2] / s[3]], n: s[3] }));
  }
  // Merge colours that look the same, the commoner one winning.
  groups.sort((a, b) => b.n - a.n);
  const kept = [];
  for (const g of groups) {
    const twin = kept.find((k) => dist2(k.c, g.c) < SAME_LOOK ** 2);
    if (twin) twin.n += g.n; else kept.push({ ...g });
  }
  const floor = picked.length * RARE_COLOUR;
  return kept.filter((g, i) => i === 0 || g.n >= floor).map((g) => g.c);
}

/* ---------- Patches ---------- */

const sides = (i, width, size) => {
  const x = i % width;
  return [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i + width < size ? i + width : -1];
};

// Connected patches of one colour. id[i] is the patch of pixel i, or -1.
function findPatches(labels, width) {
  const size = labels.length;
  const id = new Int32Array(size).fill(-1);
  const patches = [];
  const stack = [];
  for (let start = 0; start < size; start++) {
    if (id[start] >= 0 || labels[start] < 0) continue;
    const label = labels[start], pixels = [];
    const n = patches.length;
    id[start] = n;
    stack.push(start);
    let edge = 0;
    while (stack.length) {
      const i = stack.pop();
      pixels.push(i);
      for (const j of sides(i, width, size)) {
        if (j < 0 || labels[j] !== label) { edge++; continue; }
        if (id[j] < 0) { id[j] = n; stack.push(j); }
      }
    }
    patches.push({ label, pixels, edge });
  }
  return { id, patches };
}

// Whether RGB colour c sits between a and b: a soft blend from one to the other.
// Pictures blend in RGB, so this is checked in RGB.
const BLEND_GAP = 60, BLEND_OFF = 26, BLEND_SIDE = 0.22;
function between(c, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (len2 < BLEND_GAP ** 2) return false;
  const t = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / len2;
  if (t < 0.08 || t > 0.92) return false;
  return dist2(c, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]) < BLEND_OFF ** 2;
}

// Specks and blend lines join the neighbour they share the most edge with. A
// wider blend between two colours is split down the middle between them.
function absorbSmall(labels, width, minSize, centres, rgba, rgbs) {
  for (let pass = 0; pass < 4; pass++) {
    const { id, patches } = findPatches(labels, width);
    let changed = false;
    // Smallest first, so a speck joins a real patch, not another speck.
    const order = patches.map((_, i) => i).sort((a, b) => patches[a].pixels.length - patches[b].pixels.length);
    for (const n of order) {
      const p = patches[n];
      const thickness = (2 * p.pixels.length) / Math.max(1, p.edge);
      const small = p.pixels.length < minSize;
      if (!small && thickness >= BLEND_THICK) continue;
      const votes = new Map();
      let open = 0;
      for (const i of p.pixels) {
        for (const j of sides(i, width, labels.length)) {
          if (j < 0 || labels[j] < 0) { open++; continue; }
          if (id[j] === n || labels[j] === p.label) continue;
          votes.set(labels[j], (votes.get(labels[j]) || 0) + 1);
        }
      }
      if (!votes.size) continue;
      if (!small) {
        // Only a blend if its colour is on the way from one neighbour to another.
        // A real blend runs along the edge between its two colours, so it touches
        // both a lot; a line that just crosses something only touches it briefly.
        const touching = [...votes].reduce((sum, [, count]) => sum + count, 0);
        const near = [...votes].sort((a, b) => b[1] - a[1]).filter(([, count]) => count >= touching * BLEND_SIDE).slice(0, 4).map(([label]) => label);
        let pair = null;
        for (let a = 0; a < near.length && !pair; a++) {
          for (let b = a + 1; b < near.length && !pair; b++) {
            if (between(rgbs[p.label], rgbs[near[a]], rgbs[near[b]])) pair = [near[a], near[b]];
          }
        }
        if (!pair) {
          // A thin strip stays if it's a real line: a colour of its own, inside the art.
          if (thickness >= THIN) continue;
          const top = [...votes].sort((a, b) => b[1] - a[1])[0][0];
          if (dist2(centres[p.label], centres[top]) >= LOOKALIKE ** 2 && open < p.edge * 0.3) continue;
        }
        if (pair) for (const i of p.pixels) {
          const lab = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
          labels[i] = dist2(lab, centres[pair[0]]) <= dist2(lab, centres[pair[1]]) ? pair[0] : pair[1];
        }
        if (pair) { changed = true; continue; }
      }
      let winner = -1, most = 0;
      for (const [label, count] of votes) if (count > most) { most = count; winner = label; }
      for (const i of p.pixels) labels[i] = winner;
      changed = true;
    }
    if (!changed) break;
  }
}

/* ---------- Stacking ---------- */

// The patch's own pixels, plus holes that only pieces drawn on top of it fill
// (so it can be one simple shape underneath them), plus a pixel's reach under its
// neighbours on top, so no seam shows between them.
function stackedBlob(n, pixels, order, mask, width, height, reach = 1) {
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (const i of pixels) {
    const x = i % width, y = (i - x) / width;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  x0 = Math.max(0, x0 - reach); y0 = Math.max(0, y0 - reach); x1 = Math.min(width - 1, x1 + reach); y1 = Math.min(height - 1, y1 + reach);
  const blob = new Uint8Array(width * height);
  for (const i of pixels) blob[i] = 1;
  // Everything in the box not reachable from the box's edge is a hole.
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const outside = new Uint8Array(bw * bh);
  const at = (x, y) => (y - y0) * bw + (x - x0);
  const stack = [];
  const push = (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return;
    const k = at(x, y);
    if (outside[k] || blob[y * width + x]) return;
    outside[k] = 1;
    stack.push(x, y);
  };
  for (let x = x0; x <= x1; x++) { push(x, y0); push(x, y1); }
  for (let y = y0; y <= y1; y++) { push(x0, y); push(x1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  const done = new Uint8Array(bw * bh);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const k = at(x, y);
      if (outside[k] || done[k] || blob[y * width + x]) continue;
      // One hole: fill it if everything in it is covered by pieces on top.
      const hole = [];
      let coverable = true;
      done[k] = 1;
      stack.push(x, y);
      while (stack.length) {
        const hy = stack.pop(), hx = stack.pop();
        const i = hy * width + hx;
        hole.push(i);
        if (!mask[i] || order[i] <= n) coverable = false;
        for (const [nx, ny] of [[hx - 1, hy], [hx + 1, hy], [hx, hy - 1], [hx, hy + 1]]) {
          if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
          const nk = at(nx, ny);
          if (done[nk] || outside[nk] || blob[ny * width + nx]) continue;
          done[nk] = 1;
          stack.push(nx, ny);
        }
      }
      if (coverable) for (const i of hole) blob[i] = 1;
    }
  }
  // Reach a pixel or two under the pieces on top, never out over the background or pieces below.
  let grown = blob;
  for (let step = 0; step < reach; step++) {
    const from = grown;
    grown = from.slice();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        if (!from[i]) continue;
        for (const j of sides(i, width, from.length)) {
          if (j >= 0 && !from[j] && mask[j] && order[j] > n && j % width >= x0 && j % width <= x1) grown[j] = 1;
        }
      }
    }
  }
  return { blob: grown, x0, y0, x1, y1 };
}

/* ---------- Curve fitting ---------- */

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const addv = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const norm = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
const sq = (a) => a.x * a.x + a.y * a.y;

function bezierAt(b, t) {
  const m = 1 - t;
  const k0 = m * m * m, k1 = 3 * m * m * t, k2 = 3 * m * t * t, k3 = t * t * t;
  return { x: k0 * b[0].x + k1 * b[1].x + k2 * b[2].x + k3 * b[3].x, y: k0 * b[0].y + k1 * b[1].y + k2 * b[2].y + k3 * b[3].y };
}
function bezierD1(b, t) {
  const m = 1 - t;
  const d = [sub(b[1], b[0]), sub(b[2], b[1]), sub(b[3], b[2])];
  return { x: 3 * (m * m * d[0].x + 2 * m * t * d[1].x + t * t * d[2].x), y: 3 * (m * m * d[0].y + 2 * m * t * d[1].y + t * t * d[2].y) };
}
function bezierD2(b, t) {
  const e0 = addv(sub(b[2], mul(b[1], 2)), b[0]), e1 = addv(sub(b[3], mul(b[2], 2)), b[1]);
  return { x: 6 * ((1 - t) * e0.x + t * e1.x), y: 6 * ((1 - t) * e0.y + t * e1.y) };
}

function chordParams(points) {
  const u = [0];
  for (let i = 1; i < points.length; i++) u.push(u[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

// The curve from the first point to the last, leaving and arriving along the
// given directions, that passes closest to all the points (least squares).
function bestCurve(points, u, tan1, tan2) {
  const p0 = points[0], p3 = points[points.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < points.length; i++) {
    const t = u[i], m = 1 - t;
    const a0 = mul(tan1, 3 * t * m * m), a1 = mul(tan2, 3 * t * t * m);
    c00 += dot(a0, a0); c01 += dot(a0, a1); c11 += dot(a1, a1);
    const k = m * m * m + 3 * t * m * m, j = 3 * t * t * m + t * t * t;
    const tmp = sub(points[i], addv(mul(p0, k), mul(p3, j)));
    x0 += dot(a0, tmp); x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const span = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  let aL = det ? (x0 * c11 - x1 * c01) / det : 0, aR = det ? (c00 * x1 - c01 * x0) / det : 0;
  // Handles that point backwards or reach far past the curve are guesses gone wrong.
  if (!(aL > span * 1e-6) || !(aR > span * 1e-6) || aL > span * 2 || aR > span * 2) aL = aR = span / 3;
  return [p0, addv(p0, mul(tan1, aL)), addv(p3, mul(tan2, aR)), p3];
}

function worstPoint(points, b, u) {
  let worst = 0, at = Math.floor(points.length / 2);
  for (let i = 1; i < points.length - 1; i++) {
    const d = sq(sub(bezierAt(b, u[i]), points[i]));
    if (d >= worst) { worst = d; at = i; }
  }
  return [worst, at];
}

function reparameterise(b, points, u) {
  return u.map((t, i) => {
    const q = sub(bezierAt(b, t), points[i]), d1 = bezierD1(b, t), d2 = bezierD2(b, t);
    const den = dot(d1, d1) + dot(q, d2);
    const next = den ? t - dot(q, d1) / den : t;
    return Math.min(1, Math.max(0, next));
  });
}

// Fits points with as few curves as stay within `error` of them (Schneider's method).
function fitCurves(points, tan1, tan2, error2, out, depth = 0) {
  if (points.length === 2 || depth > 24) {
    const p0 = points[0], p3 = points[points.length - 1];
    const d = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
    out.push([p0, addv(p0, mul(tan1, d)), addv(p3, mul(tan2, d)), p3]);
    return;
  }
  let u = chordParams(points);
  let b = bestCurve(points, u, tan1, tan2);
  let [worst, at] = worstPoint(points, b, u);
  if (worst <= error2) { out.push(b); return; }
  if (worst <= error2 * 16) {
    for (let k = 0; k < 6; k++) {
      u = reparameterise(b, points, u);
      b = bestCurve(points, u, tan1, tan2);
      [worst, at] = worstPoint(points, b, u);
      if (worst <= error2) { out.push(b); return; }
    }
  }
  at = Math.min(points.length - 2, Math.max(1, at));
  const centre = norm(sub(points[at - 1], points[at + 1]));
  fitCurves(points.slice(0, at + 1), tan1, centre, error2, out, depth + 1);
  fitCurves(points.slice(at), mul(centre, -1), tan2, error2, out, depth + 1);
}

// The direction the outline turns through at point i, looking k points each way.
function turnAt(loop, i, k) {
  const n = loop.length;
  const a = loop[(i - k + n) % n], p = loop[i], b = loop[(i + k) % n];
  const t1 = Math.atan2(p.y - a.y, p.x - a.x), t2 = Math.atan2(b.y - p.y, b.x - p.x);
  return Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
}

const CORNER_TURN = (68 * Math.PI) / 180;
const WIDE = 5, NEAR = 3;

// Real corners turn sharply over a short stretch. Round bits turn just as much,
// but spread out, and pixel steps turn back and forth but go nowhere.
function findCorners(loop) {
  const n = loop.length;
  if (n < 12) return [];
  const wide = loop.map((_, i) => turnAt(loop, i, WIDE));
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (wide[i] < CORNER_TURN) continue;
    let peak = true;
    for (let k = -3; k <= 3 && peak; k++) if (k && wide[(i + k + n) % n] > wide[i]) peak = false;
    if (!peak) continue;
    if (turnAt(loop, i, NEAR) < wide[i] * 0.72) continue;
    if (corners.length && i - corners[corners.length - 1] < 4) continue;
    corners.push(i);
  }
  if (corners.length > 1 && corners[0] + n - corners[corners.length - 1] < 4) corners.pop();
  return corners;
}

// Evens out the pixel steps, keeping the two ends where they are.
function smoothRun(points, passes) {
  let pts = points;
  for (let pass = 0; pass < passes; pass++) {
    pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p
      : { x: (pts[i - 1].x + 2 * p.x + pts[i + 1].x) / 4, y: (pts[i - 1].y + 2 * p.y + pts[i + 1].y) / 4 }));
  }
  return pts;
}

// Which way the outline leaves a corner, measured a little way along it, so the
// corner's own pixel steps don't tilt it.
const TANGENT_SKIP = 2, TANGENT_REACH = 6;
function startTangent(pts) {
  const n = pts.length;
  if (n < TANGENT_SKIP + 3) return norm(sub(pts[n - 1], pts[0]));
  const reach = Math.max(2, Math.min(TANGENT_REACH, Math.floor((n - 1) / 3)));
  const from = Math.min(TANGENT_SKIP, Math.floor(n / 4));
  return norm(sub(pts[Math.min(n - 1, from + reach)], pts[from]));
}
const endTangent = (pts) => startTangent([...pts].reverse());

// Where a corner really is: where the two sides running into it would meet. Pixel
// edges bevel corners, so the traced point is often a pixel or so short of it.
const CORNER_REACH = 8, CORNER_SKIP = 2, CORNER_MOVE = 2.5;
function trueCorner(loop, c) {
  const n = loop.length, at = (k) => loop[((c + k) % n + n) % n];
  const a1 = at(-CORNER_REACH), a2 = at(-CORNER_SKIP), b1 = at(CORNER_SKIP), b2 = at(CORNER_REACH);
  const d1 = sub(a2, a1), d2 = sub(b2, b1);
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-6) return loop[c];
  const t = ((b1.x - a1.x) * d2.y - (b1.y - a1.y) * d2.x) / det;
  const p = addv(a1, mul(d1, t));
  return Math.hypot(p.x - loop[c].x, p.y - loop[c].y) <= CORNER_MOVE ? p : loop[c];
}

// A traced pixel outline as smooth curves: one subpath, with sharp corners.
// enlarged: how much the picture was blown up to trace it. Its edges are softer
// steps, so they get smoothed more.
export function loopToCurves(loop, error = FIT_ERROR, enlarged = 1) {
  const passes = SMOOTH_PASSES + Math.max(0, Math.round((enlarged - 1) * 2));
  error *= Math.sqrt(Math.max(1, enlarged));
  const n = loop.length;
  const corners = findCorners(loop);
  const curves = [];
  const e2 = error * error;
  if (!corners.length) {
    // All smooth: start anywhere and come back round to it smoothly.
    const ring = [...loop, loop[0]];
    let pts = ring;
    for (let pass = 0; pass < passes; pass++) {
      pts = pts.slice(0, -1).map((p, i, a) => {
        const prev = a[(i - 1 + a.length) % a.length], next = a[(i + 1) % a.length];
        return { x: (prev.x + 2 * p.x + next.x) / 4, y: (prev.y + 2 * p.y + next.y) / 4 };
      });
      pts.push(pts[0]);
    }
    const tan = norm(sub(pts[1], pts[pts.length - 2]));
    fitCurves(pts, tan, mul(tan, -1), e2, curves);
  } else {
    const placed = corners.map((c) => trueCorner(loop, c));
    corners.forEach((c, k) => {
      const next = corners[(k + 1) % corners.length];
      let run = [];
      for (let i = c; ; i = (i + 1) % n) {
        run.push(loop[i]);
        if (i === next && run.length > 1) break;
      }
      // The run goes from corner to corner; the bevel pixels beside each are left out.
      if (run.length > CORNER_SKIP * 2 + 4) run = [run[0], ...run.slice(CORNER_SKIP + 1, -CORNER_SKIP - 1), run[run.length - 1]];
      run[0] = placed[k];
      run[run.length - 1] = placed[(k + 1) % corners.length];
      const pts = smoothRun(run, passes);
      fitCurves(pts, startTangent(run), endTangent(run), e2, curves);
    });
  }
  const r = (v) => Math.round(v * 100) / 100;
  const nodes = curves.map((b) => ({ x: r(b[0].x), y: r(b[0].y) }));
  curves.forEach((b, i) => {
    const a = nodes[i], z = nodes[(i + 1) % nodes.length];
    const ox = r(b[1].x - b[0].x), oy = r(b[1].y - b[0].y), ix = r(b[2].x - b[3].x), iy = r(b[2].y - b[3].y);
    // A straight stretch stays a plain line.
    const chord = Math.hypot(b[3].x - b[0].x, b[3].y - b[0].y) || 1;
    const off = (p) => Math.abs((p.x - b[0].x) * (b[3].y - b[0].y) - (p.y - b[0].y) * (b[3].x - b[0].x)) / chord;
    const line = off(b[1]) < STRAIGHT && off(b[2]) < STRAIGHT;
    if (!line) {
      if (ox || oy) { a.ox = ox; a.oy = oy; }
      if (ix || iy) { z.ix = ix; z.iy = iy; }
    }
  });
  return { closed: true, nodes };
}

/* ---------- The whole picture ---------- */

const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

export function pixelsToPieces(rgba, width, height, enlarged = 1) {
  const size = width * height;
  const mask = cleanMask(subjectMask(rgba, width, height), width, height);
  const centres = findColours(rgba, mask);
  if (!centres.length) throw new Error('Could not find any pieces in this picture.');
  // Each pixel's colour group. Flat art repeats a few colours, so remember each answer.
  const labels = new Int16Array(size).fill(-1);
  const memo = new Map();
  for (let i = 0; i < size; i++) {
    if (!mask[i]) continue;
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let label = memo.get(key);
    if (label === undefined) {
      label = nearest(centres, toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]));
      if (memo.size < 200000) memo.set(key, label);
    }
    labels[i] = label;
  }
  // Each colour group's average RGB, for spotting blends.
  const sums = centres.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < size; i++) {
    if (labels[i] < 0) continue;
    const s = sums[labels[i]];
    s[0] += rgba[i * 4]; s[1] += rgba[i * 4 + 1]; s[2] += rgba[i * 4 + 2]; s[3]++;
  }
  const rgbs = sums.map((s) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [0, 0, 0]));
  absorbSmall(labels, width, Math.max(10, size * MIN_PIECE_SHARE), centres, rgba, rgbs);

  // Each patch's colour is the average of its pixels that really are that colour,
  // so blend pixels at its edge don't muddy it.
  const { patches } = findPatches(labels, width);
  patches.sort((a, b) => b.pixels.length - a.pixels.length);
  const shown = patches.slice(0, MAX_PIECES);
  const order = new Int32Array(size).fill(-1);
  shown.forEach((p, n) => { for (const i of p.pixels) order[i] = n; });
  const pieces = [];
  shown.forEach((p, n) => {
    const centre = centres[p.label];
    const sum = [0, 0, 0, 0], all = [0, 0, 0, 0];
    for (const i of p.pixels) {
      const rgb = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
      all[0] += rgb[0]; all[1] += rgb[1]; all[2] += rgb[2]; all[3]++;
      if (dist2(toLab(...rgb), centre) < SAME_LOOK ** 2) { sum[0] += rgb[0]; sum[1] += rgb[1]; sum[2] += rgb[2]; sum[3]++; }
    }
    const pick = sum[3] > all[3] * 0.2 ? sum : all;
    const colour = hex([pick[0] / pick[3], pick[1] / pick[3], pick[2] / pick[3]]);
    // Traced within the piece's own box, to be quick.
    const { blob, x0, y0, x1, y1 } = stackedBlob(n, p.pixels, order, mask, width, height, enlarged > 1.4 ? 2 : 1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const local = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) local[y * bw + x] = blob[(y + y0) * width + x + x0];
    const loops = traceLoops(local, bw, bh, { minArea: 4, raw: true })
      .map((loop) => loop.map((q) => ({ x: q.x + x0, y: q.y + y0 })));
    if (!loops.length) return;
    pieces.push({
      kind: 'path', subpaths: loops.map((l) => loopToCurves(l, FIT_ERROR, enlarged)), fillRule: 'evenodd',
      fill: { color: colour }, stroke: { color: 'none' }, strokeWidth: 0, opacity: 1, look: {}, clips: [],
    });
  });
  if (!pieces.length) throw new Error('Could not find any pieces in this picture.');
  return { box: { x: 0, y: 0, width, height }, pieces };
}

async function readPixels(src, maxSize) {
  const img = new Image();
  img.src = src;
  await img.decode();
  // Small pictures are enlarged (smoothly), so their edges trace as curves, not steps.
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.max(maxSize, Math.min(TRACE_MAX, longest)) / longest;
  const width = Math.max(8, Math.round(img.naturalWidth * scale));
  const height = Math.max(8, Math.round(img.naturalHeight * scale));
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height, enlarged: scale };
}

export async function imageToPieces(src) {
  const { data, width, height, enlarged } = await readPixels(src, TRACE_PX);
  return pixelsToPieces(data, width, height, enlarged);
}
