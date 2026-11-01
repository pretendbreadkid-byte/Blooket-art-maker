// Uploaded assets: pictures kept on the account, ready to use in any project.
// Guests keep theirs until the page closes, the same as the rest of their art.
import { S } from './state.js';
import { session, call } from './session.js';
import { uid } from './model.js';
import { esc } from './render.js';
import { addImageFromUrl } from './tools.js';
import { startPanelDrag } from './panels.js';
import { $, confirmBox, html, icon, readDataUrl, toast } from './ui.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

let listFor = null;
let list = [];
const pictures = new Map();

async function loadList() {
  const owner = session.user?.name ?? '';
  if (listFor === owner) return;
  listFor = owner;
  list = [];
  pictures.clear();
  if (session.user) list = (await call('GET', '/api/uploads')).uploads;
}

async function picture(item) {
  if (!pictures.has(item.id)) pictures.set(item.id, (await call('GET', `/api/uploads/${item.id}`)).href);
  return pictures.get(item.id);
}

async function place(item, x, y) {
  try {
    await addImageFromUrl(await picture(item), x, y);
  } catch {
    toast(`${item.name} could not be opened.`, 'warn');
  }
}

async function remove(item) {
  const sure = await confirmBox({ title: `Delete ${item.name}?`, message: 'It leaves your uploaded assets for good. Art already using it stays as it is.', action: 'Delete', danger: true });
  if (!sure) return;
  try {
    if (session.user) await call('DELETE', `/api/uploads/${item.id}`);
    list = list.filter((other) => other !== item);
    pictures.delete(item.id);
    renderList();
  } catch (error) {
    toast(error.message, 'warn');
  }
}

async function upload(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      toast(`${file.name} is not a picture.`, 'warn');
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name} is too big. Pictures can be up to 8 MB.`, 'warn');
      continue;
    }
    try {
      const href = await readDataUrl(file);
      const item = { id: uid('up-'), name: file.name.replace(/\.[^.]+$/, '') };
      if (session.user) await call('PUT', `/api/uploads/${item.id}`, { name: item.name, href });
      pictures.set(item.id, href);
      list = [item, ...list];
      renderList();
    } catch (error) {
      toast(`${file.name} could not be saved. ${error.message}`, 'warn');
    }
  }
}

function renderList() {
  const grid = $('#blooks .cat-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!list.length) { grid.append(html('<p class="muted">Nothing here yet.</p>')); return; }
  const row = html('<div class="cat-row"></div>');
  for (const item of list) {
    const b = html(`<div class="cat-item upload-item" role="button" tabindex="0" title="${esc(item.name)}"><img alt="" draggable="false"><span>${esc(item.name)}</span>
      <button class="upload-x" title="Delete" aria-label="Delete ${esc(item.name)}">${icon('x')}</button></div>`);
    const img = $('img', b);
    picture(item).then((href) => { img.src = href; }).catch(() => undefined);
    b.onclick = (e) => {
      if (b.dataset.dragged) { delete b.dataset.dragged; return; }
      if (!e.target.closest('.upload-x')) place(item, S.doc.width / 2, S.doc.height / 2);
    };
    b.onkeydown = (e) => { if (e.key === 'Enter' && e.target === b) place(item, S.doc.width / 2, S.doc.height / 2); };
    $('.upload-x', b).onclick = () => remove(item);
    b.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.upload-x') || !img.src) return;
      startPanelDrag(e, b, `<img src="${esc(img.src)}" alt="">`, (p) => place(item, p.x, p.y));
    });
    row.append(b);
  }
  grid.append(row);
}

// The same pictures for the pack maker, read only when one is picked.
export async function uploadedAssets() {
  await loadList();
  return Promise.all(list.map(async (item) => {
    const href = await picture(item);
    return { name: item.name, thumb: href, read: async () => href };
  }));
}

export function drawUploads(box, onClose) {
  box.innerHTML = `<div class="panel-head"><h3>Uploaded assets</h3>
      <button class="ib blook-close" title="Close" aria-label="Close uploaded assets">${icon('x')}</button></div>
    <button class="btn primary upload-add">${icon('upload')}<span>Upload pictures</span></button>
    <input class="upload-file" type="file" accept="image/*,.svg" multiple hidden>
    <p class="muted blook-tip">${session.user ? 'Saved to your account. Drag one onto the canvas.' : 'Log in to keep these. As a guest, they go when the page closes.'}</p>
    <div class="cat-grid"><p class="muted">Loading...</p></div>`;
  $('.blook-close', box).onclick = onClose;
  const file = $('.upload-file', box);
  $('.upload-add', box).onclick = () => file.click();
  file.onchange = () => { upload([...file.files]); file.value = ''; };
  loadList().then(renderList).catch(() => {
    listFor = null;
    const grid = $('#blooks .cat-grid');
    if (grid) grid.innerHTML = '<p class="muted">Your uploads could not be loaded. Close this and try again.</p>';
  });
}
