// Turns a picture into a vector shape that follows its real outline.
import { traceLoops, dilate } from './bucket.js';
import { fitSubpaths, pathBounds } from './model.js';

const MAX_TRACE_PX = 700;
const BACKGROUND_TOLERANCE = 40;
const CORNER_DEGREES = 35;
const MIN_COVERAGE = 0.0005;
const MAX_COVERAGE = 0.985;

function borderColor(rgba, width, height) {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  return [0, 1, 2].map((c) => corners.reduce((sum, i) => sum + rgba[i * 4 + c], 0) / 4);
}

// Marks the subject. Uses transparency when the picture has it. Otherwise the
// background is whatever matches the edges and can be reached from them.
export function subjectMask(rgba, width, height) {
  const total = width * height;
  let clear = 0;
  for (let i = 0; i < total; i++) if (rgba[i * 4 + 3] < 128) clear++;
  const mask = new Uint8Array(total);
  if (clear / total > 0.01) {
    for (let i = 0; i < total; i++) mask[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
    return mask;
  }
  const [r, g, b] = borderColor(rgba, width, height);
  const isBackground = (i) => {
    const p = i * 4;
    return Math.abs(rgba[p] - r) <= BACKGROUND_TOLERANCE && Math.abs(rgba[p + 1] - g) <= BACKGROUND_TOLERANCE
      && Math.abs(rgba[p + 2] - b) <= BACKGROUND_TOLERANCE;
  };
  const outside = new Uint8Array(total);
  const stack = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const i = stack.pop();
    if (outside[i] || !isBackground(i)) continue;
    outside[i] = 1;
    const x = i % width, y = (i - x) / width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - width);
    if (y < height - 1) stack.push(i + width);
  }
  for (let i = 0; i < total; i++) mask[i] = outside[i] ? 0 : 1;
  return mask;
}

// Evens out single-pixel noise along the edge.
export function cleanMask(mask, width, height) {
  const out = mask.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) count += mask[(y + dy) * width + x + dx];
      out[y * width + x] = count >= 5 ? 1 : 0;
    }
  }
  return out;
}

// Curves the outline, but keeps sharp points sharp: a pencil keeps its tip.
export function loopToSubpath(points) {
  const sp = { closed: true, nodes: points.map((p) => ({ x: p.x, y: p.y })) };
  const N = sp.nodes.length;
  const limit = (CORNER_DEGREES * Math.PI) / 180;
  sp.nodes.forEach((n, i) => {
    const a = sp.nodes[(i - 1 + N) % N], b = sp.nodes[(i + 1) % N];
    const inAngle = Math.atan2(n.y - a.y, n.x - a.x), outAngle = Math.atan2(b.y - n.y, b.x - n.x);
    const turn = Math.abs(Math.atan2(Math.sin(outAngle - inAngle), Math.cos(outAngle - inAngle)));
    if (turn >= limit) return;
    // Each handle follows its own edge's length, so a short edge beside a long
    // straight one cannot make the curve overshoot the outline.
    const across = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / across, ty = (b.y - a.y) / across;
    const before = Math.hypot(n.x - a.x, n.y - a.y) / 3, after = Math.hypot(b.x - n.x, b.y - n.y) / 3;
    n.ix = -tx * before; n.iy = -ty * before;
    n.ox = tx * after; n.oy = ty * after;
  });
  return sp;
}

export function maskToShape(mask, width, height) {
  const covered = mask.reduce((sum, v) => sum + v, 0) / (width * height);
  if (covered < MIN_COVERAGE || covered > MAX_COVERAGE) {
    throw new Error('Could not find a shape. Pictures with a plain background work best.');
  }
  const loops = traceLoops(mask, width, height, { tolerance: 1.3, minArea: width * height * 0.0003 });
  if (!loops.length) throw new Error('Could not find a shape. Pictures with a plain background work best.');
  const subpaths = loops.map(loopToSubpath);
  const b = pathBounds(subpaths);
  const scale = 100 / Math.max(b.width, b.height);
  return { subpaths: fitSubpaths(subpaths, b.width * scale, b.height * scale), fillRule: 'evenodd', lineOnly: false };
}

async function readPixels(src, maxSize) {
  const img = new Image();
  img.src = src;
  await img.decode();
  // Small pictures are enlarged too, so their edges trace smoothly.
  const scale = maxSize / Math.max(img.naturalWidth, img.naturalHeight);
  const width = Math.max(8, Math.round(img.naturalWidth * scale));
  const height = Math.max(8, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

export async function imageToShape(src) {
  const { data, width, height } = await readPixels(src, MAX_TRACE_PX);
  return maskToShape(cleanMask(subjectMask(data, width, height), width, height), width, height);
}

/* ---------- Splitting a picture into colour pieces ---------- */

const MAX_PIECE_TRACE_PX = 480;
const PALETTE_SIZE = 14;
const PALETTE_ROUNDS = 8;
const SAME_COLOUR = 30;
const MIN_PIECE_SHARE = 0.0004;
const MAX_PIECES = 160;

const closest = (palette, r, g, b) => {
  let best = 0, bestDist = Infinity;
  palette.forEach((c, i) => {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
};

// Finds the main colours by repeatedly averaging the pixels nearest each guess.
export function findPalette(rgba, mask, size = PALETTE_SIZE) {
  const pixels = [];
  const stride = Math.max(1, Math.floor(mask.length / 40000));
  for (let i = 0; i < mask.length; i += stride) {
    if (mask[i]) pixels.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
  }
  if (!pixels.length) return [];
  let palette = [pixels[0]];
  while (palette.length < size) {
    let far = null, farDist = 0;
    for (const p of pixels) {
      const d = Math.min(...palette.map((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2));
      if (d > farDist) { farDist = d; far = p; }
    }
    if (!far || farDist < SAME_COLOUR ** 2) break;
    palette.push(far);
  }
  for (let round = 0; round < PALETTE_ROUNDS; round++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const p of pixels) {
      const s = sums[closest(palette, p[0], p[1], p[2])];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    palette = sums.filter((s) => s[3]).map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]]);
  }
  return palette;
}

// labels: the palette colour of each pixel, or -1 for no art. Returns connected
// blobs of one colour.
function findRegions(labels, width, height) {
  const seen = new Uint8Array(labels.length);
  const regions = [];
  for (let start = 0; start < labels.length; start++) {
    if (seen[start] || labels[start] < 0) continue;
    const label = labels[start], pixels = [], stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      pixels.push(i);
      const x = i % width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j >= 0 && j < labels.length && !seen[j] && labels[j] === label) { seen[j] = 1; stack.push(j); }
      }
    }
    regions.push({ label, pixels });
  }
  return regions.sort((a, b) => b.pixels.length - a.pixels.length);
}

// Specks, like the soft edges between two colours, join the colour beside them.
function absorbSpecks(labels, width, regions, minSize) {
  for (const region of [...regions].reverse()) {
    if (region.pixels.length >= minSize) continue;
    const votes = new Map();
    for (const i of region.pixels) {
      const x = i % width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        const label = labels[j];
        if (j >= 0 && label !== undefined && label >= 0 && label !== region.label) votes.set(label, (votes.get(label) || 0) + 1);
      }
    }
    if (!votes.size) continue;
    const winner = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    for (const i of region.pixels) labels[i] = winner;
  }
}

const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function pixelsToPieces(rgba, width, height) {
  const mask = cleanMask(subjectMask(rgba, width, height), width, height);
  const palette = findPalette(rgba, mask);
  if (!palette.length) throw new Error('Could not find any pieces in this picture.');
  const labels = new Int16Array(width * height).fill(-1);
  for (let i = 0; i < labels.length; i++) {
    if (mask[i]) labels[i] = closest(palette, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }
  const minSize = Math.max(12, width * height * MIN_PIECE_SHARE);
  for (let pass = 0; pass < 3; pass++) absorbSpecks(labels, width, findRegions(labels, width, height), minSize);
  const regions = findRegions(labels, width, height).slice(0, MAX_PIECES);
  const pieces = [];
  for (const { label, pixels } of regions) {
    const blob = new Uint8Array(width * height);
    for (const i of pixels) blob[i] = 1;
    // Each piece reaches slightly under its neighbours, so no gaps show between them.
    const loops = traceLoops(dilate(blob, width, height), width, height, { tolerance: 0.9, minArea: 4 });
    if (!loops.length) continue;
    pieces.push({
      kind: 'path', subpaths: loops.map(loopToSubpath), fillRule: 'evenodd',
      fill: { color: hex(palette[label]) }, stroke: { color: 'none' }, strokeWidth: 0, opacity: 1, look: {}, clips: [],
    });
  }
  if (!pieces.length) throw new Error('Could not find any pieces in this picture.');
  return { box: { x: 0, y: 0, width, height }, pieces };
}

export async function imageToPieces(src) {
  const { data, width, height } = await readPixels(src, MAX_PIECE_TRACE_PX);
  return pixelsToPieces(data, width, height);
}
