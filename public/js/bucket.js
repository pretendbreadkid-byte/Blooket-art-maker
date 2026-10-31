// Paint bucket: finds the enclosed area under a click and traces it into a
// vector outline, so fills stay part of the SVG instead of becoming pixels.
import { simplify } from './model.js';

export function floodRegion(rgba, width, height, startX, startY, tolerance = 28) {
  const mask = new Uint8Array(width * height);
  const seed = (startY * width + startX) * 4;
  const r = rgba[seed], g = rgba[seed + 1], b = rgba[seed + 2], a = rgba[seed + 3];
  const matches = (i) => {
    const p = i * 4;
    return Math.abs(rgba[p] - r) <= tolerance && Math.abs(rgba[p + 1] - g) <= tolerance
      && Math.abs(rgba[p + 2] - b) <= tolerance && Math.abs(rgba[p + 3] - a) <= tolerance;
  };
  const stack = [startY * width + startX];
  let area = 0;
  while (stack.length) {
    const i = stack.pop();
    if (mask[i] || !matches(i)) continue;
    mask[i] = 1;
    area++;
    const x = i % width, y = (i - x) / width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - width);
    if (y < height - 1) stack.push(i + width);
  }
  return { mask, area };
}

// Grows the region by a pixel so it tucks under anti-aliased line edges.
export function dilate(mask, width, height) {
  const out = mask.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      if (x > 0) out[i - 1] = 1;
      if (x < width - 1) out[i + 1] = 1;
      if (y > 0) out[i - width] = 1;
      if (y < height - 1) out[i + width] = 1;
    }
  }
  return out;
}

function loopArea(loop) {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Walks the edges between filled and empty pixels. Gives one loop per outline,
// including the outlines of any holes.
export function traceLoops(mask, width, height, { tolerance = 1.1, minArea = 6 } = {}) {
  const key = (x, y) => y * (width + 1) + x;
  const edges = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([x1, y1]);
  };
  const filled = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) add(x, y, x + 1, y);
      if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const [startKey, list] of edges) {
    while (list.length) {
      const startX = startKey % (width + 1), startY = (startKey - startX) / (width + 1);
      const loop = [{ x: startX, y: startY }];
      let [x, y] = list.pop();
      while (x !== startX || y !== startY) {
        loop.push({ x, y });
        [x, y] = edges.get(key(x, y)).pop();
      }
      if (loopArea(loop) < minArea) continue;
      // Split the closed loop in two so the simplifier has fixed end points.
      const mid = loop.length >> 1;
      const half1 = simplify(loop.slice(0, mid + 1), tolerance);
      const half2 = simplify([...loop.slice(mid), loop[0]], tolerance);
      const points = [...half1.slice(0, -1), ...half2.slice(0, -1)];
      if (points.length >= 3) loops.push(points);
    }
  }
  return loops;
}
