// Builds the editor screen and connects the top bar, keyboard and file drops.
import {
  S, hooks, openDoc, refresh, commit, undo, redo, persist, selected, visibleObjects,
} from './state.js';
import { getDoc, getMeta } from './store.js';
import { mountStage, drawStage, drawOverlay, fitView, placeFrame, zoomAt } from './stage.js';
import {
  TOOLS, TOOL_GROUPS, attachTools, setTool, setSpaceHeld, deleteSelection, deleteNodes, duplicateSelection,
  copySelection, pasteClipboard, nudge, addImageFromUrl, addShape, closeTextEditor, flipSelection, reorderSelection,
  finishLine, cancelLine, lineInProgress,
} from './tools.js';
import { toggleBlooks, addPictureApart } from './blooks.js';
import { mountSplits } from './splits.js';
import { drawPanels } from './panels.js';
import { drawTimeline, setFrame, stop, togglePlay } from './timeline.js';
import { fetchCatalog } from './shapes.js';
import { esc } from './render.js';
import { exportDialog } from './export.js';
import { checkOverflow, resetFitPrompt } from './fit.js';
import { imageToShape } from './trace.js';
import { session } from './session.js';
import { syncArt, flushUploads, syncStatus } from './sync.js';
import { pathD, pathBounds } from './model.js';
import { $, $$, icon, menu, toast, dialog, readDataUrl } from './ui.js';

const TEMPLATE = `
<div class="ed">
  <header class="ed-top">
    <a class="btn ghost" href="#/" id="back">${icon('back')}<span>My art</span></a>
    <input id="docname" class="doc-name" maxlength="80" aria-label="Project name">
    <span id="saved" class="saved"></span>
    <div class="grow"></div>
    <div class="group">
      <button class="ib" id="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${icon('undo')}</button>
      <button class="ib" id="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${icon('redo')}</button>
    </div>
    <div class="group">
      <button class="ib" id="zoomout" title="Zoom out" aria-label="Zoom out">${icon('minus')}</button>
      <button class="zoomval" id="zoomval" title="Fit to screen"></button>
      <button class="ib" id="zoomin" title="Zoom in" aria-label="Zoom in">${icon('plus')}</button>
    </div>
    <button class="btn ghost" id="import">${icon('image')}<span>Add picture</span></button>
    <button class="btn primary" id="export">${icon('download')}<span>Export</span></button>
    <input type="file" id="file" accept="image/*,.svg" hidden multiple>
  </header>
  <div class="ed-opts" id="opts"></div>
  <nav class="ed-tools" id="toolbar"></nav>
  <aside class="ed-catalog" id="catalog" hidden></aside>
  <aside class="ed-catalog" id="blooks" hidden></aside>
  <main class="ed-stage" id="wk">
    <div id="frame"><svg id="art" xmlns="http://www.w3.org/2000/svg"></svg><svg id="overlay"></svg></div>
    <div id="brush" hidden></div>
    <div id="hint" class="hint"></div>
    <div id="fitask" class="fit-ask" role="alertdialog" hidden></div>
  </main>
  <aside class="ed-right">
    <section id="inspector" class="panel"></section>
  </aside>
  <section class="ed-time" id="timeline" hidden></section>
  <div class="split split-side" data-split="side" title="Drag to resize. Double-click to reset."></div>
  <div class="split split-right" data-split="right" title="Drag to resize. Double-click to reset."></div>
  <div class="split split-time" data-split="time" title="Drag to resize. Double-click to reset."></div>
</div>`;

let keyHandler = null, keyUpHandler = null, stageWatcher = null;

export async function closeEditor() {
  closeTextEditor();
  cancelLine();
  if (S.playing) stop();
  removeEventListener('keydown', keyHandler);
  removeEventListener('keyup', keyUpHandler);
  stageWatcher?.disconnect();
  const saving = persist();
  S.doc = null;
  syncStatus.changed = () => {};
  await saving;
  flushUploads();
}

// Keeps the art in view when a panel opens or the window resizes. If you have
// zoomed or panned by hand, the view stays as you left it.
function watchStage(wk) {
  let { width, height } = wk.getBoundingClientRect();
  stageWatcher = new ResizeObserver(() => {
    const r = wk.getBoundingClientRect();
    if (!S.doc || (r.width === width && r.height === height)) return;
    S.panX += (r.width - width) / 2;
    S.panY += (r.height - height) / 2;
    width = r.width;
    height = r.height;
    if (S.fitted) fitView();
    else placeFrame();
    drawOverlay();
    $('#zoomval').textContent = `${Math.round(S.zoom * 100)}%`;
  });
  stageWatcher.observe(wk);
}

const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

function onKey(e) {
  if (typing(e)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl) {
    const actions = {
      z: () => (e.shiftKey ? redo() : undo()), y: redo, d: duplicateSelection,
      c: copySelection, v: pasteClipboard, s: persist,
      ']': () => reorderSelection('up'), '[': () => reorderSelection('down'),
      '}': () => reorderSelection('front'), '{': () => reorderSelection('back'),
      x: () => { copySelection(); deleteSelection(); },
      a: () => {
        S.sel = new Set(visibleObjects().map((o) => o.id));
        refresh();
      },
    };
    if (actions[key]) { e.preventDefault(); actions[key](); }
    return;
  }
  if (e.key === ' ') { e.preventDefault(); setSpaceHeld(true); document.body.classList.add('panning'); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (S.tool === 'vertices' && deleteNodes()) return;
    deleteSelection();
    return;
  }
  if (e.key === 'Escape') {
    if (lineInProgress()) { cancelLine(); return; }
    S.sel.clear(); S.nodeSel.clear(); refresh(); return;
  }
  if (e.key === 'Enter' && lineInProgress()) { finishLine(); return; }
  if (e.key === 'Enter' && S.doc.animated) { togglePlay(); return; }
  if (e.key === ',' && S.doc.animated) { setFrame(S.frame - 1); return; }
  if (e.key === '.' && S.doc.animated) { setFrame(S.frame + 1); return; }
  if (e.key === '[' || e.key === ']') {
    if (S.sizes[S.tool]) {
      S.sizes[S.tool] = Math.max(1, S.sizes[S.tool] + (e.key === ']' ? 2 : -2));
      drawPanels();
    }
    return;
  }
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (arrow && selected().length) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    nudge(arrow[0] * step, arrow[1] * step);
    return;
  }
  if (e.shiftKey && (key === 'h' || key === 'v') && selected().length) { flipSelection(key === 'h' ? 'x' : 'y'); return; }
  const tool = Object.keys(TOOLS).find((t) => TOOLS[t].key.toLowerCase() === key);
  if (tool) setTool(tool);
}

function onKeyUp(e) {
  if (e.key === ' ') { setSpaceHeld(false); document.body.classList.remove('panning'); }
}

const TRACED_SHAPE_SIZE = 0.6;

// Asks whether a picture stays a picture or becomes a shape with its real outline.
async function pictureChoice(file, href) {
  const traced = await imageToShape(href).catch((error) => ({ error: error.message }));
  return dialog((box, close) => {
    box.innerHTML = `<h2>What should we do with this picture?</h2>
      <div class="pic-choices">
        <button class="pic-choice" data-c="picture"><span class="pic-art"><img src="${esc(href)}" alt=""></span><b>Keep it as a picture</b><small>Looks exactly like the file</small></button>
        <button class="pic-choice" data-c="shape" ${traced.error ? 'disabled' : ''}>
          <span class="pic-art">${traced.error ? '' : `<svg viewBox="-56 -56 112 112"><path d="${pathD(traced.subpaths)}" fill="currentColor" fill-rule="evenodd"/></svg>`}</span>
          <b>Turn it into a shape</b><small>${traced.error ? esc(traced.error) : 'Same outline, ready to colour and warp'}</small>
        </button>
        <button class="pic-choice" data-c="apart"><span class="pic-art">${icon('apart')}</span><b>Take it apart</b><small>Every piece moves on its own</small></button>
      </div>
      <div class="dlg-actions"><button class="btn ghost" data-no>Cancel</button></div>`;
    $('[data-no]', box).onclick = () => close();
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (b && !b.disabled) close({ kind: b.dataset.c, traced });
    });
  }, { wide: true });
}

function addTracedShape(file, traced, x, y) {
  const b = pathBounds(traced.subpaths);
  const scale = (Math.min(S.doc.width, S.doc.height) * TRACED_SHAPE_SIZE) / Math.max(b.width, b.height);
  const shape = { ...traced, name: file.name.replace(/\.[^.]+$/, '') };
  addShape(shape, x ?? S.doc.width / 2, y ?? S.doc.height / 2, b.width * scale, b.height * scale);
}

async function importFiles(files, x, y) {
  for (const file of files) {
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      toast(`${file.name} is not a picture.`, 'warn');
      continue;
    }
    try {
      const href = await readDataUrl(file);
      const choice = await pictureChoice(file, href);
      if (choice?.kind === 'picture') await addImageFromUrl(href, x, y);
      if (choice?.kind === 'shape') addTracedShape(file, choice.traced, x, y);
      if (choice?.kind === 'apart') await addPictureApart(href, file.name.replace(/\.[^.]+$/, ''), x, y);
    } catch {
      toast(`${file.name} could not be opened.`, 'warn');
    }
  }
}

// The toolbar scrolls, which would cut off a CSS tooltip, so one floats on the page.
function showTips(bar) {
  const tipEl = document.createElement('div');
  tipEl.className = 'tool-tip';
  tipEl.hidden = true;
  bar.closest('.ed').append(tipEl);
  bar.addEventListener('pointerover', (e) => {
    const b = e.target.closest('[data-tip]');
    if (!b) return;
    const r = b.getBoundingClientRect();
    tipEl.textContent = b.dataset.tip;
    Object.assign(tipEl.style, { left: `${r.right + 8}px`, top: `${r.top + r.height / 2}px` });
    tipEl.hidden = false;
  });
  bar.addEventListener('pointerout', (e) => { if (!e.relatedTarget?.closest?.('[data-tip]')) tipEl.hidden = true; });
  bar.addEventListener('pointerdown', () => { tipEl.hidden = true; });
}

function wireTop(root) {
  const doc = S.doc;
  const name = $('#docname', root);
  name.value = doc.name;
  name.onchange = () => { S.doc.name = name.value.trim() || 'Untitled'; name.value = S.doc.name; commit(); };
  name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };

  $('#undo', root).onclick = undo;
  $('#redo', root).onclick = redo;
  const zoomBy = (f) => { zoomAt(S.zoom * f); refresh(); };
  $('#zoomin', root).onclick = () => zoomBy(1.25);
  $('#zoomout', root).onclick = () => zoomBy(0.8);
  $('#zoomval', root).onclick = () => { fitView(); refresh(); };
  $('#export', root).onclick = exportDialog;
  const file = $('#file', root);
  $('#import', root).onclick = () => file.click();
  file.onchange = () => { importFiles([...file.files]); file.value = ''; };

  const bar = $('#toolbar', root);
  const others = Object.entries(TOOLS).filter(([id]) => !TOOL_GROUPS.flat().includes(id));
  // Just icons. Hovering one says what it is.
  const tip = (label) => `data-tip="${label}" aria-label="${label}"`;
  const toolGroup = ([id]) => `<div class="tool-pick">
      <button data-tool="${id}" ${tip(`${TOOLS[id].label} (${TOOLS[id].key})`)}>${icon(id)}</button>
      <button class="tool-more" ${tip('More tools')} aria-haspopup="menu">${icon('caret')}</button>
    </div>`;
  bar.innerHTML = `${TOOL_GROUPS.map(toolGroup).join('')}
    ${others.map(([id, t]) => `<button data-tool="${id}" ${tip(`${t.label} (${t.key})`)}>${icon(id)}</button>`).join('')}
    <button id="blookbtn" ${tip('Assets')}>${icon('file')}</button>
    <button id="uploadbtn" ${tip('Uploaded assets')}>${icon('upload')}</button>`;
  showTips(bar);
  bar.onclick = (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
  };
  $('#blookbtn', root).onclick = () => toggleBlooks('blooks');
  $('#uploadbtn', root).onclick = () => toggleBlooks('uploads');
  $$('.tool-more', root).forEach((more, i) => {
    more.onclick = () => {
      const r = more.getBoundingClientRect();
      const beside = { getBoundingClientRect: () => ({ left: r.right, right: r.right + 200, top: r.top, bottom: r.top }) };
      menu(beside, TOOL_GROUPS[i].map((id) => ({ label: `${TOOLS[id].label} (${TOOLS[id].key})`, icon: id, onClick: () => setTool(id) })));
    };
  });

  const wk = $('#wk', root);
  wk.addEventListener('dragover', (e) => { e.preventDefault(); wk.classList.add('dropping'); });
  wk.addEventListener('dragleave', () => wk.classList.remove('dropping'));
  wk.addEventListener('drop', (e) => {
    e.preventDefault();
    wk.classList.remove('dropping');
    const r = $('#art').getBoundingClientRect();
    importFiles([...e.dataTransfer.files], (e.clientX - r.left) / S.zoom, (e.clientY - r.top) / S.zoom);
  });
}

export async function openEditor(root, id) {
  let doc = await getDoc(id);
  if (!doc && session.user) {
    await syncArt();
    doc = await getDoc(id);
  }
  if (!doc) { location.hash = '#/'; toast('That project could not be found.', 'warn'); return; }
  const meta = await getMeta(id);
  openDoc(doc, meta?.thumb || null);
  root.innerHTML = TEMPLATE;
  document.title = `${doc.name} · Blook Berry`;
  S.tool = 'select';
  document.body.dataset.tool = 'select';

  hooks.stage = drawStage;
  hooks.overlay = drawOverlay;
  hooks.panels = drawPanels;
  hooks.timeline = drawTimeline;
  hooks.stop = stop;
  hooks.committed = checkOverflow;
  resetFitPrompt();
  hooks.saved = (state) => {
    const el = $('#saved');
    if (!el) return;
    if (session.guest) el.textContent = 'Guest: not saved';
    else el.textContent = state === 'saving' ? 'Saving…' : syncStatus.label();
  };
  syncStatus.changed = () => hooks.saved('saved');

  mountStage(root);
  wireTop(root);
  attachTools($('#wk', root));
  mountSplits(root);
  drawTimeline();
  placeFrame();
  fitView();
  refresh();
  hooks.saved('saved');

  keyHandler = onKey;
  keyUpHandler = onKeyUp;
  addEventListener('keydown', keyHandler);
  addEventListener('keyup', keyUpHandler);
  watchStage($('#wk', root));

  S.catalog = await fetchCatalog();
  drawPanels();
}
