// The admin page: sign in, then upload and manage catalog shapes.
import { svgToShape, shapeThumb } from './shapes.js';
import { imageToShape } from './trace.js';
import { esc } from './render.js';
import { marketArt, shopPack } from './packs.js';
import { $, $$, icon, toast, confirmBox, readText, readDataUrl } from './ui.js';

const TOKEN_KEY = 'blook-admin-token';

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* The session just won't survive a reload. */ }
}

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) setToken(null);
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
  return data;
}

export async function renderAdmin(root) {
  document.title = 'Admin · Blook Berry';
  if (getToken()) await renderManager(root);
  else renderLogin(root);
}

function renderLogin(root) {
  root.innerHTML = `<div class="admin-login">
    <form class="dlg">
      <span class="brand-mark">${icon('shield')}</span>
      <h2>Admin sign in</h2>
      <p class="muted">Admins can add shapes to the catalog for everyone.</p>
      <label class="field"><span>Password</span><input type="password" id="pw" autocomplete="current-password" autofocus></label>
      <p class="muted small">The password is shown in the terminal when the server starts.</p>
      <p class="size-err" hidden></p>
      <div class="dlg-actions">
        <a class="btn ghost" href="#/">Back</a>
        <button class="btn primary">Sign in</button>
      </div>
    </form>
  </div>`;
  $('#pw', root).focus();
  $('form', root).onsubmit = async (e) => {
    e.preventDefault();
    const err = $('.size-err', root);
    try {
      const { token } = await call('POST', '/api/admin/login', { password: $('#pw', root).value });
      setToken(token);
      renderManager(root);
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
    }
  };
}

async function uploadFiles(root, files) {
  const category = $('#ucat', root).value.trim() || 'Uploaded';
  let added = 0;
  for (const file of files) {
    try {
      const isSvg = /\.svg$/i.test(file.name);
      const shape = isSvg ? svgToShape(await readText(file)) : await imageToShape(await readDataUrl(file));
      await call('POST', '/api/shapes', { ...shape, name: file.name.replace(/\.[^.]+$/, ''), category });
      added++;
    } catch (error) {
      if (error.status === 401) { renderLogin(root); return; }
      toast(`${file.name}: ${error.message}`, 'warn');
    }
  }
  if (added) toast(`Added ${added} shape${added > 1 ? 's' : ''}.`, 'ok');
  renderManager(root);
}

// Packs people sent in. Waiting ones come first; nothing shows in Community
// until it is approved here.
function communitySection(packs) {
  const waiting = packs.filter((p) => p.status !== 'approved');
  const approved = packs.filter((p) => p.status === 'approved');
  const row = (p) => `<li class="review" data-id="${p.id}">
      <span class="review-art">${marketArt({ art: p.cover, icon: p.icon, color: p.color })}</span>
      <span class="review-text"><b>${esc(p.name)}</b><small>by ${esc(p.author)} · ${p.price} tokens</small>
        <em class="${p.status === 'approved' ? 'ok' : ''}">${p.status === 'approved' ? 'In Community' : 'Waiting'}</em></span>
      <button class="btn ghost" data-look>${icon('eye')}<span>Try it</span></button>
      ${p.status === 'approved' ? '' : `<button class="btn primary" data-approve>${icon('check')}<span>Approve</span></button>`}
      <button class="ib" data-remove aria-label="Remove ${esc(p.name)}" title="Remove">${icon('trash')}</button>
    </li>`;
  return `<h2>Community packs</h2>
    ${packs.length ? '' : '<p class="muted">When people send packs to Community, they wait here for you to approve them.</p>'}
    ${waiting.length ? `<h3 class="review-head">Waiting (${waiting.length})</h3><ul class="review-list">${waiting.map(row).join('')}</ul>` : ''}
    ${approved.length ? `<h3 class="review-head">In Community (${approved.length})</h3><ul class="review-list">${approved.map(row).join('')}</ul>` : ''}`;
}

function wireCommunity(root) {
  const act = async (job, done) => {
    try {
      await job();
      if (done) toast(done, 'ok');
      renderManager(root);
    } catch (error) {
      if (error.status === 401) renderLogin(root);
      else toast(error.message, 'warn');
    }
  };
  $$('.review', root).forEach((row) => {
    const id = row.dataset.id;
    $('[data-look]', row).onclick = () => act(async () => {
      const { name, author, pack } = await call('GET', `/api/community/${id}`);
      shopPack({ id, name, author, community: true, preview: true, pack: { ...pack, pulled: {} } });
    });
    $('[data-approve]', row)?.addEventListener('click', () => act(() => call('POST', `/api/admin/community/${id}/approve`), 'Approved. It is in Community now.'));
    $('[data-remove]', row).onclick = async () => {
      const name = $('b', row).textContent;
      const ok = await confirmBox({ title: 'Remove this pack?', message: `"${name}" will be taken out of Community.`, action: 'Remove', danger: true });
      if (ok) act(() => call('DELETE', `/api/admin/community/${id}`), 'Removed.');
    };
  });
}

async function renderManager(root) {
  const [{ shapes = [], temporary = false, accountsTemporary = false }, { packs = [] }] = await Promise.all([
    call('GET', '/api/shapes'),
    call('GET', '/api/admin/community').catch((error) => {
      if (error.status === 401) throw error;
      return { packs: [] };
    }),
  ]);
  const lastCategory = shapes[shapes.length - 1]?.category || 'Uploaded';
  root.innerHTML = `<div class="admin">
    <header class="admin-top">
      <a class="btn ghost" href="#/">${icon('back')}<span>Back</span></a>
      <h1>Admin</h1>
      <div class="grow"></div>
      <button class="btn ghost" id="signout">Sign out</button>
    </header>
    ${temporary ? '<p class="admin-note">Shapes uploaded on this live site disappear when it restarts. To keep a shape, upload it in your VS Code preview, then push to GitHub.</p>' : ''}
    ${accountsTemporary ? '<p class="admin-note">Accounts are not being kept yet, so everyone loses their login when this site restarts. Set GITHUB_TOKEN and DATA_REPO to fix that.</p>' : ''}
    <section class="upload">
      <label class="drop" id="drop">
        ${icon('upload')}
        <b>Drop SVGs or pictures here</b>
        <span class="muted">or click to choose them. A picture becomes a shape with its real outline.</span>
        <input type="file" id="ufile" accept=".svg,image/*" multiple hidden>
      </label>
      <div class="upload-side">
        <label class="field"><span>Add to category</span><input id="ucat" maxlength="40" value="${esc(lastCategory)}"></label>
      </div>
    </section>
    ${communitySection(packs)}
    <h2>${shapes.length} uploaded shape${shapes.length === 1 ? '' : 's'}</h2>
    ${shapes.length ? '' : '<p class="muted">The built-in basic shapes are always there. Shapes you upload here show up in everyone\'s Shapes panel.</p>'}
    <ul class="admin-list">
      ${shapes.map((s) => `<li data-id="${s.id}">
        <span class="admin-thumb">${shapeThumb(s)}</span>
        <label class="field"><span>Name</span><input data-k="name" maxlength="60" value="${esc(s.name)}"></label>
        <label class="field"><span>Category</span><input data-k="category" maxlength="40" value="${esc(s.category)}"></label>
        <button class="ib" data-del aria-label="Delete ${esc(s.name)}" title="Delete">${icon('trash')}</button>
      </li>`).join('')}
    </ul>
  </div>`;

  $('#signout', root).onclick = () => { setToken(null); renderLogin(root); };
  wireCommunity(root);
  const input = $('#ufile', root), drop = $('#drop', root);
  input.onchange = () => uploadFiles(root, [...input.files]);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); uploadFiles(root, [...e.dataTransfer.files]); });

  $$('.admin-list li', root).forEach((row) => {
    const id = row.dataset.id;
    $$('[data-k]', row).forEach((field) => {
      field.onchange = async () => {
        try {
          await call('PATCH', `/api/shapes/${id}`, { [field.dataset.k]: field.value });
          toast('Saved.', 'ok');
        } catch (error) {
          if (error.status === 401) renderLogin(root);
          else toast(error.message, 'warn');
        }
      };
    });
    $('[data-del]', row).onclick = async () => {
      const name = $('[data-k=name]', row).value;
      const ok = await confirmBox({
        title: 'Delete this shape?', message: `"${name}" will leave the catalog. Art that already uses it keeps it.`, action: 'Delete', danger: true,
      });
      if (!ok) return;
      try {
        await call('DELETE', `/api/shapes/${id}`);
        renderManager(root);
      } catch (error) {
        if (error.status === 401) renderLogin(root);
        else toast(error.message, 'warn');
      }
    };
  });
}
