import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newDoc, newPath, parseD, pathD, sample, setProps, addVertex, removeVertices, matchSubpaths, pointInPolygon,
  loopBack, chainSubpaths, addPage, removePage, movePage, loopPagesBack, onFrame, regroup,
  nearestOnOutline, flipped, newText, localToWorld, flattenLayers, newLayer,
} from '../public/js/model.js';
import { exportSVG, embedFont } from '../public/js/render.js';
import { subjectMask, cleanMask, maskToShape, loopToSubpath, pixelsToPieces } from '../public/js/trace.js';
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

test('blur exports, ignores the piece scale, and animates', () => {
  const { doc, obj } = animated();
  assert.ok(!exportSVG(doc).includes('feGaussianBlur'));
  obj.scaleX = obj.scaleY = 3;
  obj.blur = 8;
  const still = exportSVG(doc);
  assert.ok(still.includes('stdDeviation="8"'), still);
  assert.ok(/<g filter="url\(#[^"]+-blur\)"><filter[^>]+><feGaussianBlur[^>]*><\/feGaussianBlur><\/filter><g transform=/.test(still), still);
  setProps(doc, obj, 0, { blur: 0 });
  setProps(doc, obj, 20, { blur: 10 });
  assert.equal(sample(obj, 10).blur, 5);
  const moving = exportSVG(doc, { animate: true });
  assert.ok(moving.includes('attributeName="stdDeviation"'), moving);
});

test('art from before blur still animates without one', () => {
  const { doc, obj } = animated();
  setProps(doc, obj, 20, { x: 50 });
  delete obj.keys[0].pose.blur;
  delete obj.keys[1].pose.blur;
  assert.ok(!Number.isNaN(sample(obj, 10).x));
  assert.ok(!exportSVG(doc, { animate: true }).includes('feGaussianBlur'));
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

test('a point can go anywhere on a straight line', () => {
  const { obj } = animated();
  const index = addVertex(obj, 0, 0, 0.25);
  assert.deepEqual([obj.subpaths[0].nodes[index].x, obj.subpaths[0].nodes[index].y], [25, 0]);
});

test('a point added anywhere on a curve leaves the curve the same shape', () => {
  const curve = () => [{ closed: false, nodes: [{ x: 0, y: 0, ox: 30, oy: 60 }, { x: 100, y: 0, ix: -30, iy: 60 }] }];
  const before = newPath({ subpaths: curve() });
  const after = newPath({ subpaths: curve() });
  addVertex(after, 0, 0, 0.3);
  const spot = nearestOnOutline(before.subpaths, 30, 40);
  const again = nearestOnOutline(after.subpaths, spot.x, spot.y);
  assert.ok(again.dist < 0.01);
});

test('the closest spot on an outline is found exactly', () => {
  const spot = nearestOnOutline(square(), 37, -5);
  assert.deepEqual([spot.s, spot.i], [0, 0]);
  assert.ok(Math.abs(spot.t - 0.37) < 0.001);
  assert.ok(Math.abs(spot.dist - 5) < 0.001);
});

test('flipping a group mirrors every piece around the same middle', () => {
  const o = newPath({ x: 80, y: 30, rotation: 20, scaleX: 2, scaleY: 1, subpaths: square() });
  const point = localToWorld(o, 10, 5);
  const sideways = { ...o, ...flipped(o, 'x', 50, 50) };
  const a = localToWorld(sideways, 10, 5);
  assert.ok(Math.abs(a.x - (100 - point.x)) < 1e-9 && Math.abs(a.y - point.y) < 1e-9);
  const down = { ...o, ...flipped(o, 'y', 50, 50) };
  const b = localToWorld(down, 10, 5);
  assert.ok(Math.abs(b.x - point.x) < 1e-9 && Math.abs(b.y - (100 - point.y)) < 1e-9);
});

test('text can have a chunky shadow and the font travels with the export', () => {
  embedFont('Titan One', 'QUJD');
  const doc = newDoc({ name: 't', width: 100, height: 100 });
  assert.ok(!exportSVG(doc).includes('@font-face'));
  doc.layers[0].objects.push(newText({ text: 'Hi', fontFamily: 'Titan One', fill: '#ffffff', shadow: true }));
  const svg = exportSVG(doc);
  assert.match(svg, /@font-face\{font-family:"Titan One";src:url\(data:font\/woff2;base64,QUJD\)/);
  assert.equal(svg.match(/<text/g).length, 2);
  assert.match(svg, /fill-opacity="0.24"/);
});

test('a picture splits into one piece per patch of colour', () => {
  const size = 60;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const paint = (x, y) => {
    if (x >= 10 && x < 30 && y >= 10 && y < 50) return [230, 30, 30, 255];
    if (x >= 30 && x < 50 && y >= 10 && y < 50) return [30, 30, 230, 255];
    return [0, 0, 0, 0];
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set(paint(x, y), (y * size + x) * 4);
  const { pieces, box } = pixelsToPieces(rgba, size, size);
  assert.equal(pieces.length, 2);
  assert.equal(box.width, size);
  assert.deepEqual(pieces.map((p) => p.fill.color).sort(), ['#1e1ee6', '#e61e1e']);
});

test('old projects flatten into one stack in the same order', () => {
  const doc = newDoc({ name: 't', animated: true });
  const top = newLayer('Top');
  top.opacity = 0.5;
  top.locked = true;
  doc.layers.push(top);
  const under = newPath({ name: 'under', subpaths: square() });
  const over = newPath({ name: 'over', subpaths: square(), opacity: 0.8, keys: [{ f: 0, pose: { opacity: 0.8 } }] });
  doc.layers[0].objects.push(under);
  top.objects.push(over);
  flattenLayers(doc);
  assert.equal(doc.layers.length, 1);
  assert.deepEqual(doc.layers[0].objects.map((o) => o.name), ['under', 'over']);
  assert.equal(doc.activeLayerId, doc.layers[0].id);
  assert.ok(Math.abs(over.opacity - 0.4) < 1e-9);
  assert.ok(Math.abs(over.keys[0].pose.opacity - 0.4) < 1e-9);
  assert.equal(doc.layers[0].locked, false);
});

test('flattening a project that is already flat changes nothing', () => {
  const doc = newDoc({ name: 't' });
  const before = JSON.stringify(doc);
  flattenLayers(doc);
  assert.equal(JSON.stringify(doc), before);
});

test('a template overlay sits above the art and can be turned off', async () => {
  const { newDoc: blank } = await import('../public/js/model.js');
  const { TEMPLATES, overlayLook } = await import('../public/js/templates.js');
  const doc = blank({ name: 'Blook', width: 512, height: 512 });
  doc.template = 'blook';
  doc.overlay = true;
  assert.ok(exportSVG(doc).includes(TEMPLATES.blook.overlay.markup(overlayLook(doc))));
  assert.ok(!exportSVG(doc, { overlay: false }).includes('fill-opacity="0.28"'));
  doc.overlay = false;
  assert.ok(!exportSVG(doc).includes('fill-opacity="0.28"'));
  doc.overlay = true;
  doc.template = 'background';
  assert.ok(!exportSVG(doc).includes('pointer-events'));
});

test('the underbelly can be sized and darkened, and stays on the bottom edge', async () => {
  const { newDoc: blank } = await import('../public/js/model.js');
  const doc = blank({ name: 'Blook', width: 512, height: 512 });
  Object.assign(doc, { template: 'blook', overlay: true });
  const bottomOf = (svg) => {
    const [, y, sy] = svg.match(/translate\(256\.17 ([\d.]+)\) scale\(1\.7231 ([\d.]+)\)/).map(Number);
    return { top: y - 42.93 * sy, bottom: y + 42.93 * sy };
  };
  const normal = bottomOf(exportSVG(doc));
  Object.assign(doc, { overlaySize: 2, overlayStrength: 0.6 });
  const svg = exportSVG(doc);
  const big = bottomOf(svg);
  assert.ok(Math.abs(big.bottom - normal.bottom) < 0.01, 'the bottom stays put');
  assert.ok(Math.abs((big.bottom - big.top) - 2 * (normal.bottom - normal.top)) < 0.01, 'twice as tall');
  assert.ok(svg.includes('fill-opacity="0.6"'));
});

test('anything can have an underbelly made from its own outline', async () => {
  const { newUnderbelly } = await import('../public/js/render.js');
  const doc = newDoc({ name: 't' });
  const shape = newPath({ subpaths: square(), fill: '#ff0000' });
  const words = newText({ text: 'Hi', x: 300, y: 300 });
  doc.layers[0].objects.push(shape, words);
  assert.ok(!exportSVG(doc).includes('-belly'));

  shape.underbelly = { ...newUnderbelly(), size: 2, strength: 0.6, color: '#3a1f5c' };
  words.underbelly = newUnderbelly();
  const svg = exportSVG(doc);
  // The square is 100 tall, so at 200% the band is 28 deep: the outline moved up 28 is cut out.
  assert.ok(svg.includes('<feOffset in="SourceAlpha" dx="0" dy="-28" result="up"/>'), svg);
  assert.ok(svg.includes('flood-color="#3a1f5c" flood-opacity="0.6"'));
  assert.ok(svg.includes(`filter="url(#erase-${shape.id}-belly)"`));
  assert.ok(svg.includes(`filter="url(#erase-${words.id}-belly)"`), 'text gets one too');
  assert.ok(!svg.includes('M-113.62 42.93'), 'no stretched template shape');
});

test('a flipped shape keeps its underbelly on the bottom', async () => {
  const { newUnderbelly } = await import('../public/js/render.js');
  const doc = newDoc({ name: 't' });
  const shape = newPath({ subpaths: square(), fill: '#ff0000', scaleY: -1, underbelly: newUnderbelly() });
  doc.layers[0].objects.push(shape);
  assert.ok(exportSVG(doc).includes('dy="14" result="up"'));
});

test('an underbelly follows an animated shape', async () => {
  const { newUnderbelly } = await import('../public/js/render.js');
  const { doc, obj } = animated();
  obj.underbelly = newUnderbelly();
  setProps(doc, obj, 20, { subpaths: square().map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => ({ ...n, y: n.y * 2 })) })) });
  const svg = exportSVG(doc, { animate: true });
  assert.ok(svg.includes('<animate attributeName="d" values='));
  assert.ok(svg.includes(`filter="url(#erase-${obj.id}-belly)"`));
});

test('the template underbelly can change colour', async () => {
  const doc = newDoc({ name: 'Blook', width: 512, height: 512 });
  Object.assign(doc, { template: 'blook', overlay: true, overlayColor: '#123456' });
  assert.ok(exportSVG(doc).includes('fill="#123456" fill-opacity="0.28"'));
  doc.overlayColor = '"><script>';
  assert.ok(exportSVG(doc).includes('fill="#000000"'), 'only real colours are used');
});

test('a drop shadow is drawn under the art, once for a whole Blook', async () => {
  const { newDropShadow } = await import('../public/js/render.js');
  const doc = newDoc({ name: 't', width: 400, height: 400 });
  const a = newPath({ subpaths: square(), fill: '#ff0000', group: 'g1' });
  const b = newPath({ subpaths: square(), fill: '#00ff00', x: 50, group: 'g1' });
  doc.layers[0].objects.push(a, b);
  assert.ok(!exportSVG(doc).includes('<use'));
  a.dropShadow = newDropShadow();
  b.dropShadow = newDropShadow();
  const svg = exportSVG(doc);
  assert.equal(svg.match(/filter="url\(#[^"]+-ds-/g).length, 1, 'one shadow for the group');
  assert.ok(svg.indexOf('-ds-') < svg.indexOf(`id="erase-${doc.layers[0].id}-o-${a.id}"`), 'the shadow comes first');
  assert.ok(svg.includes('<feOffset in="SourceAlpha" dx="0" dy="10"/>'), 'solid, not blurred');
  assert.ok(!svg.includes('feGaussianBlur'));
  a.dropShadow = b.dropShadow = { ...newDropShadow(), soft: 5 };
  assert.ok(exportSVG(doc).includes('feGaussianBlur in="SourceAlpha" stdDeviation="5"'), 'softness still works when asked for');
});

test('the new textures draw, and the shine starts angled and sweeps in animations', async () => {
  const { TEXTURES, newTexture, patternMarkup } = await import('../public/js/textures.js');
  for (const kind of ['shine', 'bricks', 'planks', 'scales', 'zigzag', 'diamonds', 'hearts']) {
    assert.ok(TEXTURES[kind], kind);
    assert.match(patternMarkup(newTexture(kind), 't', null, 0), /<(path|rect) /, kind);
  }
  const still = newTexture('shine');
  assert.equal(still.angle, 35);
  assert.equal(still.move, 'none', 'pictures do not move');
  assert.equal(newTexture('shine', true).move, 'right');
  const { doc, obj } = animated();
  obj.texture = newTexture('shine', true);
  setProps(doc, obj, 20, { x: 10 });
  assert.ok(exportSVG(doc, { animate: true }).includes('attributeName="patternTransform"'));
});

test('auto shadow only falls on pieces that are overlapped', () => {
  const doc = newDoc({ name: 't', width: 600, height: 600 });
  const under = newPath({ subpaths: square(), fill: '#0000ff' });
  const over = newPath({ subpaths: square(), fill: '#ff0000', x: 50, y: 50 });
  const apart = newPath({ subpaths: square(), fill: '#00ff00', x: 400, y: 400 });
  doc.layers[0].objects.push(under, over, apart);
  doc.autoShadow = { on: true, strength: 0.4, size: 12 };
  const svg = exportSVG(doc);
  assert.ok(svg.includes(`-as-${over.id}"`), 'the top piece shades the one under it');
  assert.ok(!svg.includes(`-as-${apart.id}"`), 'a piece on its own casts nothing');
  assert.ok(svg.includes('slope="0.4"'));
  assert.ok(svg.includes('<feOffset in="SourceAlpha" dx="0" dy="12"/>') && !svg.includes('feGaussianBlur'), 'a solid band, not a fade');
  doc.autoShadow.on = false;
  assert.ok(!exportSVG(doc).includes('<use'));
});

test('auto shadows follow pieces in an animated export', () => {
  const { doc, obj } = animated();
  const top = newPath({ subpaths: square(), fill: '#ff0000', x: 500 });
  doc.layers[0].objects.push(top);
  setProps(doc, top, 20, { x: 0 });
  doc.autoShadow = { on: true, strength: 0.4, size: 12 };
  const svg = exportSVG(doc, { animate: true });
  assert.ok(svg.includes(`-as-${top.id}"`), 'moving pieces still cast');
  assert.ok(svg.includes(`<use href="#erase-${doc.layers[0].id}-o-${obj.id}"/>`));
});

test('confetti flies out, slows down and fades away', async () => {
  const { step, BURSTS } = await import('../public/js/confetti.js');
  const { RARITIES } = await import('../public/js/pack-rules.js');
  const p = { x: 0, y: 900, velocity: 40, decay: 0.9, angle2D: -Math.PI / 3, gravity: 3, drift: 0, wobble: 0, wobbleSpeed: 0.1, tilt: 0, tick: 0, ticks: 200 };
  step(p);
  assert.ok(p.x > 0 && p.y < 900, 'it flies up and in');
  let alive = true;
  for (let i = 0; i < 300 && alive; i++) alive = step(p);
  assert.ok(!alive);
  assert.equal(RARITIES.Common.confetti.from, 'none');
  assert.equal(RARITIES.Rare.confetti.from, 'bottom-corners');
  assert.equal(RARITIES.Epic.confetti.from, 'sides');
  assert.equal(RARITIES.Legendary.confetti.from, 'top');
  assert.ok(RARITIES.Chroma.confetti.gems && RARITIES.Chroma.confetti.from === 'all-corners');
  for (const r of Object.values(RARITIES)) assert.ok(BURSTS[r.confetti.from], r.confetti.from);
});

test('packs follow the odds, whatever they add up to', async () => {
  const { balanceOdds, chanceOf, pickBlook, whyNotOpen, newPack } = await import('../public/js/pack-rules.js');
  const blooks = [{ id: 'a', odds: 30 }, { id: 'b', odds: 10 }, { id: 'c', odds: 0 }];
  assert.equal(chanceOf(blooks[0], blooks), 75);
  assert.equal(pickBlook(blooks, 0).id, 'a');
  assert.equal(pickBlook(blooks, 0.74).id, 'a');
  assert.equal(pickBlook(blooks, 0.76).id, 'b');
  assert.equal(pickBlook(blooks, 0.9999).id, 'b');
  assert.deepEqual(balanceOdds(blooks).map((b) => b.odds), [75, 25, 0]);
  assert.deepEqual(balanceOdds([{ odds: 0 }, { odds: 0 }]).map((b) => b.odds), [50, 50]);
  assert.match(whyNotOpen(newPack()), /pack art/);
  assert.match(whyNotOpen({ art: 'x', blooks: [] }), /Blook/);
  assert.match(whyNotOpen({ art: 'x', blooks: [{ odds: 0 }] }), /odds/);
  assert.equal(whyNotOpen({ art: 'x', blooks }), '');
});

test('every rarity has a gem, and old rarities still work', async () => {
  const { existsSync } = await import('node:fs');
  const { RARITIES, gemOf, rarityOf } = await import('../public/js/pack-rules.js');
  assert.deepEqual(Object.keys(RARITIES), ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Chroma', 'Unique']);
  for (const name of Object.keys(RARITIES)) assert.ok(existsSync(`public${gemOf(name)}`), name);
  assert.equal(rarityOf('Mystical'), RARITIES.Common);
  assert.equal(gemOf('Mystical'), '/rarity/common.svg');
});

test('pulls are counted, and only the first is new', async () => {
  const { newPack, pullsOf, recordPull } = await import('../public/js/pack-rules.js');
  const pack = newPack();
  const blook = { id: 'a' };
  assert.equal(pullsOf(pack, blook), 0);
  assert.equal(recordPull(pack, blook), true);
  assert.equal(recordPull(pack, blook), false);
  assert.equal(pullsOf(pack, blook), 2);
  const older = { art: 'x', blooks: [blook] };
  assert.equal(recordPull(older, blook), true);
});

test('a texture sits over the fill, lines up across the canvas, and outlines get it on the line', async () => {
  const { newTexture } = await import('../public/js/textures.js');
  const doc = newDoc({ name: 't', width: 200, height: 200 });
  const filled = newPath({ subpaths: square(), fill: '#ff0000', x: 40, y: 10, texture: newTexture('dots') });
  const outline = newPath({ subpaths: square(), fill: 'none', stroke: '#000000', strokeWidth: 8, texture: newTexture('stripes') });
  doc.layers[0].objects.push(filled, outline);
  const svg = exportSVG(doc);
  assert.equal((svg.match(/<pattern /g) || []).length, 2);
  assert.match(svg, /patternTransform="scale\(1 1\) rotate\(0\) translate\(-40 -10\) rotate\(0\)/);
  assert.match(svg, /fill="url\(#erase-[^"]+-tex0\)" stroke="none"/);
  assert.match(svg, /fill="none" stroke="url\(#erase-[^"]+-tex0\)"/);
  doc.bgTexture = newTexture('checks');
  assert.match(exportSVG(doc), /fill="url\(#frame-bgtex\)"/);
});

test('a moving texture slides a whole tile each loop, so the loop never jumps', async () => {
  const { newTexture, textureOffset } = await import('../public/js/textures.js');
  const doc = newDoc({ name: 't', animated: true, width: 200, height: 200 });
  const tex = { ...newTexture('dots'), size: 40, move: 'right', speed: 2 };
  assert.deepEqual(textureOffset(tex, 0, doc), [0, 0]);
  assert.deepEqual(textureOffset(tex, doc.frames / 2, doc), [40, 0]);
  assert.deepEqual(textureOffset(tex, doc.frames, doc), [0, 0]);
  assert.deepEqual(textureOffset(tex, 10, newDoc({ name: 'still' })), [0, 0]);
  doc.layers[0].objects.push(newPath({ subpaths: square(), fill: '#000000', texture: tex }));
  assert.match(exportSVG(doc, { animate: true }), /<animateTransform attributeName="patternTransform" type="translate" additive="sum" from="0 0" to="80 0" dur="4s"/);
});

test('swapping a colour reaches fills, outlines, gradients, keyframes, textures and SVG pictures', async () => {
  const { colorsIn, swapColor, svgOf } = await import('../public/js/recolor.js');
  const { newTexture } = await import('../public/js/textures.js');
  const { doc, obj } = animated();
  obj.stroke = '#00F';
  obj.gradient = { from: '#000000', to: '#ffffff', angle: 0 };
  obj.texture = { ...newTexture('dots'), color: '#000' };
  setProps(doc, obj, 10, { fill: '#000000' });
  const { newImage } = await import('../public/js/model.js');
  const picture = newImage({ href: `data:image/svg+xml;base64,${btoa('<svg><rect fill="#000000"/><rect fill="#00ff00"/></svg>')}` });
  assert.deepEqual(colorsIn([obj, picture]).slice(0, 1), ['#000000']);
  assert.ok(colorsIn([obj, picture]).includes('#0000ff'));
  swapColor([obj, picture], '#000000', '#123456');
  assert.equal(obj.fill, '#123456');
  assert.equal(obj.gradient.from, '#123456');
  assert.equal(obj.texture.color, '#123456');
  assert.ok(obj.keys.every((k) => k.pose.fill === '#123456'));
  assert.equal(obj.stroke, '#00F');
  assert.equal(svgOf(picture.href), '<svg><rect fill="#123456"/><rect fill="#00ff00"/></svg>');
});

test('a welded shape keeps each piece in its own colour, inside the joined outline', async () => {
  const { layerMarkup } = await import('../public/js/render.js');
  const doc = newDoc({ name: 't' });
  const welded = newPath({
    name: 'Welded shape', subpaths: square(), fill: '#00ff00', stroke: '#111111', strokeWidth: 4,
    parts: [
      newPath({ subpaths: parseD('M0 0H60V100H0Z'), fill: '#ff0000' }),
      newPath({ subpaths: parseD('M40 0H100V100H40Z'), fill: '#0000ff' }),
    ],
  });
  doc.layers[0].objects.push(welded);
  const svg = exportSVG(doc);
  assert.ok(svg.includes('fill="#ff0000"') && svg.includes('fill="#0000ff"'), 'both pieces keep their colours');
  assert.ok(svg.includes(`clip-path="url(#erase-${welded.id}-weld)"`), 'cut to the outline');
  assert.ok(svg.lastIndexOf('stroke="#111111"') > svg.indexOf('fill="#0000ff"'), 'the outline goes on top');
  const editor = layerMarkup(doc.layers[0], 0, { doc, editor: true, prefix: 'stage' });
  assert.equal(editor.match(/data-id=/g).length, 1, 'the pieces are not picked on their own');
  assert.ok(editor.includes('data-part="1"'), 'but the Bucket can find each one');
});

test('swapping colours reaches the pieces inside a welded shape', async () => {
  const { colorsIn, swapColor } = await import('../public/js/recolor.js');
  const welded = newPath({ subpaths: square(), fill: '#00ff00', parts: [newPath({ subpaths: square(), fill: '#ff0000' })] });
  assert.deepEqual(colorsIn([welded]).sort(), ['#00ff00', '#ff0000']);
  swapColor([welded], '#ff0000', '#123456');
  assert.equal(welded.parts[0].fill, '#123456');
});

test('text outlines go round the outside of the letters', () => {
  const doc = newDoc({ name: 't' });
  doc.layers[0].objects.push(newText({ text: 'Hi', fill: '#ffffff', stroke: '#000000', strokeWidth: 6 }));
  const svg = exportSVG(doc);
  assert.ok(svg.includes('stroke-width="12"') && svg.includes('paint-order="stroke"'), 'drawn twice as wide, behind the fill');
});

test('text lines line up left, centre or right', () => {
  const doc = newDoc({ name: 't' });
  const words = newText({ text: 'One\nTwo', align: 'left' });
  doc.layers[0].objects.push(words);
  assert.ok(exportSVG(doc).includes('text-anchor="start"'));
  words.align = 'right';
  assert.ok(exportSVG(doc).includes('text-anchor="end"'));
  delete words.align;
  assert.ok(exportSVG(doc).includes('text-anchor="middle"'), 'centred unless told otherwise');
});

test('curved text sits on an arc that bends up or down', () => {
  const doc = newDoc({ name: 't' });
  const words = newText({ text: 'Blook Berry', warp: { type: 'arc', amount: 60 } });
  doc.layers[0].objects.push(words);
  let svg = exportSVG(doc);
  assert.ok(svg.includes(`<textPath href="#erase-${words.id}-arc0" startOffset="50%">Blook Berry</textPath>`), svg);
  assert.match(svg, /<path id="[^"]+-arc0" d="M[^"]+A[\d.]+ [\d.]+ 0 1 1 /, 'a hill');
  words.warp.amount = -60;
  svg = exportSVG(doc);
  assert.match(svg, /<path id="[^"]+-arc0" d="M[^"]+A[\d.]+ [\d.]+ 0 1 0 /, 'a bowl');
});

test('warps move or size each letter', () => {
  const doc = newDoc({ name: 't' });
  const words = newText({ text: 'Wavy', warp: { type: 'wave', amount: 80 } });
  doc.layers[0].objects.push(words);
  let svg = exportSVG(doc);
  assert.equal((svg.match(/<tspan/g) || []).length, 4, 'one span per letter');
  assert.equal((svg.match(/<tspan[^>]*rotate=/g) || []).length, 4, 'each letter tipped to follow the wave');
  words.warp = { type: 'bulge', amount: 100 };
  svg = exportSVG(doc);
  const sizes = [...svg.matchAll(/<tspan[^>]*font-size="([\d.]+)"/g)].map((m) => +m[1]);
  assert.ok(sizes[1] > sizes[0] && sizes[1] > sizes[3], `the middle grows: ${sizes}`);
  words.warp = { type: 'none', amount: 50 };
  assert.ok(!exportSVG(doc).includes('rotate='));
});

test('hidden things are not drawn, and locked things cannot be picked on the canvas', async () => {
  const { layerMarkup } = await import('../public/js/render.js');
  const doc = newDoc({ name: 't' });
  const shown = newPath({ subpaths: square(), fill: '#ff0000' });
  const hidden = newPath({ subpaths: square(), fill: '#00ff00', hidden: true });
  const locked = newPath({ subpaths: square(), fill: '#0000ff', locked: true });
  doc.layers[0].objects.push(shown, hidden, locked);
  const svg = exportSVG(doc);
  assert.ok(svg.includes('#ff0000') && !svg.includes('#00ff00') && svg.includes('#0000ff'), 'hidden stays out of exports too');
  const editor = layerMarkup(doc.layers[0], 0, { doc, editor: true, prefix: 'stage' });
  assert.ok(editor.includes(`data-id="${locked.id}" pointer-events="none"`));
  assert.ok(!editor.includes(`data-id="${shown.id}" pointer-events`));
});

test('smoothing a drawn line takes out the wobble but keeps its ends and shape', async () => {
  const { smoothStroke, strokeToSubpath, pathBounds } = await import('../public/js/model.js');
  const wobbly = Array.from({ length: 200 }, (_, i) => ({ x: i * 1.5, y: Math.sin(i * 1.7) * 4 + Math.sin(i / 30) * 30 }));
  const line = strokeToSubpath(wobbly, 0.5);
  const smooth = smoothStroke(line, 6);
  assert.ok(smooth.nodes.length < line.nodes.length / 5, `far fewer points: ${line.nodes.length} -> ${smooth.nodes.length}`);
  assert.deepEqual([smooth.nodes[0].x, smooth.nodes[0].y], [line.nodes[0].x, line.nodes[0].y], 'starts where it was drawn');
  const [a, b] = [line.nodes.at(-1), smooth.nodes.at(-1)];
  assert.deepEqual([b.x, b.y], [a.x, a.y], 'ends where it was drawn');
  assert.ok(pathBounds([smooth]).height > pathBounds([line]).height * 0.8, 'the big curve stays');
  assert.ok(smooth.nodes.slice(1, -1).every((n) => n.ix || n.iy), 'curved, not jagged');
  const short = strokeToSubpath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.5);
  assert.equal(smoothStroke(short, 4), short, 'a two-point line is left alone');
});

test('the background remover takes away a gradient background and keeps the subject', async () => {
  const { findBackground, cutOut } = await import('../public/js/bg-remove.js');
  const W = 40, H = 40, px = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, [r, g, b]) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  // A sky that slowly fades from light blue to darker blue, with a red ring in the middle.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, [120 - y, 180 - y, 255 - y * 2]);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) {
    const inHole = x >= 17 && x < 23 && y >= 17 && y < 23;
    if (!inHole) set(x, y, [220, 30, 40]);
  }
  const bg = findBackground(px, W, H);
  assert.equal(bg[0], 1, 'the corner goes');
  assert.equal(bg[39 * W + 39], 1, 'the far, darker corner goes too, following the gradient');
  assert.equal(bg[15 * W + 15], 0, 'the red ring stays');
  assert.equal(bg[20 * W + 20], 0, 'the hole is kept until clicked, since it is cut off from the edge');
  const clicked = findBackground(px, W, H, 40, [[20, 20]]);
  assert.equal(clicked[20 * W + 20], 1, 'clicking the hole removes it');
  assert.equal(clicked[15 * W + 15], 0, 'and the ring still stays');
  const out = cutOut(px, W, H, clicked);
  assert.equal(out[3], 0, 'background is see-through');
  assert.equal(out[(15 * W + 15) * 4 + 3], 255, 'the inside of the subject is solid');
  assert.ok(out[(10 * W + 15) * 4 + 3] < 255 && out[(10 * W + 15) * 4 + 3] > 0, 'its edge is softened');
});

test('fonts a project added are built into its exports, in their own format', () => {
  const doc = newDoc({ name: 't' });
  doc.layers[0].objects.push(newText({ text: 'Hi', fontFamily: 'My Font' }), newText({ text: 'Yo', fontFamily: 'Lilita One' }));
  doc.fonts = [
    { family: 'My Font', data: 'AAEC', format: 'ttf', source: 'file' },
    { family: 'Lilita One', data: 'd09GMg==', format: 'woff2', source: 'google' },
    { family: 'Unused', data: 'AAAA', format: 'otf', source: 'file' },
  ];
  const svg = exportSVG(doc);
  assert.ok(svg.includes('@font-face{font-family:"My Font";src:url(data:font/ttf;base64,AAEC) format("truetype")}'), svg);
  assert.ok(svg.includes('format("woff2")'));
  assert.ok(!svg.includes('Unused'), 'only fonts in use are carried');
  doc.fonts[0].data = '") </style><script>';
  assert.ok(!exportSVG(doc).includes('<script>'), 'a broken font is left out, not written in');
});

test('a thing or the background can have several textures, layered in order', async () => {
  const { newTexture, texturesOf } = await import('../public/js/textures.js');
  const doc = newDoc({ name: 't', width: 200, height: 200 });
  const box = newPath({ subpaths: square(), fill: '#ff0000', textures: [newTexture('dots'), newTexture('stripes'), newTexture('blooks')] });
  doc.layers[0].objects.push(box);
  doc.bgTextures = [newTexture('checks'), newTexture('sparkles')];
  const svg = exportSVG(doc);
  const used = [...svg.matchAll(/fill="url\(#erase-[^"]+-tex(\d)\)"/g)].map((m) => +m[1]);
  assert.deepEqual(used, [0, 1, 2], 'each texture drawn, first to last');
  assert.ok(svg.includes('fill="url(#frame-bgtex)"') && svg.includes('fill="url(#frame-bgtex1)"'), 'two background textures');
  assert.ok(svg.includes('data:image/webp;base64,'), 'the Blooks texture carries its picture inside');
  assert.equal(texturesOf({ texture: newTexture('dots') }).length, 1, 'older art with one texture still has it');
});

test('fill and outline each have their own opacity, which can animate', () => {
  const doc = newDoc({ name: 't' });
  const box = newPath({ subpaths: square(), fill: '#ff0000', stroke: '#000000', strokeWidth: 4, fillOpacity: 0.5, strokeOpacity: 0.25 });
  doc.layers[0].objects.push(box);
  let svg = exportSVG(doc);
  assert.ok(svg.includes('fill-opacity="0.5"') && svg.includes('stroke-opacity="0.25"'), svg);
  box.look = { 'fill-opacity': 0.5 };
  svg = exportSVG(doc);
  assert.ok(svg.includes('fill-opacity="0.25"') && !svg.includes('fill-opacity="0.5"'), 'imported see-through art fades on top of its own, once');
  const { doc: moving, obj } = animated();
  setProps(moving, obj, 20, { fillOpacity: 0 });
  assert.equal(sample(obj, 10).fillOpacity, 0.5, 'halfway between full and none');
  assert.ok(exportSVG(moving, { animate: true }).includes('attributeName="fill-opacity"'));
});

test('the background can fade and blur, and stays solid to its edges when blurred', () => {
  const doc = newDoc({ name: 't', width: 200, height: 100 });
  doc.background = '#2ca5e8';
  assert.ok(!exportSVG(doc).includes('bgblur'));
  doc.bgOpacity = 0.4;
  doc.bgBlur = 6;
  const svg = exportSVG(doc);
  assert.ok(svg.includes('<feGaussianBlur stdDeviation="6"/>') && svg.includes('filter="url(#frame-bgblur)"') && svg.includes('opacity="0.4"'), svg);
  assert.ok(svg.includes('<rect x="-18" y="-18" width="236" height="136" fill="#2ca5e8"/>'), 'reaches past the edges');
});

test('a blurred texture blurs across its tile edges, and underbellies can be soft', async () => {
  const { newTexture } = await import('../public/js/textures.js');
  const { newUnderbelly } = await import('../public/js/render.js');
  const doc = newDoc({ name: 't' });
  const box = newPath({ subpaths: square(), fill: '#ff0000', textures: [{ ...newTexture('stripes'), blur: 4 }], underbelly: { ...newUnderbelly(), blur: 3 } });
  doc.layers[0].objects.push(box);
  const svg = exportSVG(doc);
  assert.ok(svg.includes(`<filter id="erase-${box.id}-tex0-blur"`), 'the texture has its blur');
  assert.equal((svg.match(/<rect width="40" height="16" fill="#ffffff"\/>/g) || []).length, 9, 'drawn with its neighbours, so no seams');
  assert.ok(svg.includes('<feGaussianBlur in="band" stdDeviation="3" result="band"/>') && svg.includes('<feComposite in2="SourceAlpha" operator="in" result="belly"/>'), 'a soft underbelly that stays inside');
});

test('pixelate turns art and the background into blocks on one grid', () => {
  const doc = newDoc({ name: 't', width: 200, height: 100 });
  doc.background = '#2ca5e8';
  const box = newPath({ subpaths: square(), fill: '#ff0000', pixel: 12 });
  doc.layers[0].objects.push(box);
  let svg = exportSVG(doc);
  const [, cx, cy] = svg.match(/<feOffset in="dot" x="(-?[\d.]+)" y="(-?[\d.]+)" width="12" height="12" result="cell"\/>/).map(Number);
  assert.ok(cx % 12 === 0 && cy % 12 === 0, `blocks sit on the canvas's grid: ${cx}, ${cy}`);
  assert.ok(svg.includes('<feGaussianBlur in="SourceGraphic" stdDeviation="3.6"/>'), 'each block takes its area\'s average colour');
  assert.ok(svg.includes('<feMorphology operator="dilate" radius="5.5"/>'));
  assert.ok(svg.includes('<feFuncA type="discrete" tableValues="0 1"/>'), 'crisp edges');
  const [, w] = svg.match(/<filter id="erase-[^"]+-blur" filterUnits="userSpaceOnUse" x="-?\d+" y="-?\d+" width="(\d+)"/).map(Number);
  assert.ok(w < 200, `worked out only around the piece, not everywhere: ${w}`);
  doc.bgPixel = 8;
  box.pixel = 0;
  svg = exportSVG(doc);
  assert.ok(svg.includes('filter="url(#frame-bgblur)"') && svg.includes('width="8" height="8" result="cell"'), 'the background too');
  assert.equal((svg.match(/feMorphology/g) || []).length, 1, 'only the background');
});
