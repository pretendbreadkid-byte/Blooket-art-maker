// The animation timeline: playback, the frame ruler and keyframe diamonds.
import { S, hooks, commit, refresh, activeLayer, selected, select } from './state.js';
import {
  EASINGS, addKey, removeKey, moveKey, clamp, clone, isPages, loopBack, loopPagesBack, addPage, removePage, movePage,
} from './model.js';
import { esc, layersMarkup } from './render.js';
import { $, $$, html, icon, menu, toast } from './ui.js';

const CELL = 16;
const MAX_FRAMES = 1000;
const MAX_PAGES = 300;
let raf = 0;
let draggingPage = null;

export function setFrame(f) {
  const next = clamp(Math.round(f), 0, S.doc.frames - 1);
  const newPage = isPages(S.doc) && next !== S.frame;
  S.frame = next;
  if (newPage) {
    S.sel.clear();
    S.nodeSel.clear();
    hooks.panels();
  }
  hooks.stage();
  hooks.overlay();
  placePlayhead();
}

function placePlayhead() {
  const label = $('#framelabel');
  if (label) label.textContent = `${S.frame + 1} / ${S.doc.frames}`;
  $$('.page-card').forEach((card, i) => card.classList.toggle('on', i === S.frame));
  const head = $('#playhead');
  if (head) head.style.transform = `translateX(${S.frame * CELL}px)`;
}

export function stop() {
  S.playing = false;
  cancelAnimationFrame(raf);
  drawTimeline();
  hooks.panels();
}

export function togglePlay() {
  if (S.playing) { stop(); return; }
  S.playing = true;
  S.sel.clear();
  hooks.overlay();
  hooks.panels();
  drawTimeline();
  const start = performance.now() - (S.frame / S.doc.fps) * 1000;
  const tick = (now) => {
    if (!S.playing) return;
    const f = Math.floor(((now - start) / 1000) * S.doc.fps) % S.doc.frames;
    if (f !== S.frame) { S.frame = f; hooks.stage(); placePlayhead(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function keyAtPlayhead() {
  return selected().flatMap((o) => o.keys.filter((k) => k.f === S.frame).map((k) => ({ o, k })));
}

function addKeyHere() {
  const items = selected();
  if (!items.length) { toast('Pick something on the canvas first.'); return; }
  for (const o of items) {
    if (!o.keys.length && S.frame !== 0) addKey(o, 0);
    addKey(o, S.frame);
  }
  commit();
}

function removeKeyHere() {
  const hits = keyAtPlayhead();
  if (!hits.length) { toast('There is no keyframe on this frame for what you picked.'); return; }
  hits.forEach(({ o, k }) => removeKey(o, k.f));
  commit();
}

// Sends what is picked back the way it came. With nothing picked, everything goes.
export function loopSelection() {
  const items = S.sel.size ? selected() : S.doc.layers.flatMap((l) => l.objects);
  const trial = clone(items);
  const end = loopBack(trial);
  if (end === null) { toast('Animate it first: move it on a later frame, then loop it back.'); return; }
  if (end + 1 > MAX_FRAMES) { toast(`That would need more than ${MAX_FRAMES} frames.`, 'warn'); return; }
  loopBack(items);
  S.doc.frames = Math.max(S.doc.frames, end + 1);
  commit();
  toast('It now goes back to the beginning.', 'ok');
}

function setEase(value) {
  keyAtPlayhead().forEach(({ k }) => { k.ease = value; });
  commit();
}

function scrubFrom(e) {
  const rail = $('#rail');
  const seek = (ev) => {
    const r = rail.getBoundingClientRect();
    setFrame((ev.clientX - r.left - CELL / 2) / CELL);
  };
  seek(e);
  const onMove = (ev) => seek(ev);
  const onUp = () => {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    hooks.panels();
    drawTimeline();
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
}

function dragKey(e, obj, key) {
  e.stopPropagation();
  select([obj.id]);
  setFrame(key.f);
  hooks.panels();
  const el = e.currentTarget;
  const startX = e.clientX, startF = key.f;
  let current = key.f;
  const onMove = (ev) => {
    const to = clamp(startF + Math.round((ev.clientX - startX) / CELL), 0, S.doc.frames - 1);
    if (to !== current && moveKey(obj, current, to)) {
      current = to;
      el.style.left = `${to * CELL + CELL / 2}px`;
      setFrame(to);
    }
  };
  const onUp = () => {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    commit();
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
}

function header() {
  const d = S.doc;
  const here = keyAtPlayhead();
  const ease = here[0]?.k.ease || 'ease';
  const bar = html(`<div class="time-bar">
    <div class="time-play">
      <button class="ib" data-a="first" title="Back to the start">${icon('first')}</button>
      <button class="ib" data-a="prev" title="Previous frame (,)">${icon('prev')}</button>
      <button class="play" data-a="play" title="${S.playing ? 'Pause' : 'Play'} (Enter)">${icon(S.playing ? 'pause' : 'play')}</button>
      <button class="ib" data-a="next" title="Next frame (.)">${icon('next')}</button>
      <span class="frame-label">Frame <b id="framelabel">${S.frame + 1} / ${d.frames}</b></span>
    </div>
    <div class="time-keys">
      <button class="chip" data-a="key">${icon('diamond')}<span>Add keyframe</span></button>
      <button class="chip" data-a="unkey">${icon('x')}<span>Remove</span></button>
      <button class="chip" data-a="loop" title="Plays it backwards after it finishes">${icon('loop')}<span>Loop back</span></button>
      <label class="ease ${here.length ? '' : 'off'}"><span>Motion</span>
        <select data-a="ease" ${here.length ? '' : 'disabled'}>${Object.entries(EASINGS).map(([k, v]) => `<option value="${k}" ${k === ease ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
      </label>
    </div>
    <div class="time-set">
      <button class="chip ${S.onion ? 'on' : ''}" data-a="onion" title="See a faint copy of the frame before">${icon('onion')}<span>Ghost</span></button>
      <label class="num mini"><span>Speed (frames per second)</span><input type="number" min="1" max="60" value="${d.fps}" data-a="fps"></label>
      <label class="num mini"><span>Frames</span><input type="number" min="2" max="1000" value="${d.frames}" data-a="frames"></label>
    </div>
  </div>`);
  bar.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'play') togglePlay();
    if (a === 'first') setFrame(0);
    if (a === 'prev') setFrame(S.frame - 1);
    if (a === 'next') setFrame(S.frame + 1);
    if (a === 'key') addKeyHere();
    if (a === 'unkey') removeKeyHere();
    if (a === 'loop') loopSelection();
    if (a === 'onion') { S.onion = !S.onion; hooks.stage(); drawTimeline(); }
  });
  $('[data-a=ease]', bar).onchange = (e) => setEase(e.target.value);
  $('[data-a=fps]', bar).onchange = (e) => { d.fps = clamp(Math.round(+e.target.value) || 12, 1, 60); commit(); };
  $('[data-a=frames]', bar).onchange = (e) => {
    d.frames = clamp(Math.round(+e.target.value) || 48, 2, 1000);
    S.frame = Math.min(S.frame, d.frames - 1);
    commit();
  };
  return bar;
}

/* ---------- Pages ---------- */

function newPageAfter(index, copyFrom = null) {
  if (S.doc.pages.length >= MAX_PAGES) { toast(`A project can have up to ${MAX_PAGES} pages.`, 'warn'); return; }
  const at = addPage(S.doc, index, copyFrom);
  commit();
  setFrame(at);
}

function deletePage(index) {
  if (!removePage(S.doc, index)) { toast('You need at least one page.', 'warn'); return; }
  S.sel.clear();
  S.frame = Math.min(S.frame, S.doc.frames - 1);
  commit();
}

function loopPages() {
  if (S.doc.pages.length < 2) { toast('Add another page first.'); return; }
  if (S.doc.pages.length * 2 - 1 > MAX_PAGES) { toast(`A project can have up to ${MAX_PAGES} pages.`, 'warn'); return; }
  loopPagesBack(S.doc);
  commit();
  toast('The pages now flip back to the beginning.', 'ok');
}

function pageMenu(e, index) {
  e.preventDefault();
  const at = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX + 190, top: e.clientY, bottom: e.clientY }) };
  menu(at, [
    { label: 'Copy this page', icon: 'copy', onClick: () => newPageAfter(index, index) },
    { label: 'New blank page', icon: 'plus', onClick: () => newPageAfter(index) },
    { label: 'Loop back to beginning', icon: 'loop', onClick: loopPages },
    null,
    { label: 'Delete page', icon: 'trash', danger: true, onClick: () => deletePage(index) },
  ]);
}

function pageHeader() {
  const d = S.doc;
  const bar = html(`<div class="time-bar">
    <div class="time-play">
      <button class="ib" data-a="first" title="Back to the start">${icon('first')}</button>
      <button class="ib" data-a="prev" title="Previous page (,)">${icon('prev')}</button>
      <button class="play" data-a="play" title="${S.playing ? 'Pause' : 'Play'} (Enter)">${icon(S.playing ? 'pause' : 'play')}</button>
      <button class="ib" data-a="next" title="Next page (.)">${icon('next')}</button>
      <span class="frame-label">Page <b id="framelabel">${S.frame + 1} / ${d.frames}</b></span>
    </div>
    <div class="time-keys">
      <button class="chip" data-a="add">${icon('plus')}<span>New page</span></button>
      <button class="chip" data-a="copy">${icon('copy')}<span>Copy page</span></button>
      <button class="chip" data-a="drop">${icon('trash')}<span>Delete page</span></button>
      <button class="chip" data-a="loop" title="Adds the pages again in reverse">${icon('loop')}<span>Loop back</span></button>
    </div>
    <div class="time-set">
      <button class="chip ${S.onion ? 'on' : ''}" data-a="onion" title="See a faint copy of the page before">${icon('onion')}<span>Ghost</span></button>
      <label class="num mini"><span>Speed (pages per second)</span><input type="number" min="1" max="60" value="${d.fps}" data-a="fps"></label>
    </div>
  </div>`);
  bar.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'play') togglePlay();
    if (a === 'first') setFrame(0);
    if (a === 'prev') setFrame(S.frame - 1);
    if (a === 'next') setFrame(S.frame + 1);
    if (a === 'add') newPageAfter(S.frame);
    if (a === 'copy') newPageAfter(S.frame, S.frame);
    if (a === 'drop') deletePage(S.frame);
    if (a === 'loop') loopPages();
    if (a === 'onion') { S.onion = !S.onion; hooks.stage(); drawTimeline(); }
  });
  $('[data-a=fps]', bar).onchange = (e) => { d.fps = clamp(Math.round(+e.target.value) || 6, 1, 60); commit(); };
  return bar;
}

function pageCard(index) {
  const d = S.doc;
  const card = html(`<button class="page-card ${index === S.frame ? 'on' : ''}" draggable="true" title="Page ${index + 1}. Drag to reorder. Right-click for more.">
    <svg viewBox="0 0 ${d.width} ${d.height}">${layersMarkup(d, index, { prefix: `pg${index}` })}</svg><b>${index + 1}</b></button>`);
  card.style.aspectRatio = `${d.width} / ${d.height}`;
  card.onclick = () => { if (S.playing) stop(); setFrame(index); };
  card.oncontextmenu = (e) => pageMenu(e, index);
  card.addEventListener('dragstart', () => { draggingPage = index; card.classList.add('dragging'); });
  card.addEventListener('dragend', () => { draggingPage = null; card.classList.remove('dragging'); });
  card.addEventListener('dragover', (e) => { if (draggingPage !== null && draggingPage !== index) { e.preventDefault(); card.classList.add('drop'); } });
  card.addEventListener('dragleave', () => card.classList.remove('drop'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    movePage(d, draggingPage, index);
    S.frame = index;
    S.sel.clear();
    commit();
  });
  return card;
}

function drawPages(box) {
  const scrollLeft = $('.page-strip', box)?.scrollLeft || 0;
  box.innerHTML = '';
  box.append(pageHeader());
  const strip = html('<div class="page-strip"></div>');
  S.doc.pages.forEach((_, i) => strip.append(pageCard(i)));
  const add = html(`<button class="page-add" title="New page" aria-label="New page">${icon('plus')}</button>`);
  add.onclick = () => newPageAfter(S.doc.pages.length - 1);
  strip.append(add);
  box.append(strip);
  strip.scrollLeft = scrollLeft;
  placePlayhead();
}

export function drawTimeline() {
  const box = $('#timeline');
  const d = S.doc;
  box.hidden = !d.animated;
  if (!d.animated) return;
  if (isPages(d)) { drawPages(box); return; }
  const scroller = $('.time-body', box);
  const scrollTop = scroller?.scrollTop || 0, scrollLeft = scroller?.scrollLeft || 0;
  box.innerHTML = '';
  box.append(header());

  const body = html('<div class="time-body"></div>');
  const names = html('<div class="time-names"><div class="time-corner">Pieces</div></div>');
  const width = d.frames * CELL;
  const rail = html(`<div class="time-rail" id="rail" style="width:${width}px"></div>`);

  const ruler = html('<div class="ruler"></div>');
  for (let f = 0; f < d.frames; f += 1) {
    if ((f + 1) % 5 === 0 || f === 0) ruler.append(html(`<span style="left:${f * CELL}px">${f + 1}</span>`));
  }
  ruler.addEventListener('pointerdown', (e) => { if (S.playing) stop(); scrubFrom(e); });
  rail.append(ruler);

  const objects = [...activeLayer().objects].reverse();
  if (!objects.length) {
    names.append(html('<div class="time-empty">Draw something first.</div>'));
  }
  for (const o of objects) {
    const on = S.sel.has(o.id);
    const name = html(`<button class="time-name ${on ? 'on' : ''}">${esc(o.name)}</button>`);
    name.onclick = () => { select([o.id]); refresh(); };
    names.append(name);
    const row = html(`<div class="time-row ${on ? 'on' : ''}"></div>`);
    row.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      if (S.playing) stop();
      select([o.id]);
      scrubFrom(e);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!S.sel.has(o.id)) { select([o.id]); refresh(); }
      const at = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX + 190, top: e.clientY, bottom: e.clientY }) };
      menu(at, [{ label: 'Loop back to beginning', icon: 'loop', onClick: loopSelection }]);
    });
    o.keys.forEach((key, i) => {
      const next = o.keys[i + 1];
      if (next) {
        row.append(html(`<span class="tween" style="left:${key.f * CELL + CELL / 2}px;width:${(next.f - key.f) * CELL}px"></span>`));
      }
      if (key.f >= d.frames) return;
      const k = html(`<button class="key ${key.f === S.frame && on ? 'on' : ''}" style="left:${key.f * CELL + CELL / 2}px" title="Frame ${key.f + 1}. Drag to change when it happens." aria-label="Keyframe at frame ${key.f + 1}"></button>`);
      k.addEventListener('pointerdown', (e) => { if (e.button !== 2) dragKey(e, o, key); });
      row.append(k);
    });
    rail.append(row);
  }
  if (objects.length && !objects.some((o) => o.keys.length)) {
    box.append(html('<p class="time-tip">To animate: pick a later frame on the ruler, then move or change something. A keyframe is added for you.</p>'));
  }
  rail.append(html('<div id="playhead"><i></i></div>'));
  body.append(names, html('<div class="time-scroll"></div>'));
  $('.time-scroll', body).append(rail);
  box.append(body);
  const scroll = $('.time-scroll', body);
  scroll.scrollLeft = scrollLeft;
  body.scrollTop = scrollTop;
  placePlayhead();
}
