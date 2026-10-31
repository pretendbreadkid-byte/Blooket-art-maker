// Turns a picture into a vector shape that follows its real outline.
import { traceLoops } from './bucket.js';
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

export async function imageToShape(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  // Small pictures are enlarged too, so their edges trace smoothly.
  const scale = MAX_TRACE_PX / Math.max(img.naturalWidth, img.naturalHeight);
  const width = Math.max(8, Math.round(img.naturalWidth * scale));
  const height = Math.max(8, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return maskToShape(cleanMask(subjectMask(data, width, height), width, height), width, height);
}
