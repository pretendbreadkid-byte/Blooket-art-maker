import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newDoc, newPath, parseD, pathD, sample, setProps, addVertex, removeVertices, matchSubpaths, pointInPolygon,
} from '../public/js/model.js';
import { exportSVG } from '../public/js/render.js';
import { subjectMask, cleanMask, maskToShape, loopToSubpath } from '../public/js/trace.js';
import { jpegToPdf } from '../public/js/export.js';

const square = () => parseD('M0 0H100V100H0Z');

function animated() {
  const doc = newDoc({ name: 't', animated: true, width: 200, height: 200 });
  const obj = newPath({ subpaths: square(), fill: '#000000' });
  doc.layers[0].objects.push(obj);
  return { doc, obj };
}

function warpFromSquare() {
  const { doc, obj } = animated();
  setProps(doc, obj, 20, { x: 0 });
  const index = addVertex(obj, 0, 0);
  const pulled = sample(obj, 20).subpaths.map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => ({ ...n })) }));
  pulled[0].nodes[index].y = -100;
  setProps(doc, obj, 20, { subpaths: pulled });
  obj.keys[0].ease = 'linear';
  return { doc, obj, index };
}

test('a new point warps in slowly instead of popping at the keyframe', () => {
  const { obj, index } = warpFromSquare();
  const heights = [0, 5, 10, 15, 20].map((f) => sample(obj, f).subpaths[0].nodes[index].y);
  assert.deepEqual(heights, [0, -25, -50, -75, -100]);
});

test('adding a point keeps the same count on every keyframe', () => {
  const { obj } = warpFromSquare();
  assert.deepEqual(obj.keys.map((k) => k.pose.subpaths[0].nodes.length), [5, 5]);
  assert.equal(obj.subpaths[0].nodes.length, 5);
});

test('removing a point removes it on every keyframe', () => {
  const { obj, index } = warpFromSquare();
  removeVertices(obj, new Set([`0:${index}`]));
  assert.deepEqual(obj.keys.map((k) => k.pose.subpaths[0].nodes.length), [4, 4]);
});

test('outlines with different point counts still warp between keys', () => {
  const { obj } = animated();
  const triangle = parseD('M0 0L100 0L50 100Z');
  obj.keys = [
    { f: 0, ease: 'linear', pose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, gradient: null, subpaths: square() } },
    { f: 10, ease: 'linear', pose: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, gradient: null, subpaths: triangle } },
  ];
  const middle = sample(obj, 5).subpaths[0].nodes;
  assert.equal(middle.length, 4);
  assert.notDeepEqual(middle.map((n) => [n.x, n.y]), sample(obj, 0).subpaths[0].nodes.map((n) => [n.x, n.y]));
  const [a, b] = matchSubpaths(square(), triangle);
  assert.equal(a[0].nodes.length, b[0].nodes.length);
});

test('every exported frame of a warp uses the same path commands', () => {
  const { doc } = warpFromSquare();
  const svg = exportSVG(doc, { animate: true });
  const values = svg.match(/attributeName="d" values="([^"]+)"/)[1].split(';');
  assert.equal(values.length, doc.frames + 1);
  assert.equal(new Set(values.map((d) => d.replace(/[^A-Za-z]/g, ''))).size, 1);
  assert.ok(new Set(values).size > 10);
});

test('rounding warps too, with no arc commands in the animation', () => {
  const { doc, obj } = animated();
  const rounded = square();
  rounded[0].nodes[1].r = 30;
  setProps(doc, obj, 20, { subpaths: rounded });
  const svg = exportSVG(doc, { animate: true });
  const values = svg.match(/attributeName="d" values="([^"]+)"/)[1].split(';');
  assert.equal(new Set(values.map((d) => d.replace(/[^A-Za-z]/g, ''))).size, 1);
  assert.ok(!values[10].includes('A'));
});

test('uniform paths draw the same corners as normal paths', () => {
  const sp = square();
  sp[0].nodes[0].r = 10;
  assert.ok(pathD(sp).includes('A'));
  assert.ok(!pathD(sp, { uniform: true }).includes('A'));
  assert.ok(!pathD(sp, { uniform: true }).includes('L'));
});

test('gradients export at any angle and animate', () => {
  const { doc, obj } = animated();
  obj.gradient = { from: '#ff0000', to: '#0000ff', angle: 90 };
  let svg = exportSVG(doc);
  assert.ok(svg.includes('<linearGradient'));
  assert.ok(svg.includes('x1="0.5" y1="0" x2="0.5" y2="1"'), svg);
  assert.ok(svg.includes(`fill="url(#erase-${obj.id}-paint)"`));
  setProps(doc, obj, 20, { gradient: { from: '#ff0000', to: '#0000ff', angle: 270 } });
  svg = exportSVG(doc, { animate: true });
  assert.ok(svg.includes('attributeName="x1"'));
});

test('a rounded canvas clips everything, a square one adds nothing', () => {
  const { doc } = animated();
  assert.ok(!exportSVG(doc).includes('clip-path'));
  doc.cornerRadius = 40;
  const svg = exportSVG(doc);
  assert.ok(svg.includes('rx="40"'));
  assert.ok(svg.includes('clip-path="url(#frame-clip)"'));
});

test('a gradient background exports', () => {
  const { doc } = animated();
  doc.bgGradient = { from: '#111111', to: '#eeeeee', angle: 45 };
  assert.ok(exportSVG(doc).includes('fill="url(#frame-bg)"'));
});

test('the art-only box leaves out the background', () => {
  const { doc } = animated();
  const svg = exportSVG(doc, { box: { x: -5, y: -5, width: 50, height: 60 } });
  assert.ok(svg.includes('viewBox="-5 -5 50 60"'));
  assert.ok(!svg.includes('#ffffff'));
});

test('the lasso test finds points inside a loop', () => {
  const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
  assert.equal(pointInPolygon(5, 3, poly), true);
  assert.equal(pointInPolygon(0, 9, poly), false);
});

function paintPencil(width, height, background) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      // A long body with a point on the right: the outline a pencil has.
      const inBody = x >= 20 && x < 120 && y >= 40 && y < 60;
      const inTip = x >= 120 && x < 150 && Math.abs(y - 50) < (150 - x) / 3;
      const on = inBody || inTip;
      if (background === 'clear') {
        rgba.set(on ? [200, 90, 20, 255] : [0, 0, 0, 0], p);
      } else {
        rgba.set(on ? [200, 90, 20, 255] : [255, 255, 255, 255], p);
      }
    }
  }
  return rgba;
}

for (const background of ['white', 'clear']) {
  test(`tracing a pencil on a ${background} background follows its outline`, () => {
    const width = 170, height = 100;
    const mask = cleanMask(subjectMask(paintPencil(width, height, background), width, height), width, height);
    const shape = maskToShape(mask, width, height);
    assert.equal(shape.subpaths.length, 1);
    const nodes = shape.subpaths[0].nodes;
    const tipX = Math.max(...nodes.map((n) => n.x));
    const xs = nodes.map((n) => n.x);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 90);
    assert.ok(nodes.length < 16, `${nodes.length} points`);
    const tip = nodes.find((n) => n.x === tipX);
    assert.ok(!tip.ox && !tip.ix, 'the tip stays a sharp point');
    // A plain box would have corners at the far right. The tip does not.
    const nearTip = nodes.filter((n) => n.x > tipX - 5);
    const spread = Math.max(...nearTip.map((n) => n.y)) - Math.min(...nearTip.map((n) => n.y));
    assert.ok(spread < 10, `spread ${spread}`);
  });
}

test('tracing refuses a picture with nothing in it', () => {
  const rgba = new Uint8ClampedArray(40 * 40 * 4).fill(255);
  assert.throws(() => maskToShape(subjectMask(rgba, 40, 40), 40, 40), /Could not find a shape/);
});

test('smooth curves stay smooth and sharp turns stay sharp', () => {
  const sp = loopToSubpath([{ x: 0, y: 0 }, { x: 10, y: 1 }, { x: 20, y: 0 }, { x: 10, y: 30 }]);
  assert.ok(sp.nodes[1].ox);
  assert.ok(!sp.nodes[2].ox);
});

test('the PDF has a valid cross-reference table', () => {
  const jpeg = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);
  const parts = jpegToPdf(jpeg, 100, 200);
  const size = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  const xref = +text.match(/startxref\n(\d+)/)[1];
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const offsets = [...text.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => +m[1]);
  assert.equal(offsets.length, 5);
  offsets.forEach((o, i) => assert.equal(text.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.ok(text.includes('/MediaBox [0 0 75 150]'));
});
