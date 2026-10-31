// Builds the editor screen and connects the top bar, keyboard and file drops.
import {
  S, hooks, openDoc, refresh, commit, undo, redo, persist, selected,
} from './state.js';
import { getDoc, getMeta } from './store.js';
import { mountStage, drawStage, drawOverlay, fitView, placeFrame, zoomAt } from './stage.js';
import {
  TOOLS, attachTools, setTool, setSpaceHeld, deleteSelection, deleteNodes, duplicateSelection,
  copySelection, pasteClipboard, nudge, addImageFromUrl, closeTextEditor,
} from './tools.js';
import { drawPanels } from './panels.js';
import { drawTimeline, setFrame, stop, togglePlay } from './timeline.js';
import { fetchCatalog } from './shapes.js';
import { exportSVG, esc } from './render.js';
import { $, icon, toast, dialog, readDataUrl } from './ui.js';

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
    <button class="btn primary" id="export">${icon('download')}<span>Export SVG</span></button>
    <input type="file" id="file" accept="image/*,.svg" hidden multiple>
  </header>
  <div class="ed-opts" id="opts"></div>
  <nav class="ed-tools" id="toolbar"></nav>
  <aside class="ed-catalog" id="catalog" hidden></aside>
  <main class="ed-stage" id="wk">
    <div id="frame"><svg id="art" xmlns="http://www.w3.org/2000/svg"></svg><svg id="overlay"></svg></div>
    <div id="brush" hidden></div>
    <div id="hint" class="hint"></div>
  </main>
  <aside class="ed-right">
    <section id="inspector" class="panel"></section>
    <section id="layers" class="panel"></section>
  </aside>
  <section class="ed-time" id="timeline" hidden></section>
</div>`;

let keyHandler = null, keyUpHandler = null, stageWatcher = null;

export async function closeEditor() {
  closeTextEditor();
  if (S.playing) stop();
  removeEventListener('keydown', keyHandler);
  removeEventListener('keyup', keyUpHandler);
  stageWatcher?.disconnect();
  const saving = persist();
  S.doc = null;
  await saving;
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
      x: () => { copySelection(); deleteSelection(); },
      a: () => {
        S.sel = new Set(S.doc.layers.filter((l) => l.visible && !l.locked).flatMap((l) => l.objects.map((o) => o.id)));
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
  if (e.key === 'Escape') { S.sel.clear(); S.nodeSel.clear(); refresh(); return; }
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
  const tool = Object.keys(TOOLS).find((t) => TOOLS[t].key.toLowerCase() === key);
  if (tool) setTool(tool);
}

function onKeyUp(e) {
  if (e.key === ' ') { setSpaceHeld(false); document.body.classList.remove('panning'); }
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportDialog() {
  const doc = S.doc;
  const safe = doc.name.replace(/[^\w -]+/g, '').trim() || 'art';
  dialog((box, close) => {
    box.innerHTML = `<h2>Export SVG</h2>
      <p class="muted">${doc.width} × ${doc.height} px. Hidden layers are left out.</p>
      <label class="field"><span>File name</span><input id="xname" value="${esc(safe)}" autofocus></label>
      ${doc.animated ? `<div class="choice-row">
        <label class="radio"><input type="radio" name="kind" value="anim" checked><span><b>Animated SVG</b><small>Plays and loops in any web browser</small></span></label>
        <label class="radio"><input type="radio" name="kind" value="frame"><span><b>Just this frame</b><small>A still picture of frame ${S.frame + 1}</small></span></label>
      </div>` : ''}
      <div class="dlg-actions">
        <button class="btn ghost" data-no>Cancel</button>
        <button class="btn primary" data-yes>${icon('download')}<span>Download</span></button>
      </div>`;
    $('[data-no]', box).onclick = () => close();
    $('[data-yes]', box).onclick = () => {
      const animate = doc.animated && $('[name=kind]:checked', box).value === 'anim';
      const name = ($('#xname', box).value.trim() || safe).replace(/\.svg$/i, '');
      download(`${name}.svg`, exportSVG(doc, { frame: S.frame, animate }));
      close();
      toast('Your SVG is downloading.', 'ok');
    };
  });
}

async function importFiles(files, x, y) {
  for (const file of files) {
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      toast(`${file.name} is not a picture.`, 'warn');
      continue;
    }
    try {
      await addImageFromUrl(await readDataUrl(file), x, y);
    } catch {
      toast(`${file.name} could not be opened.`, 'warn');
    }
  }
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
  bar.innerHTML = Object.entries(TOOLS).map(([id, t]) => `<button data-tool="${id}" title="${t.label} (${t.key})">${icon(id)}<span>${t.label}</span></button>`).join('');
  bar.onclick = (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
  };

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
  const doc = await getDoc(id);
  if (!doc) { location.hash = '#/'; toast('That project could not be found.', 'warn'); return; }
  const meta = await getMeta(id);
  openDoc(doc, meta?.thumb || null);
  root.innerHTML = TEMPLATE;
  document.title = `${doc.name} · Blook Maker`;
  S.tool = 'select';
  document.body.dataset.tool = 'select';

  hooks.stage = drawStage;
  hooks.overlay = drawOverlay;
  hooks.panels = drawPanels;
  hooks.timeline = drawTimeline;
  hooks.stop = stop;
  hooks.saved = (state) => {
    const el = $('#saved');
    if (el) el.textContent = state === 'saving' ? 'Saving…' : 'Saved';
  };

  mountStage(root);
  wireTop(root);
  attachTools($('#wk', root));
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
