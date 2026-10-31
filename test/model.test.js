import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newDoc, newPath, parseD, pathD, pathBounds, fitSubpaths, sample, setProps, addKey, removeKey, moveKey,
  splitSegment, strokeToSubpath, localToWorld, worldToLocal,
} from '../public/js/model.js';
import { exportSVG } from '../public/js/render.js';
import { floodRegion, dilate, traceLoops } from '../public/js/bucket.js';

const square = () => parseD('M0 0H100V100H0Z');
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not close to ${b}`);

test('parseD reads straight paths and drops the repeated closing point', () => {
  const [sp] = parseD('M0 0L10 0L10 10L0 0Z');
  assert.equal(sp.closed, true);
  assert.equal(sp.nodes.length, 3);
});

test('parseD handles relative commands, glued numbers and arc flags', () => {
  assert.deepEqual(pathBounds(parseD('m10 10h20v20h-20z')), { x: 10, y: 10, width: 20, height: 20 });
  const arc = pathBounds(parseD('M0 0a10 10 0 010 20'));
  near(arc.height, 20, 0.2);
  near(arc.width, 10, 0.2);
});

test('parseD turns curves into nodes with handles', () => {
  const [sp] = parseD('M0 0Q50 100 100 0');
  assert.equal(sp.nodes.length, 2);
  assert.ok(sp.nodes[0].ox || sp.nodes[0].oy);
  assert.ok(sp.nodes[1].ix || sp.nodes[1].iy);
});

test('parseD rejects junk', () => {
  assert.throws(() => parseD('M0 0 potato'));
});

test('rounding a corner writes an arc', () => {
  const subs = square();
  assert.ok(!pathD(subs).includes('A'));
  subs[0].nodes[0].r = 10;
  const d = pathD(subs);
  assert.ok(d.includes('A10 10'), d);
  assert.ok(d.startsWith('M10 0'), d);
});

test('a huge radius is limited to half the shortest edge', () => {
  const subs = square();
  subs[0].nodes.forEach((n) => { n.r = 9999; });
  assert.ok(pathD(subs).includes('A50 50'), pathD(subs));
});

test('rounding bends the right way on both turn directions', () => {
  const clockwise = parseD('M0 0H100V100H0Z');
  const anticlockwise = parseD('M0 0V100H100V0Z');
  clockwise[0].nodes[1].r = 10;
  anticlockwise[0].nodes[1].r = 10;
  assert.ok(/A10 10 0 0 1/.test(pathD(clockwise)));
  assert.ok(/A10 10 0 0 0/.test(pathD(anticlockwise)));
});

test('splitting a curve keeps its shape', () => {
  const sp = parseD('M0 0C0 100 100 100 100 0')[0];
  const before = pathBounds([sp]);
  const copy = { closed: false, nodes: sp.nodes.map((n) => ({ ...n })) };
  assert.equal(splitSegment(copy, 0), 1);
  assert.equal(copy.nodes.length, 3);
  const after = pathBounds([copy]);
  near(after.height, before.height, 0.5);
  near(copy.nodes[1].x, 50, 0.01);
});

test('fitSubpaths centres on zero at the size asked for', () => {
  const b = pathBounds(fitSubpaths(square(), 40, 20));
  assert.deepEqual([b.x, b.y, b.width, b.height], [-20, -10, 40, 20]);
});

test('a single click still makes a visible dot', () => {
  const sp = strokeToSubpath([{ x: 5, y: 5 }]);
  assert.equal(sp.nodes.length, 2);
});

test('world and local coordinates are inverses', () => {
  const o = { x: 30, y: -10, rotation: 37, scaleX: 2, scaleY: -0.5 };
  const w = localToWorld(o, 12, 34);
  const l = worldToLocal(o, w.x, w.y);
  near(l.x, 12);
  near(l.y, 34);
});

function animatedSetup() {
  const doc = newDoc({ name: 't', animated: true, width: 100, height: 100 });
  const obj = newPath({ subpaths: square(), fill: '#000000' });
  doc.layers[0].objects.push(obj);
  return { doc, obj };
}

test('editing on frame 0 before any keys just edits the object', () => {
  const { doc, obj } = animatedSetup();
  setProps(doc, obj, 0, { x: 50 });
  assert.equal(obj.x, 50);
  assert.equal(obj.keys.length, 0);
});

test('moving on a later frame adds keys and tweens between them', () => {
  const { doc, obj } = animatedSetup();
  obj.keys = [];
  setProps(doc, obj, 10, { x: 100, fill: '#ffffff' });
  assert.deepEqual(obj.keys.map((k) => k.f), [0, 10]);
  assert.equal(sample(obj, 0).x, 0);
  assert.equal(sample(obj, 10).x, 100);
  obj.keys[0].ease = 'linear';
  assert.equal(sample(obj, 5).x, 50);
  assert.equal(sample(obj, 5).fill, '#808080');
  assert.equal(sample(obj, 40).x, 100);
});

test('a hold key jumps instead of sliding', () => {
  const { doc, obj } = animatedSetup();
  setProps(doc, obj, 10, { x: 100 });
  obj.keys[0].ease = 'hold';
  assert.equal(sample(obj, 9).x, 0);
  assert.equal(sample(obj, 10).x, 100);
});

test('vertices morph between keys when the point counts match', () => {
  const { doc, obj } = animatedSetup();
  const moved = square();
  moved[0].nodes[0].x = -100;
  setProps(doc, obj, 10, { subpaths: moved });
  obj.keys[0].ease = 'linear';
  near(sample(obj, 5).subpaths[0].nodes[0].x, -50);
});

test('non-animated projects never get keys', () => {
  const doc = newDoc({ name: 't' });
  const obj = newPath({ subpaths: square() });
  setProps(doc, obj, 5, { x: 9 });
  assert.equal(obj.x, 9);
  assert.equal(obj.keys.length, 0);
});

test('keys can be moved and removed, and the last removal keeps the pose', () => {
  const { doc, obj } = animatedSetup();
  setProps(doc, obj, 10, { x: 100 });
  addKey(obj, 20, { x: 200 });
  assert.equal(moveKey(obj, 10, 20), false);
  assert.equal(moveKey(obj, 10, 15), true);
  assert.deepEqual(obj.keys.map((k) => k.f), [0, 15, 20]);
  removeKey(obj, 0);
  removeKey(obj, 15);
  removeKey(obj, 20);
  assert.equal(obj.keys.length, 0);
  assert.equal(obj.x, 200);
});

test('static export is plain SVG with escaped names and no hidden layers', () => {
  const doc = newDoc({ name: 'Cats & <dogs>', width: 200, height: 100 });
  doc.layers[0].objects.push(newPath({ subpaths: square(), fill: '#123456' }));
  let svg = exportSVG(doc);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"'));
  assert.ok(svg.includes('Cats &amp; &lt;dogs&gt;'));
  assert.ok(svg.includes('#123456'));
  assert.ok(!svg.includes('data-id'));
  doc.layers[0].visible = false;
  svg = exportSVG(doc);
  assert.ok(!svg.includes('#123456'));
});

test('animated export loops over the whole timeline', () => {
  const { doc, obj } = animatedSetup();
  doc.frames = 24;
  doc.fps = 12;
  setProps(doc, obj, 12, { x: 80 });
  const svg = exportSVG(doc, { animate: true });
  assert.ok(svg.includes('<animateTransform'));
  assert.ok(svg.includes('dur="2s"'));
  assert.ok(svg.includes('repeatCount="indefinite"'));
  const values = svg.match(/type="translate" additive="sum" values="([^"]+)"/)[1].split(';');
  assert.equal(values.length, 25);
});

test('a frame export has no animation tags', () => {
  const { doc, obj } = animatedSetup();
  setProps(doc, obj, 12, { x: 80 });
  assert.ok(!exportSVG(doc, { frame: 12 }).includes('<animate'));
});

test('erasing writes a mask onto the object', () => {
  const doc = newDoc({ name: 't' });
  const obj = newPath({ subpaths: square(), fill: '#000000' });
  obj.erase.push({ path: { closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }, width: 5 });
  doc.layers[0].objects.push(obj);
  const svg = exportSVG(doc);
  assert.ok(svg.includes('<mask'));
  assert.ok(svg.includes(`mask="url(#erase-${obj.id})"`));
});

function grid(width, height, wall) {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!wall(x, y)) continue;
      const p = (y * width + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = 0;
    }
  }
  return rgba;
}

test('the bucket stops at walls', () => {
  const box = (x, y) => (x === 5 || x === 15) ? y >= 5 && y <= 15 : (y === 5 || y === 15) && x >= 5 && x <= 15;
  const rgba = grid(20, 20, box);
  const inside = floodRegion(rgba, 20, 20, 10, 10);
  assert.equal(inside.area, 9 * 9);
  const outside = floodRegion(rgba, 20, 20, 0, 0);
  assert.equal(outside.area, 400 - 11 * 11);
});

test('tracing finds one loop for a solid area and two for a ring', () => {
  const width = 20, height = 20;
  const solid = new Uint8Array(width * height);
  for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) solid[y * width + x] = 1;
  assert.equal(traceLoops(solid, width, height).length, 1);
  const ring = solid.slice();
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) ring[y * width + x] = 0;
  assert.equal(traceLoops(ring, width, height).length, 2);
});

test('dilate grows a region by one pixel', () => {
  const mask = new Uint8Array(25);
  mask[12] = 1;
  assert.equal(dilate(mask, 5, 5).reduce((a, b) => a + b, 0), 5);
});
