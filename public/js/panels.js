// The option bar, the Selected panel, the Layers panel and the shapes catalog.
import {
  S, hooks, liveRefresh, commit, selected, posed, edit, canUndo, canRedo, paintPatch, setToolFill,
} from './state.js';
import { clone, pathBounds, localToWorld } from './model.js';
import { TEXTURES, MOVES, newTexture, kindLook, patternMarkup, texturesOf, bgTexturesOf } from './textures.js';
import { colorsIn, swapColor, pictureColors, recolorPictures, normalColor } from './recolor.js';
import { esc, newDropShadow, newAutoShadow, newUnderbelly, WARPS } from './render.js';
import { BASIC_SHAPES, MORE_SHAPES, shapeThumb } from './shapes.js';
import { localBox, worldBox, hasCorners, toDoc } from './stage.js';
import {
  TOOLS, TOOL_GROUPS, addShape, reorderSelection, flipSelection, duplicateSelection, deleteSelection, deleteNodes, setNodesKind, setTool,
  canTakeApart, takeApart, stackEnds, shapeLook, rememberSize, canRestoreSize, restoreSize, stretchItems, stretchStart, canWeld, weldSelection, canUnweld, unweldSelection, canGroup, canUngroup, groupSelection, ungroupSelection, autoSmooth, setAutoSmooth, smoothable, smoothLines,
} from './tools.js';
import { drawBlooks } from './blooks.js';
import { drawLayers } from './layers.js';
import { fontDialog } from './fonts.js';
import { canRemoveBackground, removeBackground } from './bg-remove.js';
import { TEMPLATES, overlayLook } from './templates.js';
import { $, $$, html, icon, swatch, colorPopover, readDataUrl, toast } from './ui.js';

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

// inside: for outlines, rounds the inner edge of each corner. The outline's
// centre needs half its width more rounding than that.
function roundingSlider(item, inside = false) {
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
  const half = inside ? s.strokeWidth / 2 : 0;
  const r = first ? s.subpaths[first[0]].nodes[first[1]].r || 0 : 0;
  const current = Math.round(Math.max(0, r - half));
  return slider({
    label: inside ? 'Round inside corners' : 'Round corners', value: current, min: 0, max,
    onInput: (v) => {
      const subpaths = clone(posed(item).subpaths);
      const width = inside ? posed(item).strokeWidth / 2 : 0;
      for (const [a, i] of nodes()) subpaths[a].nodes[i].r = v ? v + width : 0;
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
    if (canWeld()) add(button('Weld', 'weld', weldSelection));
    if (canRestoreSize()) add(button('Original size', 'undo', restoreSize));
  }
  if (tool === 'pencil' || tool === 'marker' || tool === 'eraser' || tool === 'line') {
    if (tool !== 'eraser') add(ink('stroke', 'Colour'));
    add(slider({ label: 'Size', value: S.sizes[tool], min: 1, max: 200, unit: 'px', onInput: (v) => { S.sizes[tool] = v; } }));
    if (tool === 'pencil' || tool === 'marker') {
      const auto = html(`<label class="check"><input type="checkbox" ${autoSmooth() ? 'checked' : ''}><span>Auto smooth</span></label>`);
      $('input', auto).onchange = (e) => setAutoSmooth(e.target.checked);
      add(auto);
    }
    if (tool === 'line') add(html('<span class="muted">To move a point later, use Vertices. To fill a closed line, use the Bucket.</span>'));
  } else if (tool === 'shapes') {
    // Shows the colours the next shape gets. Picking one stops copying the last shape.
    const look = shapeLook();
    const mine = () => {
      if (!S.lastShapeId) return;
      Object.assign(S, { fill: look.fill, fillGradient: look.gradient, stroke: look.stroke, shapeOutline: look.strokeWidth, lastShapeId: null });
    };
    add(
      colorButton({ label: 'Fill', value: look.gradient || look.fill, allowNone: true, allowGradient: true, onInput: (c) => { mine(); setToolFill(c); } }),
      colorButton({ label: 'Outline', value: look.stroke, onInput: (c) => { mine(); S.stroke = c; } }),
    );
    add(slider({ label: 'Outline size', value: look.strokeWidth, min: 0, max: 60, unit: 'px', onInput: (v) => { mine(); S.shapeOutline = v; } }));
  } else if (tool === 'bucket') {
    add(paint('Colour'));
  } else if (tool === 'text') {
    add(paint('Colour'));
    add(fontControls(S.font, (patch, done) => {
      Object.assign(S.font, patch);
      if ('warp' in patch && done) hooks.panels();
    }));
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

// The built-in fonts, then the ones this project added.
function fontChoices(current) {
  const added = (S.doc?.fonts || []).map((f) => [f.family, f.family]).filter(([f]) => !FONTS.some(([g]) => g === f));
  const list = [...FONTS, ...added];
  if (current && !list.some(([f]) => f === current)) list.push([current, current]);
  return list;
}

function fontControls(target, apply) {
  const box = html(`<div class="font-row">
    <select aria-label="Font">${fontChoices(target.fontFamily).map(([f, label]) => `<option value="${esc(f)}" ${f === target.fontFamily ? 'selected' : ''}>${esc(label)}</option>`).join('')}
      <option value="__more">More fonts…</option></select>
    <button class="tog ${target.bold ? 'on' : ''}" title="Bold"><b>B</b></button>
    <button class="tog ${target.italic ? 'on' : ''}" title="Italic"><i>I</i></button>
    <button class="tog tog-shadow ${target.shadow ? 'on' : ''}" title="Chunky shadow, like the Blooket logo"><b>S</b></button>
  </div>`);
  const [bold, italic, shadow] = $$('.tog', box);
  // Picking the Blooket font brings its shadow with it, like the real logo.
  $('select', box).onchange = async (e) => {
    if (e.target.value === '__more') {
      e.target.value = target.fontFamily;
      const family = await fontDialog(S.doc);
      if (family) { apply({ fontFamily: family }, true); commit(); hooks.panels(); }
      return;
    }
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
  }), textShapeControls(target, apply));
  return wrap;
}

const ALIGNS = [['left', 'Align left'], ['center', 'Centre'], ['right', 'Align right']];

// Alignment, and warps: Arc curves the text, the others move or size each letter.
function textShapeControls(target, apply) {
  const warp = { type: 'none', amount: 50, ...target.warp };
  const arc = warp.type === 'arc';
  const box = html(`<div class="text-shape">
    <div class="align-row ${arc ? 'off' : ''}" role="group" aria-label="Alignment">${ALIGNS.map(([a, label]) => `<button class="tog ${(target.align || 'center') === a ? 'on' : ''}" data-a="${a}" title="${label}" aria-label="${label}">${icon(`align${a}`)}</button>`).join('')}</div>
    <label class="warp-pick"><span>Warp</span><select>${Object.entries(WARPS).map(([k, label]) => `<option value="${k}" ${k === warp.type ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
  </div>`);
  $$('[data-a]', box).forEach((b) => {
    b.onclick = () => {
      $$('[data-a]', box).forEach((x) => x.classList.toggle('on', x === b));
      apply({ align: b.dataset.a }, true);
    };
  });
  $('select', box).onchange = (e) => apply({ warp: { ...warp, type: e.target.value } }, true);
  const wrap = html('<div class="text-shape-wrap"></div>');
  wrap.append(box);
  if (warp.type !== 'none') {
    wrap.append(slider({
      label: arc ? 'Curve (up or down)' : 'Strength', value: warp.amount, min: arc ? -100 : 0, max: 100,
      onInput: (v) => apply({ warp: { ...warp, amount: v } }), onChange: () => apply({}, true),
    }));
  }
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
  box.append(
    slider({ label: 'Background opacity', value: Math.round((d.bgOpacity ?? 1) * 100), min: 0, max: 100, unit: '%', onInput: (v) => { d.bgOpacity = v / 100; hooks.stage(); }, onChange: commit }),
    slider({ label: 'Background blur', value: d.bgBlur || 0, min: 0, max: 60, unit: 'px', onInput: (v) => { d.bgBlur = v; hooks.stage(); }, onChange: commit }),
    slider({ label: 'Background pixelate', value: d.bgPixel || 0, min: 0, max: 60, unit: 'px', onInput: (v) => { d.bgPixel = v < 2 ? 0 : v; hooks.stage(); }, onChange: commit }),
  );
  box.append(textureList(() => bgTexturesOf(d), (list) => { d.bgTextures = list; delete d.bgTexture; hooks.stage(); }, 'Background texture', d.bgGradient?.from || d.background));
  box.append(slider({
    label: 'Round canvas corners', value: Math.round(d.cornerRadius || 0), min: 0, max: Math.floor(Math.min(d.width, d.height) / 2), unit: 'px',
    onInput: (v) => { d.cornerRadius = v; refreshFrameCorners(); },
    onChange: commit,
  }));
  const overlay = TEMPLATES[d.template]?.overlay;
  if (overlay) {
    const row = html(`<label class="check"><input type="checkbox" ${d.overlay ? 'checked' : ''}><span>${overlay.name}</span></label>`);
    $('input', row).onchange = (e) => { d.overlay = e.target.checked; commit(); hooks.panels(); hooks.stage(); };
    box.append(row);
    if (d.overlay) {
      const look = overlayLook(d);
      box.append(
        colorButton({
          label: overlay.colorLabel, value: look.color,
          onInput: (c) => { d.overlayColor = c; hooks.stage(); }, onDone: commit,
        }),
        slider({
          label: overlay.sizeLabel, value: Math.round(look.size * 100), min: 10, max: overlay.maxSize * 100, unit: '%',
          onInput: (v) => { d.overlaySize = v / 100; hooks.stage(); }, onChange: commit,
        }),
        slider({
          label: overlay.strengthLabel, value: Math.round(look.strength * 100), min: 0, max: 100, unit: '%',
          onInput: (v) => { d.overlayStrength = v / 100; hooks.stage(); }, onChange: commit,
        }),
      );
    }
  }
  box.append(autoShadowControls(d));
  const layers = html(`<label class="check"><input type="checkbox" ${d.layersPanel ? 'checked' : ''}><span>Layers panel</span></label>`);
  $('input', layers).onchange = (e) => { d.layersPanel = e.target.checked; commit(); hooks.panels(); };
  box.append(layers);
}

// Shadows wherever pieces overlap, falling just past the top piece's edge.
function autoShadowControls(d) {
  const box = html(`<div class="shadow-box"><label class="check"><input type="checkbox" ${d.autoShadow?.on ? 'checked' : ''}><span>Auto shadow</span></label>
    <p class="muted small">Shades the spots where pieces overlap, so the piece on top looks like it sits on the one below.</p></div>`);
  $('input', box).onchange = (e) => {
    d.autoShadow = { ...newAutoShadow(), ...d.autoShadow, on: e.target.checked };
    commit();
    hooks.panels();
    hooks.stage();
  };
  if (d.autoShadow?.on) {
    const set = (patch) => { Object.assign(d.autoShadow, patch); hooks.stage(); };
    box.append(
      slider({ label: 'Strength', value: Math.round(d.autoShadow.strength * 100), min: 0, max: 100, unit: '%', onInput: (v) => set({ strength: v / 100 }), onChange: commit }),
      slider({ label: 'Size', value: d.autoShadow.size, min: 1, max: 60, unit: 'px', onInput: (v) => set({ size: v }), onChange: commit }),
      slider({ label: 'Softness', value: d.autoShadow.soft || 0, min: 0, max: 30, unit: 'px', onInput: (v) => set({ soft: v }), onChange: commit }),
    );
  }
  return box;
}

// A drop shadow under the picked art. A whole Blook casts one shadow together.
function dropShadowControls(items) {
  const first = items.find((o) => o.dropShadow);
  const box = html(`<div class="shadow-box"><label class="check"><input type="checkbox" ${first ? 'checked' : ''}><span>Shadow</span></label></div>`);
  $('input', box).onchange = (e) => {
    const s = e.target.checked ? { ...newDropShadow(), ...first?.dropShadow } : null;
    items.forEach((o) => { o.dropShadow = s && { ...s }; });
    commit();
    hooks.panels();
  };
  if (first) {
    const s = { ...newDropShadow(), ...first.dropShadow };
    const set = (patch) => { Object.assign(s, patch); items.forEach((o) => { o.dropShadow = { ...s }; }); liveRefresh(); };
    box.append(
      slider({ label: 'Darkness', value: Math.round(s.strength * 100), min: 0, max: 100, unit: '%', onInput: (v) => set({ strength: v / 100 }), onChange: commit }),
      slider({ label: 'Distance', value: s.distance, min: 0, max: 80, unit: 'px', onInput: (v) => set({ distance: v }), onChange: commit }),
      slider({ label: 'Softness', value: s.soft, min: 0, max: 40, unit: 'px', onInput: (v) => set({ soft: v }), onChange: commit }),
      slider({ label: 'Direction', value: s.angle, min: 0, max: 359, unit: '°', onInput: (v) => set({ angle: v }), onChange: commit }),
    );
  }
  return box;
}

// A see-through band along the bottom of whatever is picked, following its outline.
function underbellyControls(items) {
  const first = items.find((o) => o.underbelly);
  const box = html(`<div class="shadow-box"><label class="check"><input type="checkbox" ${first ? 'checked' : ''}><span>Underbelly</span></label>
    <p class="muted small">A see-through band along the bottom, following the outline. Works on shapes, pictures and text.</p></div>`);
  $('input', box).onchange = (e) => {
    const look = e.target.checked ? { ...newUnderbelly(), ...first?.underbelly } : null;
    items.forEach((o) => { o.underbelly = look && { ...look }; });
    commit();
    hooks.panels();
  };
  if (first) {
    const look = { ...newUnderbelly(), ...first.underbelly };
    const set = (patch) => { Object.assign(look, patch); items.forEach((o) => { o.underbelly = { ...look }; }); liveRefresh(); };
    box.append(
      colorButton({ label: 'Underbelly colour', value: look.color, onInput: (c) => set({ color: c }), onDone: commit }),
      slider({ label: 'Size', value: Math.round(look.size * 100), min: 10, max: 400, unit: '%', onInput: (v) => set({ size: v / 100 }), onChange: commit }),
      slider({ label: 'Opacity', value: Math.round(look.strength * 100), min: 0, max: 100, unit: '%', onInput: (v) => set({ strength: v / 100 }), onChange: commit }),
      slider({ label: 'Blur', value: look.blur || 0, min: 0, max: 30, unit: 'px', onInput: (v) => set({ blur: v }), onChange: commit }),
    );
  }
  return box;
}

// X, Y, Width and Height for several things at once, as if they were one shape.
function groupSizeFields(items) {
  const grid = html('<div class="num-grid"></div>');
  const box = worldBox(items.map((o) => o.id));
  if (!box) return grid;
  const start = () => items.map(stretchStart);
  const move = (dx, dy) => { for (const it of start()) edit(it.o, { x: it.x + dx, y: it.y + dy }); liveRefresh(); };
  let now = { ...box };
  const size = (fx, fy) => {
    items.forEach(rememberSize);
    stretchItems(start(), fx, fy, { x: now.x, y: now.y });
    now = { ...now, width: now.width * fx, height: now.height * fy };
    liveRefresh();
  };
  grid.append(
    numberField('X', Math.round(box.x), (v) => { move(v - now.x, 0); now.x = v; }),
    numberField('Y', Math.round(box.y), (v) => { move(0, v - now.y); now.y = v; }),
    numberField('Width', Math.round(box.width), (v) => { if (v > 0 && now.width) size(v / now.width, 1); }),
    numberField('Height', Math.round(box.height), (v) => { if (v > 0 && now.height) size(1, v / now.height); }),
  );
  return grid;
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

function blurSlider(items) {
  return slider({
    label: 'Blur', value: Math.round(Math.max(...items.map((o) => posed(o).blur || 0))), min: 0, max: 60, unit: 'px',
    onInput: (v) => { items.forEach((o) => edit(o, { blur: v })); liveRefresh(); },
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
  if (canWeld()) box.append(button('Weld into one shape', 'weld', weldSelection, 'wide'));
  if (canUnweld()) box.append(button('Unweld', 'apart', unweldSelection, 'wide'));
  if (canRemoveBackground()) box.append(button('Remove background', 'eraser', removeBackground, 'wide'));
  if (items.some(smoothable)) box.append(button('Smooth lines', 'smooth', () => { if (smoothLines(items)) commit(); }, 'wide'));
  if (canGroup() || canUngroup()) {
    const grouping = html('<div class="btn-grid"></div>');
    if (canGroup()) grouping.append(button('Group', 'group', groupSelection));
    if (canUngroup()) grouping.append(button('Ungroup', 'ungroup', ungroupSelection));
    box.append(grouping);
  }
  if (canTakeApart()) box.append(button('Take apart', 'apart', takeApart, 'wide'));
  box.append(opacitySlider(items), blurSlider(items), slider({
    label: 'Pixelate', value: Math.max(0, ...items.map((o) => o.pixel || 0)), min: 0, max: 60, unit: 'px',
    onInput: (v) => { items.forEach((o) => { o.pixel = v < 2 ? 0 : v; }); liveRefresh(); },
    onChange: commit,
  }), dropShadowControls(items), arrangeRow());
  box.append(underbellyControls(items));

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
        if (b?.width && v > 0) { rememberSize(single); edit(single, { scaleX: Math.sign(s.scaleX || 1) * (v / b.width) }); liveRefresh(); }
      }),
      numberField('Height', height, (v) => {
        if (b?.height && v > 0) { rememberSize(single); edit(single, { scaleY: Math.sign(s.scaleY || 1) * (v / b.height) }); liveRefresh(); }
      }),
      numberField('Turn', Math.round(s.rotation), (v) => { edit(single, { rotation: v }); liveRefresh(); }),
    );
    box.append(grid);
  } else {
    box.append(groupSizeFields(items));
  }

  const paintable = items.filter((o) => o.type !== 'image');
  if (paintable.length) {
    const first = posed(paintable[0]);
    const row = html('<div class="row"></div>');
    row.append(colorButton({
      label: 'Fill', value: first.gradient || first.fill, allowNone: true, allowGradient: true,
      onInput: (c) => {
        paintable.forEach((o) => {
          edit(o, paintPatch(c));
          o.parts?.forEach((p) => { if (p.type !== 'image') Object.assign(p, paintPatch(c)); });
        });
        liveRefresh();
      },
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
    }), slider({
      label: 'Fill opacity', value: Math.round((first.fillOpacity ?? 1) * 100), min: 0, max: 100, unit: '%',
      onInput: (v) => { paintable.forEach((o) => edit(o, { fillOpacity: v / 100 })); liveRefresh(); },
      onChange: commit,
    }), slider({
      label: 'Outline opacity', value: Math.round((first.strokeOpacity ?? 1) * 100), min: 0, max: 100, unit: '%',
      onInput: (v) => { paintable.forEach((o) => edit(o, { strokeOpacity: v / 100 })); liveRefresh(); },
      onChange: commit,
    }));
  }

  if (paintable.length) {
    const look = posed(paintable[0]);
    box.append(textureList(() => texturesOf(posed(paintable[0])), (list) => {
      paintable.forEach((o) => { o.textures = clone(list); delete o.texture; });
      liveRefresh();
    }, paintable.length > 1 ? 'Texture for all of these' : 'Texture', look.fill !== 'none' ? (look.gradient?.from || look.fill) : look.stroke));
  }
  box.append(colorSwaps(items));

  if (single && hasCorners(posed(single))) {
    box.append(roundingSlider(single));
    const s = posed(single);
    if (s.fill === 'none' && s.stroke !== 'none' && s.strokeWidth > 0) box.append(roundingSlider(single, true));
  }

  if (single?.type === 'text') {
    box.append(fontControls(single, (patch, done) => {
      // A new alignment keeps the text where it is: its anchor moves to that edge.
      if (patch.align && patch.align !== (single.align || 'center')) {
        const b = localBox(single.id), s = posed(single);
        if (b && (!single.warp || single.warp.type !== 'arc')) {
          const edge = { left: b.x, center: b.x + b.width / 2, right: b.x + b.width }[patch.align];
          edit(single, localToWorld(s, edge, 0));
        }
      }
      Object.assign(single, patch);
      liveRefresh();
      if (done || !('fontSize' in patch)) commit();
      if ('warp' in patch && done) hooks.panels();
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

/* ---------- Textures ---------- */

const TEXTURE_PICTURE_SIZE = 256;
const textureThumb = (kind) => (kind === 'none'
  ? '<svg viewBox="0 0 30 30"><path d="M6 24L24 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>'
  : `<svg viewBox="0 0 30 30"><defs>${patternMarkup({ ...newTexture(kind), color: '#43204f', size: kind === 'blooks' ? 30 : 10, opacity: 1 }, `thumb-${kind}`, null, 0)}</defs>${kind === 'picture'
    ? '<path d="M5 22l6-7 5 5 3-3 6 5M20 10a2 2 0 1 0 .1 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
    : `<rect width="30" height="30" fill="url(#thumb-${kind})"/>`}</svg>`);

async function smallPicture(file) {
  const img = new Image();
  img.src = await readDataUrl(file);
  await img.decode();
  const scale = Math.min(1, TEXTURE_PICTURE_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

// A new texture starts in black or white, whichever shows up on what's under it.
function contrastFor(color) {
  const hex = normalColor(color);
  if (!hex) return '#ffffff';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#000000' : '#ffffff';
}

// current() reads the texture now. apply(texture or null) sets it. under is the colour beneath.
function textureControls(current, apply, label, under, relist = null, remove = '') {
  const box = html('<div class="texture"></div>');
  const set = (patch, done) => {
    const tex = current();
    apply(patch === null ? null : { ...(tex || { ...newTexture(), color: contrastFor(under) }), ...patch });
    if (!done) return;
    commit();
    // Adding or taking away a texture changes the list, not just this one.
    if (relist && (patch === null || !tex)) relist(); else draw();
  };
  const draw = () => {
    const tex = current();
    const kind = tex?.kind || 'none';
    box.innerHTML = `<span class="sub tex-head"><span>${esc(label)}</span>${remove && tex ? `<button class="ib tex-x" title="${esc(remove)}" aria-label="${esc(remove)}">${icon('x')}</button>` : ''}</span>
      <div class="tex-pick">${['none', ...Object.keys(TEXTURES)].map((k) => `<button class="tex-btn ${k === kind ? 'on' : ''}" data-k="${k}" title="${k === 'none' ? 'No texture' : TEXTURES[k].name}" aria-label="${k === 'none' ? 'No texture' : TEXTURES[k].name}">${textureThumb(k)}</button>`).join('')}</div>
      <input type="file" accept="image/*,.svg" hidden>`;
    const file = $('input[type=file]', box);
    $('.tex-x', box)?.addEventListener('click', () => set(null, true));
    $$('.tex-btn', box).forEach((b) => {
      b.onclick = () => {
        if (b.dataset.k === 'none') set(null, true);
        else if (b.dataset.k === 'picture') file.click();
        else set({ kind: b.dataset.k, href: undefined, ...kindLook(b.dataset.k, S.doc.animated) }, true);
      };
    });
    file.onchange = async () => {
      const [picked] = file.files;
      file.value = '';
      if (!picked) return;
      try { set({ kind: 'picture', href: await smallPicture(picked) }, true); } catch { toast(`${picked.name} could not be opened.`, 'warn'); }
    };
    if (!tex) return;
    if (kind !== 'picture') box.append(colorButton({ label: 'Texture colour', value: tex.color, onInput: (c) => set({ color: c }), onDone: commit }));
    box.append(
      slider({ label: 'Size', value: tex.size, min: 6, max: 300, unit: 'px', onInput: (v) => set({ size: v }), onChange: commit }),
      slider({ label: 'Strength', value: Math.round(tex.opacity * 100), min: 5, max: 100, unit: '%', onInput: (v) => set({ opacity: v / 100 }), onChange: commit }),
      slider({ label: 'Turn', value: tex.angle, min: 0, max: 180, unit: '°', onInput: (v) => set({ angle: v }), onChange: commit }),
      slider({ label: 'Blur', value: tex.blur || 0, min: 0, max: 30, unit: 'px', onInput: (v) => set({ blur: v }), onChange: commit }),
    );
    if (S.doc.animated) {
      const moves = html(`<label class="tex-move"><span>Moves</span><select>${Object.entries(MOVES).map(([k, m]) => `<option value="${k}" ${k === tex.move ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
        <select aria-label="Speed" ${tex.move === 'none' ? 'disabled' : ''}>${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === tex.speed ? 'selected' : ''}>${['Slow', 'Steady', 'Fast', 'Very fast'][n - 1]}</option>`).join('')}</select></label>`);
      const [where, speed] = $$('select', moves);
      where.onchange = () => set({ move: where.value }, true);
      speed.onchange = () => set({ speed: +speed.value }, true);
      box.append(moves);
    }
  };
  draw();
  return box;
}

// Any number of textures, drawn over each other in order. get/put read and
// write the list; under is the colour beneath, for a new texture's colour.
function textureList(get, put, label, under) {
  const box = html('<div class="texture-list"></div>');
  let adding = false;
  const draw = () => {
    box.innerHTML = '';
    const list = get();
    const name = (i) => (list.length + (adding ? 1 : 0) > 1 ? `${label} ${i + 1}` : label);
    list.forEach((_, i) => {
      box.append(textureControls(() => get()[i], (next) => {
        const now = [...get()];
        if (next) now[i] = next; else now.splice(i, 1);
        put(now);
      }, name(i), under, draw, 'Remove this texture'));
    });
    if (!list.length || adding) {
      box.append(textureControls(() => null, (next) => {
        if (!next) { adding = false; return; }
        adding = false;
        put([...get(), next]);
      }, name(list.length), under, draw));
    } else {
      box.append(button('Add another texture', 'plus', () => { adding = true; draw(); }, 'wide'));
    }
  };
  draw();
  return box;
}

/* ---------- Swapping colours ---------- */

const pictureCache = new Map();

// Every colour in the picked art. Click one to change it everywhere at once.
function colorSwaps(items) {
  const box = html('<div class="swaps"><span class="sub">Swap colours</span><div class="swap-row"></div></div>');
  const row = $('.swap-row', box);
  const add = (color, picture) => {
    let now = color;
    const b = html(`<button class="swap" title="Change ${color}">${swatch(color)}</button>`);
    b.onclick = () => colorPopover(b, {
      value: now,
      onInput: (c) => {
        if (!picture) { swapColor(items, now, c); liveRefresh(); }
        now = c;
        b.innerHTML = swatch(c);
      },
      onDone: async () => {
        if (picture && now !== color) {
          try { await recolorPictures(items, color, now); } catch { toast('That picture could not be recoloured.', 'warn'); }
          liveRefresh();
        }
        commit();
      },
    });
    row.append(b);
  };
  colorsIn(items).forEach((c) => add(c, false));
  const pictures = items.filter((o) => o.type === 'image');
  if (pictures.length) {
    const key = pictures.map((o) => o.href.length + o.href.slice(-64)).join('|');
    const ready = pictureCache.get(key) || pictureColors(pictures).catch(() => []);
    if (pictureCache.size > 20) pictureCache.clear();
    pictureCache.set(key, ready);
    ready.then((colors) => colors.forEach((c) => add(c, true)));
  }
  if (!row.children.length && !pictures.length) return html('<span></span>');
  return box;
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
  for (const shape of [...BASIC_SHAPES, ...MORE_SHAPES, ...S.catalog]) {
    if (search && !`${shape.name} ${shape.category}`.toLowerCase().includes(search)) continue;
    if (!groups.has(shape.category)) groups.set(shape.category, []);
    groups.get(shape.category).push(shape);
  }
  if (!groups.size) grid.append(html('<p class="muted">No shapes match that.</p>'));
  for (const [category, shapes] of groups) {
    grid.append(html(`<h4>${esc(category)}</h4>`));
    const row = html('<div class="cat-row"></div>');
    for (const shape of shapes) {
      const b = html(`<button class="cat-item ${S.shape.id === shape.id ? 'on' : ''}" title="${esc(shape.name)}">${shapeThumb(shape)}<span>${esc(shape.name)}</span></button>`);
      b.onclick = () => {
        if (b.dataset.dragged) { delete b.dataset.dragged; return; }
        if (shape.id === 'line') { setTool('line'); return; }
        S.shape = shape;
        renderCatalogGrid();
      };
      b.addEventListener('pointerdown', (e) => startPanelDrag(e, b, shapeThumb(shape), (p) => dropShape(shape, p)));
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
      pick.dataset.tip = `${TOOLS[S.tool].label} (${TOOLS[S.tool].key})`;
      pick.setAttribute('aria-label', pick.dataset.tip);
      pick.innerHTML = icon(S.tool);
    }
    pick.classList.toggle('on', inGroup);
  });
  $('#blookbtn').classList.toggle('on', S.blooksOpen && S.assetView === 'blooks');
  $('#uploadbtn').classList.toggle('on', S.blooksOpen && S.assetView === 'uploads');
}

let panelFor = null;

export function drawPanels() {
  optionBar();
  const inspector = $('#inspector'), layersBox = $('#layers');
  const same = panelFor === [...S.sel].join();
  const keep = [inspector?.scrollTop || 0, layersBox?.scrollTop || 0];
  selectedPanel();
  panelFor = [...S.sel].join();
  if (same && inspector) inspector.scrollTop = keep[0];
  drawLayers();
  if (layersBox) layersBox.scrollTop = keep[1];
  catalogPanel();
  drawBlooks();
  toolbarState();
  showHint();
  $('#undo').disabled = !canUndo();
  $('#redo').disabled = !canRedo();
  $('#zoomval').textContent = `${Math.round(S.zoom * 100)}%`;
}
