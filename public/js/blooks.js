// The Blook assets panel: search the pictures, then drag one onto the canvas.
// Each one arrives as separate pieces held together until you take it apart.
import { S, hooks, commit, select } from './state.js';
import { newLayer } from './model.js';
import { esc } from './render.js';
import { fetchBlooks, readPieces, piecesToObjects, piecesFromPicture } from './pieces.js';
import { startPanelDrag } from './panels.js';
import { $, html, icon, toast } from './ui.js';

const DROPPED_BLOOK_SIZE = 0.6;
const MAX_SHOWN = 300;

let list = null;
let search = '';

export function toggleBlooks() {
  S.blooksOpen = !S.blooksOpen;
  hooks.panels();
}

// Pieces go on their own layer, so they are easy to find and hide.
function placePieces(parsed, name, x, y) {
  const size = Math.min(S.doc.width, S.doc.height) * DROPPED_BLOOK_SIZE;
  const objects = piecesToObjects(parsed, name, x, y, size);
  const layer = newLayer(name);
  const page = S.doc.pages?.[S.frame]?.id;
  if (page) objects.forEach((o) => { o.page = page; });
  layer.objects.push(...objects);
  S.doc.layers.push(layer);
  select(objects.map((o) => o.id));
  commit();
  return objects;
}

// An uploaded picture, already apart, so each piece can be clicked straight away.
export async function addPictureApart(href, name, x = S.doc.width / 2, y = S.doc.height / 2) {
  const objects = placePieces(await piecesFromPicture(href), name, x, y);
  objects.forEach((o) => { delete o.group; });
  commit();
  toast(`${name} came apart into ${objects.length} pieces.`, 'ok');
}

export async function addBlook(blook, x, y) {
  try {
    const res = await fetch(`/blooks/${encodeURIComponent(blook.file)}`);
    if (!res.ok) throw new Error('missing');
    placePieces(readPieces(await res.text()), blook.name, x, y);
    toast(`${blook.name} added. Right-click it and choose Take apart.`, 'ok');
  } catch {
    toast(`${blook.name} could not be opened.`, 'warn');
  }
}

function renderGrid() {
  const grid = $('#blooks .cat-grid');
  const words = search.split(/\s+/).filter(Boolean);
  const found = list.filter((b) => words.every((w) => b.name.toLowerCase().includes(w)));
  grid.innerHTML = '';
  if (!found.length) { grid.append(html('<p class="muted">No blooks match that.</p>')); return; }
  const row = html('<div class="cat-row"></div>');
  for (const blook of found.slice(0, MAX_SHOWN)) {
    const url = `/blooks/${encodeURIComponent(blook.file)}`;
    const b = html(`<button class="cat-item" title="${esc(blook.name)}"><img src="${esc(url)}" alt="" loading="lazy" draggable="false"><span>${esc(blook.name)}</span></button>`);
    b.onclick = () => {
      if (b.dataset.dragged) { delete b.dataset.dragged; return; }
      addBlook(blook, S.doc.width / 2, S.doc.height / 2);
    };
    b.addEventListener('pointerdown', (e) => {
      startPanelDrag(e, b, `<img src="${esc(url)}" alt="">`, (p) => addBlook(blook, p.x, p.y));
    });
    row.append(b);
  }
  grid.append(row);
}

export function drawBlooks() {
  const box = $('#blooks');
  box.hidden = !S.blooksOpen;
  if (box.hidden || $('.cat-search', box)) return;
  box.innerHTML = `<div class="panel-head"><h3>Blook assets</h3>
      <button class="ib blook-close" title="Close" aria-label="Close Blook assets">${icon('x')}</button></div>
    <label class="cat-search">${icon('search')}<input placeholder="Find a blook" aria-label="Find a blook" value="${esc(search)}"></label>
    <p class="muted blook-tip">Drag one onto the canvas.</p>
    <div class="cat-grid"><p class="muted">Loading...</p></div>
    <p class="muted blook-tip">Blook art by Blooket, used with permission.</p>`;
  $('.blook-close', box).onclick = toggleBlooks;
  $('input', box).oninput = (e) => { search = e.target.value.toLowerCase(); if (list) renderGrid(); };
  const ready = list ? Promise.resolve(list) : fetchBlooks();
  ready.then((blooks) => {
    list = blooks;
    if ($('#blooks .cat-grid')) renderGrid();
  });
}
