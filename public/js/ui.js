// Shared bits of interface: icons, dialogs, menus and toasts.
// VS Code's preview blocks alert/confirm/prompt, so everything here is custom.
import { esc } from './render.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function html(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

const ICONS = {
  select: 'M5 3l14 8-6 2-3 6z',
  lasso: 'M12 4c5 0 9 2.500 9 6s-4 6-9 6c-1.500 0-3-.200-4.200-.700M12 4C7 4 3 6.500 3 10c0 2 1.300 3.700 3.300 4.800M6.300 14.800a2 2 0 1 0 1.500.5c.3 1.700-.3 3.700-1.800 5.700',
  vertices: 'M6 18L18 6M4 16h4v4H4zM16 4h4v4h-4zM12 9.5a2.5 2.5 0 1 1 0 5',
  pencil: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4',
  marker: 'M9 15l-5 5h6l2-2M9 15l7-11 5 4-9 10zM9 15l3 3',
  shapes: 'M3 13h8v8H3zM17 3l4.5 8h-9zM17 14a3.500 3.500 0 1 1 0 7 3.500 3.500 0 0 1 0-7z',
  bucket: 'M11 3l9 9-8 8a2 2 0 0 1-3 0l-6-6a2 2 0 0 1 0-3zM4 12h15M21 17s-2 2.300-2 3.500a2 2 0 0 0 4 0c0-1.200-2-3.500-2-3.500z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  eraser: 'M8 20l-5-5a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-8 8zM21 20H8M7.500 8l8.500 8.500',
  hand: 'M8 12V5a1.500 1.500 0 0 1 3 0v6-8a1.500 1.500 0 0 1 3 0v8-6a1.500 1.500 0 0 1 3 0v8-3a1.500 1.500 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-3-5a1.500 1.500 0 0 1 2.500-1.500z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  back: 'M15 5l-7 7 7 7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeoff: 'M3 3l18 18M10.600 5.100A10 10 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.200 3.900M6.500 6.600A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.400-1',
  lock: 'M6 11h12v9H6zM8.500 11V7.500a3.500 3.500 0 0 1 7 0V11',
  unlock: 'M6 11h12v9H6zM8.500 11V7.500a3.500 3.500 0 0 1 6.800-1.200',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  download: 'M12 4v11M7 11l5 5 5-5M4 20h16',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.500 9.500a1.500 1.500 0 1 0 0-.1',
  folder: 'M3 6h6l2 2h10v11H3z',
  folderplus: 'M3 6h6l2 2h10v11H3zM12 11v5M9.500 13.500h5',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  first: 'M6 5v14M19 5l-9 7 9 7z',
  prev: 'M16 5l-9 7 9 7z',
  next: 'M8 5l9 7-9 7z',
  diamond: 'M12 3l9 9-9 9-9-9z',
  onion: 'M12 21a7 7 0 0 0 7-7c0-4-4-7-7-11-3 4-7 7-7 11a7 7 0 0 0 7 7zM12 21c-2-2-3-4-3-7s1.500-4.500 3-7',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  flipx: 'M12 3v18M8 7L3 17h5zM16 7l5 10h-5z',
  flipy: 'M3 12h18M7 8L17 3v5zM7 16l10 5v-5z',
  chevron: 'M9 6l6 6-6 6',
  shield: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z',
  upload: 'M12 16V5M7 9l5-5 5 5M4 20h16',
  smooth: 'M4 18C10 18 8 6 20 6',
  sharp: 'M4 18L12 6l8 12',
  logout: 'M10 4H5v16h5M16 8l4 4-4 4M20 12H9',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6',
  line: 'M4 19L10 8l5 7 5-11M3 17.500h3v3H3zM18.500 2.500h3v3h-3z',
  blook: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8.500 11v1M15.500 11v1M9 16c2 1.500 4 1.500 6 0',
  apart: 'M3 3h7v7H3zM14 14h7v7h-7zM14 3h7v7h-7M3 14h7v7',
  loop: 'M4 12a8 8 0 0 1 14-5.300L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.300L4 15M4 20v-5h5',
  link: 'M9 15l6-6M8 11l-3 3a3.500 3.500 0 0 0 5 5l3-3M16 13l3-3a3.500 3.500 0 0 0-5-5l-3 3',
  page: 'M6 3h9l4 4v14H6zM15 3v4h4',
  caret: 'M6 9l6 6 6-6',
  forward: 'M12 15V4M7 9l5-5 5 5M4 19h16',
  backward: 'M12 9v11M7 15l5 5 5-5M4 5h16',
  front: 'M12 13V3M7 8l5-5 5 5M4 17h16M6 21h12',
  toback: 'M12 11v10M7 16l5 5 5-5M4 7h16M6 3h12',
  star: 'M12 3l2.700 5.600 6.200.900-4.500 4.300 1.100 6.200L12 17.100 6.500 20l1.100-6.200L3.100 9.500l6.200-.900z',
};

export const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

export function toast(message, kind = '') {
  const el = html(`<div class="toast ${kind}" role="status">${esc(message)}</div>`);
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

// Opens a dialog. Resolve it by calling close(value) from inside build().
export function dialog(build, { wide = false } = {}) {
  return new Promise((resolve) => {
    const back = html(`<div class="dlg-back"><div class="dlg ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"></div></div>`);
    const box = $('.dlg', back);
    const previous = document.activeElement;
    const close = (value) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(undefined); });
    build(box, close);
    $('#dialogs').append(back);
    ($('[autofocus]', box) || $('input,button', box))?.focus();
    $('[autofocus]', box)?.select?.();
  });
}

export function askText({ title, label, value = '', action = 'Save', hint = '' }) {
  return dialog((box, close) => {
    box.innerHTML = `<h2>${esc(title)}</h2>
      <form>
        <label class="field"><span>${esc(label)}</span><input maxlength="80" value="${esc(value)}" autofocus></label>
        ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
        <div class="dlg-actions">
          <button type="button" class="btn ghost" data-no>Cancel</button>
          <button class="btn primary">${esc(action)}</button>
        </div>
      </form>`;
    $('[data-no]', box).onclick = () => close(undefined);
    $('form', box).onsubmit = (e) => {
      e.preventDefault();
      const text = $('input', box).value.trim();
      if (text) close(text);
    };
  });
}

export function confirmBox({ title, message, action = 'OK', danger = false }) {
  return dialog((box, close) => {
    box.innerHTML = `<h2>${esc(title)}</h2><p class="muted">${esc(message)}</p>
      <div class="dlg-actions">
        <button class="btn ghost" data-no>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes autofocus>${esc(action)}</button>
      </div>`;
    $('[data-no]', box).onclick = () => close(false);
    $('[data-yes]', box).onclick = () => close(true);
  });
}

// items: [{ label, icon, onClick, danger }] or null for a divider
export function menu(anchor, items) {
  document.querySelector('.menu')?.remove();
  const el = html('<div class="menu" role="menu"></div>');
  for (const item of items) {
    if (!item) { el.append(html('<hr>')); continue; }
    const row = html(`<button role="menuitem" class="${item.danger ? 'danger' : ''}">${item.icon ? icon(item.icon) : ''}<span>${esc(item.label)}</span></button>`);
    row.onclick = () => { el.remove(); item.onClick(); };
    el.append(row);
  }
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const m = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(innerWidth - m.width - 8, r.right - m.width))}px`;
  el.style.top = `${r.bottom + m.height + 12 > innerHeight ? r.top - m.height - 4 : r.bottom + 4}px`;
  setTimeout(() => {
    const dismiss = (e) => {
      if (el.contains(e.target)) return;
      el.remove();
      document.removeEventListener('pointerdown', dismiss, true);
    };
    document.addEventListener('pointerdown', dismiss, true);
  });
}

export const PALETTE = [
  '#000000', '#3d3a50', '#8a8798', '#ffffff', '#e63946', '#ff7a1a', '#ffb703', '#ffe66d',
  '#2fbf71', '#0e9f8e', '#1fa2ff', '#2d5bff', '#6c3bf5', '#b14aed', '#ff5da2', '#8c5a3c',
];

export const paintCss = (value) => (typeof value === 'string'
  ? value
  : `linear-gradient(${value.angle + 90}deg, ${value.from}, ${value.to})`);

export function swatch(value) {
  return value === 'none'
    ? '<span class="sw none" title="No colour"></span>'
    : `<span class="sw" style="background:${esc(paintCss(value))}"></span>`;
}

// A colour chooser made of a palette, a hex box and the system picker.
export function colorPopover(anchor, { value, allowNone = false, allowGradient = false, onInput, onDone }) {
  document.querySelector('.popover')?.remove();
  if (typeof value !== 'string') { gradientPopover(anchor, { value, allowNone, onInput, onDone }); return; }
  const pop = html(`<div class="popover">
    ${allowGradient ? '<div class="pop-tabs"><button class="on">Solid</button><button data-grad>Gradient</button></div>' : ''}
    <div class="pal">${PALETTE.map((c) => `<button data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
    <div class="pop-row">
      <input type="color" value="${value === 'none' ? '#000000' : esc(value)}" aria-label="More colours">
      <input class="hex" value="${value === 'none' ? '' : esc(value)}" placeholder="#000000" maxlength="7" aria-label="Colour code">
      ${allowNone ? '<button class="btn ghost small" data-none>None</button>' : ''}
    </div>
  </div>`);
  const pick = (c, finish) => {
    onInput(c);
    if (c !== 'none') { $('[type=color]', pop).value = c; $('.hex', pop).value = c; }
    if (finish) done();
  };
  const done = () => {
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
    onDone?.();
  };
  const outside = (e) => { if (!pop.contains(e.target)) done(); };
  pop.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (c) pick(c, true);
    if (e.target.closest('[data-none]')) pick('none', true);
    if (e.target.closest('[data-grad]')) {
      pop.remove();
      document.removeEventListener('pointerdown', outside, true);
      const start = { from: value === 'none' ? '#ff4f79' : value, to: '#ffc93c', angle: 90 };
      onInput(start);
      gradientPopover(anchor, { value: start, allowNone, onInput, onDone });
    }
  });
  $('[type=color]', pop).oninput = (e) => pick(e.target.value);
  $('.hex', pop).oninput = (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) pick(e.target.value.toLowerCase()); };
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), m = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(innerWidth - m.width - 8, r.left))}px`;
  pop.style.top = `${r.bottom + m.height + 8 > innerHeight ? Math.max(8, r.top - m.height - 6) : r.bottom + 6}px`;
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}

// Pick two colours and turn the dial to point the gradient any way you like.
function gradientPopover(anchor, { value, onInput, onDone }) {
  const g = { from: value.from, to: value.to, angle: value.angle };
  let stop = 'from';
  const pop = html(`<div class="popover">
    <div class="pop-tabs"><button data-solid>Solid</button><button class="on">Gradient</button></div>
    <div class="grad-bar"></div>
    <div class="grad-stops">
      <button class="grad-stop on" data-stop="from" aria-label="Start colour"></button>
      <button class="grad-swap" data-swap title="Swap colours" aria-label="Swap colours">${icon('redo')}</button>
      <button class="grad-stop" data-stop="to" aria-label="End colour"></button>
      <input type="color" aria-label="More colours">
    </div>
    <div class="pal">${PALETTE.map((c) => `<button data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
    <div class="grad-angle">
      <div class="dial" role="slider" aria-label="Gradient direction"><i></i></div>
      <label class="num"><span>Direction</span><input type="number" step="1"></label>
    </div>
  </div>`);
  const dial = $('.dial', pop), number = $('.num input', pop), wheel = $('[type=color]', pop);
  const paint = (announce = true) => {
    $('.grad-bar', pop).style.background = paintCss(g);
    $('.dial i', pop).style.transform = `rotate(${g.angle}deg)`;
    number.value = Math.round(g.angle);
    wheel.value = g[stop];
    pop.querySelectorAll('.grad-stop').forEach((b) => {
      b.style.background = g[b.dataset.stop];
      b.classList.toggle('on', b.dataset.stop === stop);
    });
    if (announce) onInput({ ...g });
  };
  const done = () => {
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
    onDone?.();
  };
  const outside = (e) => { if (!pop.contains(e.target)) done(); };
  pop.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    const s = e.target.closest('[data-stop]')?.dataset.stop;
    if (c) { g[stop] = c; paint(); }
    if (s) { stop = s; paint(false); }
    if (e.target.closest('[data-swap]')) { [g.from, g.to] = [g.to, g.from]; paint(); }
    if (e.target.closest('[data-solid]')) { onInput(g.from); done(); }
  });
  wheel.oninput = () => { g[stop] = wheel.value; paint(); };
  number.oninput = () => { if (number.value !== '') { g.angle = +number.value; paint(); } };
  dial.addEventListener('pointerdown', (e) => {
    dial.setPointerCapture(e.pointerId);
    const turn = (ev) => {
      const r = dial.getBoundingClientRect();
      const deg = (Math.atan2(ev.clientY - r.top - r.height / 2, ev.clientX - r.left - r.width / 2) * 180) / Math.PI;
      const snapped = ev.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
      g.angle = (snapped + 360) % 360;
      paint();
    };
    turn(e);
    dial.onpointermove = turn;
    dial.onpointerup = () => { dial.onpointermove = null; };
  });
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), m = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(innerWidth - m.width - 8, r.left))}px`;
  pop.style.top = `${r.bottom + m.height + 8 > innerHeight ? Math.max(8, r.top - m.height - 6) : r.bottom + 6}px`;
  paint(false);
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}

export const readText = (file) => file.text();
export const readDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});
