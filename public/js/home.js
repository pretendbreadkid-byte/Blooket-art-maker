// The home screen: folders, projects and the new project steps.
import {
  listFolders, listProjects, saveFolder, deleteFolder, saveDoc, getDoc, deleteProject,
} from './store.js';
import { newDoc, uid, clamp } from './model.js';
import { esc } from './render.js';
import { session, isPlus, logOut } from './session.js';
import { syncArt, flushUploads, resetSync } from './sync.js';
import { plusDialog } from './plus.js';
import { $, $$, icon, askText, confirmBox, dialog, menu, toast } from './ui.js';

const MIN_SIZE = 16;
const MAX_SIZE = 8192;
const ROUNDED_CANVAS = 0.12;

const SIZE_PRESETS = [
  { name: 'Small square', w: 512, h: 512 },
  { name: 'Large square', w: 1024, h: 1024 },
  { name: 'Wide screen', w: 1920, h: 1080 },
  { name: 'Tall phone', w: 1080, h: 1920 },
  { name: 'Poster', w: 1200, h: 1600 },
  { name: 'Banner', w: 1500, h: 500 },
];

let currentFolder = 'all';
let host = null;
let leave = () => {};

export async function renderHome(root, onLeave = leave) {
  host = root;
  leave = onLeave;
  document.title = 'Blooksmith';
  const [folders, projects] = await Promise.all([listFolders(), listProjects()]);
  folders.sort((a, b) => a.name.localeCompare(b.name));
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  if (currentFolder !== 'all' && !folders.some((f) => f.id === currentFolder)) currentFolder = 'all';

  const shown = currentFolder === 'all' ? projects : projects.filter((p) => p.folderId === currentFolder);
  const count = (id) => projects.filter((p) => p.folderId === id).length;
  const title = currentFolder === 'all' ? 'All projects' : folders.find((f) => f.id === currentFolder).name;

  root.innerHTML = `<div class="home">
    <aside class="home-side">
      <a class="brand" href="#/"><span class="brand-mark"><img src="/logo.svg" alt=""></span><b>Blooksmith</b></a>
      <button class="btn primary big" id="new">${icon('plus')}<span>New project</span></button>
      <h3>Folders</h3>
      <ul class="folders">
        <li><button class="folder ${currentFolder === 'all' ? 'on' : ''}" data-f="all">${icon('shapes')}<span>All projects</span><em>${projects.length}</em></button></li>
        ${folders.map((f) => `<li class="folder-row">
          <button class="folder ${currentFolder === f.id ? 'on' : ''}" data-f="${f.id}">${icon('folder')}<span>${esc(f.name)}</span><em>${count(f.id)}</em></button>
          <button class="ib folder-more" data-more="${f.id}" aria-label="Folder options for ${esc(f.name)}">${icon('dots')}</button>
        </li>`).join('')}
      </ul>
      <button class="btn ghost" id="newfolder">${icon('folderplus')}<span>New folder</span></button>
      <div class="grow"></div>
      ${isPlus() ? '' : `<button class="plus-card" id="getplus"><span class="plus-badge">PLUS</span><b>More shapes and exports</b><small>Free for now</small></button>`}
      <div class="who">
        <span class="who-icon">${icon('user')}</span>
        <span class="who-name"><b>${esc(session.user?.name || 'Guest')}</b>${isPlus() ? '<span class="plus-badge">PLUS</span>' : ''}</span>
        <button class="ib" id="logout" title="${session.guest ? 'Back to the welcome screen' : 'Log out'}" aria-label="Log out">${icon('logout')}</button>
      </div>
      <a class="admin-link" href="#/admin">${icon('shield')}<span>Admin: shapes catalog</span></a>
    </aside>
    <main class="home-main">
      ${session.guest ? '<p class="guest-note">You are playing as a guest. Your art disappears when you close this page, so export anything you want to keep.</p>' : ''}
      <h1>${esc(title)}</h1>
      ${shown.length ? `<div class="cards">${shown.map(card).join('')}</div>` : emptyState()}
    </main>
  </div>`;

  $('#new', root).onclick = () => newProjectWizard(folders);
  $('#newfolder', root).onclick = () => createFolder();
  $('#getplus', root)?.addEventListener('click', async () => { if (await plusDialog()) renderHome(root); });
  $('#logout', root).onclick = async () => {
    await flushUploads();
    resetSync();
    logOut();
    leave();
  };
  $('.empty-new', root)?.addEventListener('click', () => newProjectWizard(folders));

  $$('[data-f]', root).forEach((b) => {
    b.onclick = () => { currentFolder = b.dataset.f; renderHome(root); };
    b.addEventListener('dragover', (e) => { e.preventDefault(); b.classList.add('drop'); });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', async (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/project');
      if (id) await moveProject(id, b.dataset.f === 'all' ? null : b.dataset.f);
      renderHome(root);
    });
  });

  $$('[data-more]', root).forEach((b) => {
    const folder = folders.find((f) => f.id === b.dataset.more);
    b.onclick = () => menu(b, [
      { label: 'Rename', onClick: () => renameFolder(folder) },
      { label: 'Delete folder', icon: 'trash', danger: true, onClick: () => removeFolder(folder, count(folder.id)) },
    ]);
  });

  $$('.card', root).forEach((c) => {
    const id = c.dataset.id;
    const meta = projects.find((p) => p.id === id);
    c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/project', id));
    $('.card-more', c).onclick = (e) => {
      e.preventDefault();
      projectMenu(e.currentTarget, meta, folders);
    };
  });

  // Shows what is here straight away, then brings in anything from other devices.
  syncArt().then((changed) => {
    if (changed && root.querySelector('.home')) renderHome(root);
  });
}

function card(p) {
  const ratio = `${p.width} / ${p.height}`;
  return `<a class="card" href="#/p/${p.id}" data-id="${p.id}" draggable="true">
    <span class="thumb">${p.thumb ? `<img src="${esc(p.thumb)}" alt="" style="aspect-ratio:${ratio}">` : `<span class="thumb-blank" style="aspect-ratio:${ratio}"></span>`}</span>
    <span class="card-foot">
      <span class="card-text"><b>${esc(p.name)}</b><small>${p.width} × ${p.height}${p.animated ? ' · Animation' : ''}</small></span>
      <button class="ib card-more" aria-label="Options for ${esc(p.name)}">${icon('dots')}</button>
    </span>
  </a>`;
}

function emptyState() {
  return `<div class="empty">
    <div class="empty-art">${icon('pencil')}</div>
    <h2>Nothing here yet</h2>
    <p class="muted">Start a new project and make something great.</p>
    <button class="btn primary empty-new">${icon('plus')}<span>New project</span></button>
  </div>`;
}

async function createFolder() {
  const name = await askText({ title: 'New folder', label: 'Folder name', value: 'My folder', action: 'Create folder' });
  if (!name) return null;
  const folder = { id: uid('f'), name };
  await saveFolder(folder);
  currentFolder = folder.id;
  renderHome(host);
  return folder;
}

async function renameFolder(folder) {
  const name = await askText({ title: 'Rename folder', label: 'Folder name', value: folder.name });
  if (!name) return;
  await saveFolder({ ...folder, name });
  renderHome(host);
}

async function removeFolder(folder, projectCount) {
  const ok = await confirmBox({
    title: 'Delete this folder?',
    message: projectCount
      ? `Your ${projectCount} project${projectCount > 1 ? 's' : ''} will not be deleted. They will stay in All projects.`
      : `"${folder.name}" is empty.`,
    action: 'Delete folder', danger: true,
  });
  if (!ok) return;
  await deleteFolder(folder.id);
  renderHome(host);
}

async function moveProject(id, folderId) {
  const doc = await getDoc(id);
  const meta = (await listProjects()).find((p) => p.id === id);
  doc.folderId = folderId;
  await saveDoc(doc, meta?.thumb);
}

function projectMenu(anchor, meta, folders) {
  menu(anchor, [
    {
      label: 'Rename',
      onClick: async () => {
        const name = await askText({ title: 'Rename project', label: 'Project name', value: meta.name });
        if (!name) return;
        const doc = await getDoc(meta.id);
        doc.name = name;
        await saveDoc(doc, meta.thumb);
        renderHome(host);
      },
    },
    {
      label: 'Move to folder',
      icon: 'folder',
      onClick: () => moveDialog(meta, folders),
    },
    {
      label: 'Make a copy',
      icon: 'copy',
      onClick: async () => {
        const doc = await getDoc(meta.id);
        await saveDoc({ ...doc, id: uid('p'), name: `${doc.name} copy`, updatedAt: Date.now() }, meta.thumb);
        renderHome(host);
      },
    },
    null,
    {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        const ok = await confirmBox({
          title: 'Delete this project?', message: `"${meta.name}" will be gone for good.`, action: 'Delete', danger: true,
        });
        if (!ok) return;
        await deleteProject(meta.id);
        renderHome(host);
      },
    },
  ]);
}

async function moveDialog(meta, folders) {
  const target = await dialog((box, close) => {
    box.innerHTML = `<h2>Move "${esc(meta.name)}"</h2>
      <div class="move-list">
        <button class="folder ${!meta.folderId ? 'on' : ''}" data-to="">${icon('shapes')}<span>No folder</span></button>
        ${folders.map((f) => `<button class="folder ${meta.folderId === f.id ? 'on' : ''}" data-to="${f.id}">${icon('folder')}<span>${esc(f.name)}</span></button>`).join('')}
      </div>`;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-to]');
      if (b) close({ id: b.dataset.to || null });
    });
  });
  if (!target) return;
  await moveProject(meta.id, target.id);
  renderHome(host);
}

/* ---------- New project steps ---------- */

function newProjectWizard(folders) {
  const state = {
    name: 'My new art',
    folderId: currentFolder === 'all' ? null : currentFolder,
    animated: null,
    animMode: 'keys',
    width: 1024,
    height: 1024,
    rounded: false,
  };
  let step = 0;

  return dialog((box, close) => {
    const dots = () => `<ol class="steps">${['Name', 'Type', 'Size'].map((s, i) => `<li class="${i === step ? 'on' : ''} ${i < step ? 'done' : ''}">${s}</li>`).join('')}</ol>`;

    const stepName = () => {
      box.innerHTML = `${dots()}<h2>What should we call it?</h2>
        <form>
          <label class="field"><span>Project name</span><input id="pname" maxlength="80" value="${esc(state.name)}" autofocus></label>
          <label class="field"><span>Put it in a folder</span>
            <select id="pfolder">
              <option value="">No folder</option>
              ${folders.map((f) => `<option value="${f.id}" ${state.folderId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
            </select>
          </label>
          <div class="dlg-actions">
            <button type="button" class="btn ghost" data-no>Cancel</button>
            <button class="btn primary">Next</button>
          </div>
        </form>`;
      const input = $('#pname', box);
      input.focus();
      input.select();
      $('[data-no]', box).onclick = () => close();
      $('form', box).onsubmit = (e) => {
        e.preventDefault();
        state.name = input.value.trim() || 'Untitled';
        state.folderId = $('#pfolder', box).value || null;
        step = 1;
        stepType();
      };
    };

    const stepType = () => {
      box.innerHTML = `${dots()}<h2>Do you want it to be animated?</h2>
        <div class="type-cards">
          <button class="type-card ${state.animated === false ? 'on' : ''}" data-v="0" autofocus>
            <span class="type-art">${icon('image')}</span><b>No, a picture</b><small>One still image</small>
          </button>
          <button class="type-card ${state.animated === true ? 'on' : ''}" data-v="1">
            <span class="type-art">${icon('play')}</span><b>Yes, animated</b><small>Make things move</small>
          </button>
        </div>
        <div class="dlg-actions"><button class="btn ghost" data-back>Back</button></div>`;
      $('[data-back]', box).onclick = () => { step = 0; stepName(); };
      $$('.type-card', box).forEach((b) => {
        b.onclick = () => {
          state.animated = b.dataset.v === '1';
          if (state.animated) { stepMotion(); return; }
          step = 2;
          stepSize();
        };
      });
    };

    const stepMotion = () => {
      box.innerHTML = `${dots()}<h2>How should it animate?</h2>
        <div class="type-cards">
          <button class="type-card ${state.animMode === 'keys' ? 'on' : ''}" data-m="keys" autofocus>
            <span class="type-art">${icon('diamond')}</span><b>Keyframes</b><small>Set where things go, and they slide there smoothly</small>
          </button>
          <button class="type-card ${state.animMode === 'pages' ? 'on' : ''}" data-m="pages">
            <span class="type-art">${icon('page')}</span><b>Pages</b><small>Draw each page, and it flips from one to the next</small>
          </button>
        </div>
        <div class="dlg-actions"><button class="btn ghost" data-back>Back</button></div>`;
      $('[data-back]', box).onclick = stepType;
      $$('.type-card', box).forEach((b) => {
        b.onclick = () => { state.animMode = b.dataset.m; step = 2; stepSize(); };
      });
    };

    const stepSize = () => {
      box.innerHTML = `${dots()}<h2>How big should the frame be?</h2>
        <div class="size-grid">
          ${SIZE_PRESETS.map((p, i) => {
            const k = 44 / Math.max(p.w, p.h);
            return `<button class="size-card" data-i="${i}">
              <span class="size-art"><i class="${state.rounded ? 'round' : ''}" style="width:${p.w * k}px;height:${p.h * k}px"></i></span>
              <b>${p.name}</b><small>${p.w} × ${p.h}</small>
            </button>`;
          }).join('')}
        </div>
        <form class="size-custom">
          <span class="size-custom-label">Canvas corners</span>
          <div class="corner-pick">
            <label class="radio"><input type="radio" name="corners" value="square" ${state.rounded ? '' : 'checked'}><i class="corner-art"></i><b>Square</b></label>
            <label class="radio"><input type="radio" name="corners" value="round" ${state.rounded ? 'checked' : ''}><i class="corner-art round"></i><b>Rounded</b></label>
          </div>
          <span class="size-custom-label">Or your own size</span>
          <label class="field"><span>Width</span><input type="number" id="pw" min="${MIN_SIZE}" max="${MAX_SIZE}" value="${state.width}"></label>
          <span class="times">×</span>
          <label class="field"><span>Height</span><input type="number" id="ph" min="${MIN_SIZE}" max="${MAX_SIZE}" value="${state.height}"></label>
          <span class="muted">pixels</span>
          <p class="size-err" hidden></p>
          <div class="dlg-actions">
            <button type="button" class="btn ghost" data-back>Back</button>
            <button class="btn primary" id="create">${icon('check')}<span>Create project</span></button>
          </div>
        </form>`;
      const w = $('#pw', box), h = $('#ph', box);
      const mark = () => $$('.size-card', box).forEach((c) => {
        const p = SIZE_PRESETS[+c.dataset.i];
        c.classList.toggle('on', p.w === +w.value && p.h === +h.value);
      });
      mark();
      w.oninput = h.oninput = mark;
      $$('[name=corners]', box).forEach((r) => {
        r.onchange = () => {
          state.rounded = r.value === 'round';
          $$('.size-art i', box).forEach((i) => i.classList.toggle('round', state.rounded));
        };
      });
      $$('.size-card', box).forEach((c) => {
        c.onclick = () => {
          const p = SIZE_PRESETS[+c.dataset.i];
          w.value = p.w; h.value = p.h;
          mark();
        };
      });
      $('[data-back]', box).onclick = () => {
        step = 1;
        if (state.animated) stepMotion();
        else stepType();
      };
      $('form', box).onsubmit = async (e) => {
        e.preventDefault();
        const width = Math.round(+w.value), height = Math.round(+h.value);
        if (width !== clamp(width, MIN_SIZE, MAX_SIZE) || height !== clamp(height, MIN_SIZE, MAX_SIZE)) {
          const err = $('.size-err', box);
          err.textContent = `Width and height must be between ${MIN_SIZE} and ${MAX_SIZE}.`;
          err.hidden = false;
          return;
        }
        const doc = newDoc({ ...state, width, height });
        doc.cornerRadius = state.rounded ? Math.round(Math.min(width, height) * ROUNDED_CANVAS) : 0;
        try {
          await saveDoc(doc);
        } catch {
          toast('Could not save the project in this browser.', 'warn');
          return;
        }
        close();
        location.hash = `#/p/${doc.id}`;
      };
    };

    stepName();
  }, { wide: true });
}
