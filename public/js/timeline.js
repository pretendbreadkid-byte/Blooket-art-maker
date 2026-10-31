// The animation timeline: playback, the frame ruler and keyframe diamonds.
import { S, hooks, commit, refresh, activeLayer, selected, select } from './state.js';
import { EASINGS, addKey, removeKey, moveKey, clamp } from './model.js';
import { esc } from './render.js';
import { $, html, icon, toast } from './ui.js';

const CELL = 16;
let raf = 0;

export function setFrame(f) {
  S.frame = clamp(Math.round(f), 0, S.doc.frames - 1);
  hooks.stage();
  hooks.overlay();
  placePlayhead();
}

function placePlayhead() {
  const head = $('#playhead');
  if (!head) return;
  head.style.transform = `translateX(${S.frame * CELL}px)`;
  const label = $('#framelabel');
  if (label) label.textContent = `${S.frame + 1} / ${S.doc.frames}`;
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

export function drawTimeline() {
  const box = $('#timeline');
  const d = S.doc;
  box.hidden = !d.animated;
  if (!d.animated) return;
  const scroller = $('.time-body', box);
  const scrollTop = scroller?.scrollTop || 0, scrollLeft = scroller?.scrollLeft || 0;
  box.innerHTML = '';
  box.append(header());

  const body = html('<div class="time-body"></div>');
  const names = html('<div class="time-names"><div class="time-corner">On this layer</div></div>');
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
      if (S.playing) stop();
      select([o.id]);
      scrubFrom(e);
    });
    o.keys.forEach((key, i) => {
      const next = o.keys[i + 1];
      if (next) {
        row.append(html(`<span class="tween" style="left:${key.f * CELL + CELL / 2}px;width:${(next.f - key.f) * CELL}px"></span>`));
      }
      if (key.f >= d.frames) return;
      const k = html(`<button class="key ${key.f === S.frame && on ? 'on' : ''}" style="left:${key.f * CELL + CELL / 2}px" title="Frame ${key.f + 1}. Drag to change when it happens." aria-label="Keyframe at frame ${key.f + 1}"></button>`);
      k.addEventListener('pointerdown', (e) => dragKey(e, o, key));
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
