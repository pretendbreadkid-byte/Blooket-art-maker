import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newDoc, newPath, parseD, pathD, sample, setProps, addVertex, removeVertices, matchSubpaths, pointInPolygon,
  loopBack, chainSubpaths, addPage, removePage, movePage, loopPagesBack, onFrame, regroup,
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

function goesDown() {
  const { doc, obj } = animated();
  setProps(doc, obj, 20, { y: 300 });
  return { doc, obj };
}

test('loop back plays the move in reverse and ends where it began', () => {
  const { obj } = goesDown();
  assert.equal(loopBack([obj]), 40);
  assert.deepEqual(obj.keys.map((k) => k.f), [0, 20, 40]);
  assert.equal(sample(obj, 40).y, sample(obj, 0).y);
  assert.equal(sample(obj, 30).y, sample(obj, 10).y);
});

test('loop back swaps speeding up and slowing down', () => {
  const { obj } = goesDown();
  obj.keys[0].ease = 'in';
  loopBack([obj]);
  assert.equal(obj.keys[1].ease, 'out');
  assert.ok(Math.abs(sample(obj, 30).y - sample(obj, 10).y) < 1e-9);
});

test('loop back needs something that has moved', () => {
  const { obj } = animated();
  assert.equal(loopBack([obj]), null);
});

test('things looped together turn around on the same frame', () => {
  const short = goesDown().obj, long = goesDown().obj;
  long.keys[1].f = 30;
  assert.equal(loopBack([short, long]), 60);
  assert.equal(sample(short, 30).y, 300);
  assert.equal(sample(short, 60).y, 0);
  assert.equal(sample(short, 45).y, sample(short, 15).y);
});

const open = (...points) => ({ closed: false, nodes: points.map(([x, y]) => ({ x, y })) });

test('lines chain end to end, flipping any that point the wrong way', () => {
  const chain = chainSubpaths([open([0, 0], [10, 0]), open([20, 20], [10, 0])], 0.5);
  assert.deepEqual(chain.nodes.map((n) => [n.x, n.y]), [[0, 0], [10, 0], [20, 20]]);
  assert.equal(chain.closed, false);
});

test('lines that come back to the start close into a shape', () => {
  const chain = chainSubpaths([open([0, 0], [10, 0]), open([10, 0], [10, 10]), open([10, 10], [0, 0])], 0.5);
  assert.equal(chain.closed, true);
  assert.equal(chain.nodes.length, 3);
});

test('curves survive being flipped and chained', () => {
  const curve = { closed: false, nodes: [{ x: 0, y: 0, ox: 5, oy: 5 }, { x: 10, y: 0, ix: -5, iy: 5 }] };
  const chain = chainSubpaths([open([20, 0], [10, 0]), curve], 0.5);
  const joint = chain.nodes[1];
  assert.deepEqual([joint.x, joint.ox, joint.oy], [10, -5, 5]);
});

function flipbook() {
  const doc = newDoc({ name: 't', animated: true, animMode: 'pages', width: 200, height: 200 });
  const draw = (index, y) => {
    const obj = newPath({ subpaths: square(), fill: '#000000', y, page: doc.pages[index].id });
    doc.layers[0].objects.push(obj);
    return obj;
  };
  return { doc, draw };
}

test('editing in a page animation never makes keyframes', () => {
  const { doc, draw } = flipbook();
  addPage(doc, 0);
  const obj = draw(1, 10);
  setProps(doc, obj, 1, { x: 50 });
  assert.equal(obj.x, 50);
  assert.equal(obj.keys.length, 0);
});

test('each page only draws its own art', () => {
  const { doc, draw } = flipbook();
  addPage(doc, 0);
  const a = draw(0, 10), b = draw(1, 20);
  assert.ok(onFrame(doc, a, 0) && !onFrame(doc, a, 1) && onFrame(doc, b, 1));
  assert.equal(exportSVG(doc, { frame: 0 }).match(/<path/g).length, 1);
  assert.match(exportSVG(doc, { frame: 1 }), /translate\(0 20\)/);
});

test('copied pages get their own objects and removing one takes its art', () => {
  const { doc, draw } = flipbook();
  draw(0, 10);
  addPage(doc, 0, 0);
  const [a, b] = doc.layers[0].objects;
  assert.notEqual(a.id, b.id);
  assert.equal(b.page, doc.pages[1].id);
  assert.ok(removePage(doc, 1));
  assert.equal(doc.layers[0].objects.length, 1);
  assert.equal(doc.frames, 1);
  assert.equal(removePage(doc, 0), false);
});

test('pages reorder', () => {
  const { doc } = flipbook();
  addPage(doc, 0);
  const [first, second] = doc.pages;
  movePage(doc, 0, 1);
  assert.deepEqual(doc.pages, [second, first]);
});

test('page loop back goes 1 2 3 2 1', () => {
  const { doc, draw } = flipbook();
  addPage(doc, 0);
  addPage(doc, 1);
  [10, 20, 30].forEach((y, i) => draw(i, y));
  assert.ok(loopPagesBack(doc));
  const order = doc.pages.map((p) => doc.layers[0].objects.find((o) => o.page === p.id).y);
  assert.deepEqual(order, [10, 20, 30, 20, 10]);
  assert.equal(doc.frames, 5);
});

test('an exported page animation flips with discrete timing', () => {
  const { doc, draw } = flipbook();
  addPage(doc, 0);
  draw(0, 10);
  draw(1, 20);
  const svg = exportSVG(doc, { animate: true });
  assert.equal(svg.match(/attributeName="display"/g).length, 2);
  assert.match(svg, /calcMode="discrete"/);
  assert.equal(svg.match(/<path/g).length, 2);
});

test('imported pieces keep their gradients, clips and stroke style', () => {
  const doc = newDoc({ name: 't', width: 100, height: 100 });
  doc.layers[0].objects.push(newPath({
    subpaths: square(), fill: '#111111',
    gradient: {
      from: '#111111', to: '#222222', angle: 90,
      raw: { type: 'linear', coords: { x1: 0, y1: 0, x2: 1, y2: 0 }, stops: [[0, '#111111', 1], [0.5, '#333333', 0.5], [1, '#222222', 1]], matrix: [1, 0, 0, 1, 2, 3], spread: 'pad' },
    },
    stroke: '#000000', strokeWidth: 2, look: { 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'fill-opacity': 0.5 },
    clips: [[{ rule: 'evenodd', subpaths: square() }]],
  }));
  const svg = exportSVG(doc);
  assert.equal(svg.match(/<stop/g).length, 3);
  assert.match(svg, /gradientTransform="matrix\(1 0 0 1 2 3\)"/);
  assert.match(svg, /stroke-linecap="butt"/);
  assert.equal(svg.match(/stroke-linecap/g).length, 1);
  assert.match(svg, /fill-opacity="0.5"/);
  assert.match(svg, /<clipPath[^>]*><path[^>]*clip-rule="evenodd"/);
});

test('copies of a group get a group of their own', () => {
  const a = { group: 'x' }, b = { group: 'x' }, c = { group: 'y' }, d = {};
  regroup([a, b, c, d]);
  assert.equal(a.group, b.group);
  assert.notEqual(a.group, 'x');
  assert.notEqual(c.group, a.group);
  assert.equal(d.group, undefined);
});
