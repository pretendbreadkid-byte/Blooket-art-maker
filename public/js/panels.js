// The option bar, the Selected panel, the Layers panel and the shapes catalog.
import {
  S, hooks, liveRefresh, commit, selected, posed, edit, canUndo, canRedo, paintPatch, setToolFill,
} from './state.js';
import { clone, pathBounds } from './model.js';
import { esc } from './render.js';
import { BASIC_SHAPES, PLUS_SHAPES, shapeThumb } from './shapes.js';
import { localBox, hasCorners, toDoc } from './stage.js';
import {
  TOOLS, TOOL_GROUPS, addShape, reorderSelection, flipSelection, duplicateSelection, deleteSelection, deleteNodes, setNodesKind, setTool,
  canTakeApart, takeApart, stackEnds,
} from './tools.js';
import { drawBlooks } from './blooks.js';
import { isPlus } from './session.js';
import { plusDialog } from './plus.js';
import { $, $$, html, icon, swatch, colorPopover } from './ui.js';

export const BLOOKET_FONT = 'Titan One';
const FONTS = [[BLOOKET_FONT, 'Blooket (Titan One)'], ...['Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Impact'].map((f) => [f, f])];

function slider({ label, value, min, max, step = 1, unit = '', onInput, onChange }) {
  const row = html(`<label class="slider"><span>${esc(label)}</span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">
    <span class="val"><input type="number" min="${min}" step="${step}" value="${value}" aria-label="${esc(label)}"><i>${unit}</i></span></label>`);
  const [range, number] = $$('input', row);
  const set = (v, from) => {
    if (from !== range) range.value = v;
    if (from !== number) number.value = v;
    onInput(v);
  };
  range.oninput = () => set(+range.value, range);
  number.oninput = () => { if (number.value !== '' && Number.isFinite(+number.value)) set(+number.value, number); };
  range.onchange = number.onchange = () => onChange?.();
  return row;
}

function colorButton({ label, value, allowNone, allowGradient, onInput, onDone }) {
  const btn = html(`<button class="color-btn" title="Choose ${esc(label)}">${swatch(value)}<span>${esc(label)}</span></button>`);
  let current = value;
  btn.onclick = () => colorPopover(btn, {
    value: current, allowNone, allowGradient,
    onInput: (c) => { current = c; btn.querySelector('.sw').replaceWith(html(swatch(c))); onInput(c); },
    onDone,
  });
  return btn;
}

function button(label, iconName, onClick, extra = '') {
  const b = html(`<button class="chip ${extra}" title="${esc(label)}">${icon(iconName)}<span>${esc(label)}</span></button>`);
  b.onclick = onClick;
  return b;
}

/* ---------- Option bar ---------- */

function roundingSlider(item) {
  const nodes = () => {
    const s = posed(item);
    const list = [];
    s.subpaths.forEach((sp, a) => sp.nodes.forEach((_, i) => {
      if (!S.nodeSel.size || S.nodeSel.has(`${a}:${i}`)) list.push([a, i]);
    }));
    return list;
  };
  const s = posed(item);
  const b = pathBounds(s.subpaths);
  const max = Math.ceil(Math.max(b.width, b.height) / 2) || 1;
  const first = nodes()[0];
  const current = first ? Math.round(s.subpaths[first[0]].nodes[first[1]].r || 0) : 0;
  return slider({
    label: 'Round corners', value: current, min: 0, max,
    onInput: (v) => {
      const subpaths = clone(posed(item).subpaths);
      for (const [a, i] of nodes()) subpaths[a].nodes[i].r = v;
      edit(item, { subpaths });
      liveRefresh();
    },
    onChange: commit,
  });
}

function optionBar() {
  const bar = $('#opts');
  bar.innerHTML = '';
  const tool = S.tool;
  const title = html(`<div class="opt-title"><b>${TOOLS[tool].label}</b></div>`);
  bar.append(title);
  const add = (...els) => bar.append(...els);
  const ink = (key, label) => colorButton({ label, value: S[key], onInput: (c) => { S[key] = c; } });
  const paint = (label) => colorButton({ label, value: S.fillGradient || S.fill, allowGradient: true, onInput: setToolFill });

  if (tool === 'select' && selected().length) {
    add(
      button('Flip sideways', 'flipx', () => flipSelection('x')),
      button('Flip up and down', 'flipy', () => flipSelection('y')),
    );
  }
  if (tool === 'pencil' || tool === 'marker' || tool === 'eraser' || tool === 'line') {
    if (tool !== 'eraser') add(ink('stroke', 'Colour'));
    add(slider({ label: 'Size', value: S.sizes[tool], min: 1, max: 200, unit: 'px', onInput: (v) => { S.sizes[tool] = v; } }));
    if (tool === 'line') add(html('<span class="muted">To move a point later, use Vertices. To fill a closed line, use the Bucket.</span>'));
  } else if (tool === 'shapes') {
    add(paint('Fill'), ink('stroke', 'Outline'));
    add(slider({ label: 'Outline size', value: S.shapeOutline, min: 0, max: 60, unit: 'px', onInput: (v) => { S.shapeOutline = v; } }));
  } else if (tool === 'bucket') {
    add(paint('Colour'));
  } else if (tool === 'text') {
    add(paint('Colour'));
    add(fontControls(S.font, (patch) => Object.assign(S.font, patch)));
  } else if (tool === 'vertices') {
    const [item] = selected();
    if (item?.type === 'path') {
      add(roundingSlider(item));
      const has = S.nodeSel.size > 0;
      const kind = has ? selectedNodeKind(item) : S.nodeKind;
      const choose = (next) => () => {
        S.nodeKind = next;
        if (has) { setNodesKind(next); commit(); } else hooks.panels();
      };
      add(html(`<span class="opt-label">${has ? 'This point' : 'New points'}</span>`));
      add(
        button('Pointed', 'sharp', choose('pointed'), kind === 'pointed' ? 'on' : ''),
        button('Rounded', 'smooth', choose('rounded'), kind === 'rounded' ? 'on' : ''),
        button('Delete point', 'trash', () => deleteNodes(), has ? '' : 'off'),
      );
    } else {
      add(html('<span class="muted">Click a shape or a drawing to see its points.</span>'));
    }
  }
}

function selectedNodeKind(item) {
  const [key] = S.nodeSel;
  const [sp, i] = key.split(':').map(Number);
  const n = posed(item).subpaths[sp]?.nodes[i];
  return n && (n.ix || n.iy || n.ox || n.oy) ? 'rounded' : 'pointed';
}

function fontControls(target, apply) {
  const box = html(`<div class="font-row">
    <select aria-label="Font">${FONTS.map(([f, label]) => `<option value="${f}" ${f === target.fontFamily ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <button class="tog ${target.bold ? 'on' : ''}" title="Bold"><b>B</b></button>
    <button class="tog ${target.italic ? 'on' : ''}" title="Italic"><i>I</i></button>
    <button class="tog tog-shadow ${target.shadow ? 'on' : ''}" title="Chunky shadow, like the Blooket logo"><b>S</b></button>
  </div>`);
  const [bold, italic, shadow] = $$('.tog', box);
  // Picking the Blooket font brings its shadow with it, like the real logo.
  $('select', box).onchange = (e) => {
    const blooket = e.target.value === BLOOKET_FONT;
    if (blooket) shadow.classList.add('on');
    apply({ fontFamily: e.target.value, ...(blooket ? { shadow: true } : {}) });
  };
  shadow.onclick = () => { shadow.classList.toggle('on'); apply({ shadow: shadow.classList.contains('on') }); };
  bold.onclick = () => { bold.classList.toggle('on'); apply({ bold: bold.classList.contains('on') }); };
  italic.onclick = () => { italic.classList.toggle('on'); apply({ italic: italic.classList.contains('on') }); };
  const wrap = html('<div class="font-wrap"></div>');
  wrap.append(box, slider({
    label: 'Size', value: target.fontSize, min: 6, max: 400, unit: 'px',
    onInput: (v) => apply({ fontSize: v }),
    onChange: () => apply({}, true),
  }));
  return wrap;
}

/* ---------- Selected panel ---------- */

function numberField(label, value, onInput) {
  const el = html(`<label class="num"><span>${label}</span><input type="number" value="${value}"></label>`);
  const input = $('input', el);
  input.oninput = () => { if (input.value !== '' && Number.isFinite(+input.value)) onInput(+input.value); };
  input.onchange = commit;
  return el;
}

function documentPanel(box) {
  const d = S.doc;
  box.append(html('<h3>Canvas</h3>'));
  box.append(html(`<p class="muted">${d.width} × ${d.height} px${d.animated ? ' · Animation' : ''}</p>`));
  box.append(colorButton({
    label: 'Background', value: d.bgGradient || d.background, allowNone: true, allowGradient: true,
    onInput: (c) => {
      const { fill, gradient } = paintPatch(c);
      d.background = fill;
      d.bgGradient = gradient;
      hooks.stage();
    },
    onDone: commit,
  }));
  box.append(slider({
    label: 'Round canvas corners', value: Math.round(d.cornerRadius || 0), min: 0, max: Math.floor(Math.min(d.width, d.height) / 2), unit: 'px',
    onInput: (v) => { d.cornerRadius = v; refreshFrameCorners(); },
    onChange: commit,
  }));
}

function refreshFrameCorners() {
  $('#frame').style.borderRadius = `${S.doc.cornerRadius * S.zoom}px`;
  hooks.stage();
}

// Pieces keep their differences: a faint shadow in a Blook stays fainter than
// the rest when the whole Blook fades.
function opacitySlider(items) {
  const start = items.map((o) => posed(o).opacity);
  const strongest = Math.max(...start);
  return slider({
    label: 'Opacity', value: Math.round(strongest * 100), min: 0, max: 100, unit: '%',
    onInput: (v) => {
      items.forEach((o, i) => edit(o, { opacity: strongest ? (start[i] / strongest) * (v / 100) : v / 100 }));
      liveRefresh();
    },
    onChange: commit,
  });
}

function arrangeRow() {
  const { atFront, atBack } = stackEnds();
  const row = html('<div class="arrange"></div>');
  const step = (label, name, where, off) => {
    const b = html(`<button class="arrange-btn" title="${label}" ${off ? 'disabled' : ''}>${icon(name)}<span>${label}</span></button>`);
    b.onclick = () => reorderSelection(where);
    return b;
  };
  row.append(
    step('Forward', 'forward', 'up', atFront),
    step('Backward', 'backward', 'down', atBack),
    html('<i></i>'),
    step('Front', 'front', 'front', atFront),
    step('Back', 'toback', 'back', atBack),
  );
  return row;
}

function selectedPanel() {
  const box = $('#inspector');
  box.innerHTML = '';
  const items = selected();
  if (!items.length) { documentPanel(box); return; }

  const single = items.length === 1 ? items[0] : null;
  box.append(html(`<h3>${single ? esc(single.name) : `${items.length} things picked`}</h3>`));
  if (canTakeApart()) box.append(button('Take apart', 'apart', takeApart, 'wide'));
  box.append(opacitySlider(items), arrangeRow());

  if (single) {
    const s = posed(single);
    const b = localBox(single.id);
    const grid = html('<div class="num-grid"></div>');
    const width = b ? Math.round(b.width * Math.abs(s.scaleX)) : 0;
    const height = b ? Math.round(b.height * Math.abs(s.scaleY)) : 0;
    grid.append(
      numberField('X', Math.round(s.x), (v) => { edit(single, { x: v }); liveRefresh(); }),
      numberField('Y', Math.round(s.y), (v) => { edit(single, { y: v }); liveRefresh(); }),
      numberField('Width', width, (v) => {
        if (b?.width && v > 0) { edit(single, { scaleX: Math.sign(s.scaleX || 1) * (v / b.width) }); liveRefresh(); }
      }),
      numberField('Height', height, (v) => {
        if (b?.height && v > 0) { edit(single, { scaleY: Math.sign(s.scaleY || 1) * (v / b.height) }); liveRefresh(); }
      }),
      numberField('Turn', Math.round(s.rotation), (v) => { edit(single, { rotation: v }); liveRefresh(); }),
    );
    box.append(grid);
  }

  const paintable = items.filter((o) => o.type !== 'image');
  if (paintable.length) {
    const first = posed(paintable[0]);
    const row = html('<div class="row"></div>');
    row.append(colorButton({
      label: 'Fill', value: first.gradient || first.fill, allowNone: true, allowGradient: true,
      onInput: (c) => { paintable.forEach((o) => edit(o, paintPatch(c))); liveRefresh(); },
      onDone: commit,
    }));
    row.append(colorButton({
      label: 'Outline', value: first.stroke, allowNone: true,
      onInput: (c) => {
        paintable.forEach((o) => edit(o, { stroke: c, strokeWidth: posed(o).strokeWidth || (c === 'none' ? 0 : 4) }));
        liveRefresh();
      },
      onDone: commit,
    }));
    box.append(row);
    box.append(slider({
      label: 'Outline size', value: Math.round(first.strokeWidth), min: 0, max: 200, unit: 'px',
      onInput: (v) => { paintable.forEach((o) => edit(o, { strokeWidth: v })); liveRefresh(); },
      onChange: commit,
    }));
  }

  if (single && hasCorners(posed(single))) box.append(roundingSlider(single));

  if (single?.type === 'text') {
    box.append(fontControls(single, (patch, done) => {
      Object.assign(single, patch);
      liveRefresh();
      if (done || !('fontSize' in patch)) commit();
    }));
  }

  const order = html('<div class="btn-grid"></div>');
  order.append(
    button('Flip sideways', 'flipx', () => flipSelection('x')),
    button('Flip up/down', 'flipy', () => flipSelection('y')),
    button('Copy', 'copy', duplicateSelection),
    button('Delete', 'trash', deleteSelection, 'danger'),
  );
  box.append(order);
}

/* ---------- Shapes catalog ---------- */

let search = '';

function catalogPanel() {
  const box = $('#catalog');
  box.hidden = S.tool !== 'shapes' || S.blooksOpen;
  if (box.hidden) return;
  if ($('.cat-search', box)) { renderCatalogGrid(); return; }
  box.innerHTML = `<div class="panel-head"><h3>Shapes</h3></div>
    <label class="cat-search">${icon('search')}<input placeholder="Find a shape" aria-label="Find a shape" value="${esc(search)}"></label>
    <div class="cat-grid"></div>`;
  $('input', box).oninput = (e) => { search = e.target.value.toLowerCase(); renderCatalogGrid(); };
  renderCatalogGrid();
}

const DRAG_START_PX = 6;
const DROPPED_SHAPE_SIZE = 0.25;

// Drag something out of a side panel and drop it anywhere on the canvas.
export function startPanelDrag(e, item, picture, onDrop) {
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  let ghost = null;
  const move = (ev) => {
    if (!ghost && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START_PX) return;
    ghost ??= document.body.appendChild(html(`<div class="shape-ghost">${picture}</div>`));
    ghost.style.left = `${ev.clientX}px`;
    ghost.style.top = `${ev.clientY}px`;
  };
  const up = (ev) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    if (!ghost) return;
    ghost.remove();
    item.dataset.dragged = '1';
    setTimeout(() => delete item.dataset.dragged, 0);
    const r = $('#wk').getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
    onDrop(toDoc(ev));
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

function dropShape(shape, p) {
  const size = Math.min(S.doc.width, S.doc.height) * DROPPED_SHAPE_SIZE;
  if (shape.id !== 'line') S.shape = shape;
  addShape(shape, p.x, p.y, size, size);
}

function renderCatalogGrid() {
  const grid = $('#catalog .cat-grid');
  grid.innerHTML = '';
  const groups = new Map();
  for (const shape of [...BASIC_SHAPES, ...PLUS_SHAPES, ...S.catalog]) {
    if (search && !`${shape.name} ${shape.category}`.toLowerCase().includes(search)) continue;
    if (!groups.has(shape.category)) groups.set(shape.category, []);
    groups.get(shape.category).push(shape);
  }
  if (!groups.size) grid.append(html('<p class="muted">No shapes match that.</p>'));
  for (const [category, shapes] of groups) {
    grid.append(html(`<h4>${esc(category)}</h4>`));
    const row = html('<div class="cat-row"></div>');
    for (const shape of shapes) {
      const locked = shape.plus && !isPlus();
      const b = html(`<button class="cat-item ${S.shape.id === shape.id ? 'on' : ''} ${locked ? 'locked' : ''}" title="${esc(shape.name)}">${shapeThumb(shape)}<span>${esc(shape.name)}</span>${locked ? '<em class="plus-badge">PLUS</em>' : ''}</button>`);
      b.onclick = async () => {
        if (b.dataset.dragged) { delete b.dataset.dragged; return; }
        if (locked) {
          if (await plusDialog(`${shape.name} is a Plus shape`)) { renderCatalogGrid(); }
          return;
        }
        if (shape.id === 'line') { setTool('line'); return; }
        S.shape = shape;
        renderCatalogGrid();
      };
      if (!locked) b.addEventListener('pointerdown', (e) => startPanelDrag(e, b, shapeThumb(shape), (p) => dropShape(shape, p)));
      row.append(b);
    }
    grid.append(row);
  }
}

/* ---------- Top-level ---------- */

const HINT_MS = 7000;
let hintFor = null, hintTimer = 0;

function showHint() {
  const el = $('#hint');
  if (hintFor === S.tool && el.textContent) return;
  hintFor = S.tool;
  el.textContent = TOOLS[S.tool].hint;
  el.classList.remove('gone');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.add('gone'), HINT_MS);
}

function toolbarState() {
  $$('#toolbar [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === S.tool));
  $$('.tool-pick').forEach((box, i) => {
    const pick = $('[data-tool]', box);
    const inGroup = TOOL_GROUPS[i].includes(S.tool);
    if (inGroup && pick.dataset.tool !== S.tool) {
      pick.dataset.tool = S.tool;
      pick.title = `${TOOLS[S.tool].label} (${TOOLS[S.tool].key})`;
      pick.innerHTML = `${icon(S.tool)}<span>${TOOLS[S.tool].label}</span>`;
    }
    pick.classList.toggle('on', inGroup);
  });
  $('#blookbtn').classList.toggle('on', S.blooksOpen && S.assetView === 'blooks');
  $('#uploadbtn').classList.toggle('on', S.blooksOpen && S.assetView === 'uploads');
}

export function drawPanels() {
  optionBar();
  selectedPanel();
  catalogPanel();
  drawBlooks();
  toolbarState();
  showHint();
  $('#undo').disabled = !canUndo();
  $('#redo').disabled = !canRedo();
  $('#zoomval').textContent = `${Math.round(S.zoom * 100)}%`;
}
