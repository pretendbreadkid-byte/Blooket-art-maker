// Templates people sent in: Blooks, packs and other art an admin has accepted.
// Using one makes your own copy, saved in this browser, to change however you like.
import { listProjects, getDoc, saveDoc } from './store.js';
import { uid } from './model.js';
import { esc, exportSVG, rasterize } from './render.js';
import { TEMPLATES } from './templates.js';
import { showTestPage } from './home.js';
import { $, $$, icon, dialog, toast } from './ui.js';

export const KIND_NAMES = { blook: 'Blooks', pack: 'Packs', banner: 'Banners', background: 'Backgrounds', icon: 'Icons', other: 'Other art' };
const kindOne = { blook: 'Blook', pack: 'Pack', banner: 'Banner', background: 'Background', icon: 'Icon', other: 'Art' };
const THUMB_PX = 320;
const MAX_SEND = 6 * 1024 * 1024;

let kind = 'all';
let search = '';

export const kindOf = (doc) => (doc.pack ? 'pack' : TEMPLATES[doc.template] ? doc.template : 'other');

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again in a moment.');
  return data;
}

export async function renderTemplates(root) {
  document.title = 'Templates · Blook Berry';
  root.innerHTML = `<div class="tpl-page">
    <header class="tpl-top">
      <a class="btn ghost" href="#/art">${icon('back')}<span>My art</span></a>
      <h1>Templates</h1>
      <div class="grow"></div>
      <button class="btn primary" id="sendin">${icon('upload')}<span>Send in yours</span></button>
    </header>
    <p class="muted tpl-lead">Blooks and packs made by people like you. Use one and you get your own copy to change however you like.</p>
    <div class="tpl-tools"><div class="fx-filter" id="kinds"></div><input type="search" id="findtpl" placeholder="Search templates" aria-label="Search templates" value="${esc(search)}"></div>
    <div id="tpls"><p class="muted">Loading templates…</p></div>
  </div>`;
  $('#sendin', root).onclick = () => sendIn();
  adminNote(root);
  let list = [];
  try { list = (await api('GET', '/api/templates')).templates; } catch (error) {
    $('#tpls', root).innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    return;
  }
  const draw = () => {
    const kinds = [['all', 'All'], ...Object.entries(KIND_NAMES).filter(([k]) => list.some((t) => t.kind === k))];
    if (!kinds.some(([k]) => k === kind)) kind = 'all';
    $('#kinds', root).innerHTML = kinds.map(([k, label]) => `<button class="chip ${kind === k ? 'on' : ''}" data-k="${k}">${esc(label)}</button>`).join('');
    $$('[data-k]', root).forEach((b) => { b.onclick = () => { kind = b.dataset.k; draw(); }; });
    const shown = list.filter((t) => (kind === 'all' || t.kind === kind) && (!search || t.name.toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => b.at - a.at);
    $('#tpls', root).innerHTML = shown.length ? `<div class="tpl-grid">${shown.map((t) => `<button class="tpl-card" data-id="${esc(t.id)}">
        <span class="tpl-thumb"><img src="/api/templates/${esc(t.id)}/thumb" alt="" loading="lazy"></span>
        <b>${esc(t.name)}</b><small>${esc(kindOne[t.kind] || 'Art')}${t.by ? ` · by ${esc(t.by)}` : ''}</small></button>`).join('')}</div>`
      : `<div class="tpl-empty"><p>${list.length ? 'No templates match that.' : 'No templates yet. Be the first to send one in!'}</p></div>`;
    $$('.tpl-card', root).forEach((card) => {
      card.onclick = () => openTemplate(list.find((t) => t.id === card.dataset.id));
    });
  };
  $('#findtpl', root).oninput = (e) => { search = e.target.value; draw(); };
  draw();
}

// Only for an admin who is signed in: how many are waiting, and a way to check them.
async function adminNote(root) {
  // Not signed in (or the sign-in ran out): a small way in to the admin page.
  const signIn = () => {
    const link = document.createElement('a');
    link.className = 'tpl-admin-link';
    link.href = '#/admin';
    link.innerHTML = `${icon('shield')}<span>Admin? Sign in to accept sent-in templates</span>`;
    $('.tpl-page', root)?.append(link);
  };
  let token = null;
  try { token = localStorage.getItem('blook-admin-token'); } catch { /* not signed in */ }
  if (!token) { signIn(); return; }
  try {
    const res = await fetch('/api/admin/templates', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { signIn(); return; }
    const waiting = (await res.json()).templates.filter((t) => t.status === 'waiting').length;
    const note = document.createElement('a');
    note.className = 'tpl-admin-note';
    note.href = '#/admin';
    note.innerHTML = `${icon('shield')}<span>${waiting ? `<b>${waiting}</b> waiting to be checked.` : 'Nothing waiting to be checked.'} Accept or take them down on the admin page.</span>`;
    $('.tpl-lead', root)?.after(note);
  } catch { /* no note */ }
}

// A bigger look, then make your own copy.
async function openTemplate(t) {
  const use = await dialog((box, close) => {
    box.innerHTML = `<h2>${esc(t.name)}</h2>
      <p class="muted">${esc(kindOne[t.kind] || 'Art')}${t.by ? ` by ${esc(t.by)}` : ''} · ${t.width} × ${t.height}</p>
      <div class="tpl-big"><img src="/api/templates/${esc(t.id)}/thumb" alt=""></div>
      <div class="dlg-actions"><button class="btn ghost" data-no>Cancel</button><button class="btn primary" data-yes>${icon('plus')}<span>Use this template</span></button></div>`;
    $('[data-no]', box).onclick = () => close();
    $('[data-yes]', box).onclick = () => close(true);
  });
  if (!use) return;
  try {
    const { doc } = await api('GET', `/api/templates/${encodeURIComponent(t.id)}`);
    const copy = { ...doc, id: uid('p'), name: t.name, folderId: null, createdAt: Date.now(), fromTemplate: t.id };
    await saveDoc(copy, await thumbOf(copy).catch(() => null));
    if (copy.pack) {
      showTestPage();
      location.hash = '#/art';
      toast(`"${t.name}" is in your packs now.`, 'ok');
    } else {
      location.hash = `#/p/${copy.id}`;
    }
  } catch (error) {
    toast(error.message, 'warn');
  }
}

// A small picture of a project: its art, or a pack's front picture.
async function thumbOf(doc) {
  const canvas = document.createElement('canvas');
  if (doc.pack) {
    const src = doc.pack.art || doc.pack.blooks?.[0]?.picture;
    if (!src) throw new Error('Nothing to show.');
    const img = new Image();
    img.src = src;
    await img.decode();
    const k = THUMB_PX / Math.max(img.naturalWidth, img.naturalHeight);
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  } else {
    const k = THUMB_PX / Math.max(doc.width, doc.height);
    const drawn = await rasterize(exportSVG(doc), Math.max(1, Math.round(doc.width * k)), Math.max(1, Math.round(doc.height * k)));
    canvas.width = drawn.width;
    canvas.height = drawn.height;
    canvas.getContext('2d').drawImage(drawn, 0, 0);
  }
  const png = canvas.toDataURL('image/png');
  return png.length < 380 * 1024 ? png : canvas.toDataURL('image/webp', 0.85);
}

// Pick one of your projects or packs and send it in to be checked.
export async function sendIn(startWith = null) {
  const projects = (await listProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!projects.length) { toast('Make some art first, then send it in.', 'warn'); return; }
  let picked = startWith && projects.some((p) => p.id === startWith) ? startWith : projects[0].id;
  await dialog((box, close) => {
    box.innerHTML = `<h2>Send in a template</h2>
      <p class="muted">Pick a Blook, pack or any art. Once it has been checked, everyone can use it as a template.</p>
      <div class="tpl-pick">${projects.map((p) => `<button class="tpl-pick-item ${p.id === picked ? 'on' : ''}" data-id="${esc(p.id)}" title="${esc(p.name)}">
        <span class="tpl-thumb">${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : icon(p.pack ? 'pack' : 'image')}</span><b>${esc(p.name)}</b></button>`).join('')}</div>
      <label class="field"><span>Template name</span><input id="tplname" maxlength="60"></label>
      <label class="field"><span>Your name (optional, shown on the template)</span><input id="tplby" maxlength="40" placeholder="Leave empty to stay anonymous"></label>
      <p class="muted small">Don't put your real name, school or anything private in your art or here.</p>
      <div class="dlg-actions"><button class="btn ghost" data-no>Cancel</button><button class="btn primary" data-yes>${icon('upload')}<span>Send it in</span></button></div>`;
    const name = $('#tplname', box);
    const pick = (id) => {
      picked = id;
      $$('.tpl-pick-item', box).forEach((b) => b.classList.toggle('on', b.dataset.id === id));
      name.value = projects.find((p) => p.id === id)?.name || '';
    };
    pick(picked);
    $$('.tpl-pick-item', box).forEach((b) => { b.onclick = () => pick(b.dataset.id); });
    $('[data-no]', box).onclick = () => close();
    const send = $('[data-yes]', box);
    send.onclick = async () => {
      send.disabled = true;
      try {
        const doc = await getDoc(picked);
        if (!doc) throw new Error('That project could not be found.');
        const body = { doc, name: name.value.trim() || doc.name, by: $('#tplby', box).value.trim(), kind: kindOf(doc), thumb: await thumbOf(doc).catch(() => '') };
        if (JSON.stringify(body).length > MAX_SEND) throw new Error('That one is too big to send. Try one with smaller pictures.');
        await api('POST', '/api/templates', body);
        close(true);
        toast('Sent! It shows up in Templates once it has been checked.', 'ok');
      } catch (error) {
        send.disabled = false;
        toast(error.message, 'warn');
      }
    };
  }, { wide: true });
}
