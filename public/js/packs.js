// Packs: turn your art into a Blooket pack, then test open it. A pack is saved as
// a project with a `pack` field, so it reaches the account the same way art does.
import { deleteProject, getDoc, listProjects, saveDoc } from './store.js';
import { newDoc, uid } from './model.js';
import { esc, exportSVG, svgDataUrl } from './render.js';
import { fetchBlooks } from './pieces.js';
import { uploadedAssets } from './uploads.js';
import {
  RARITIES, balanceOdds, chanceOf, gemOf, newPack, pickBlook, pullsOf, rarityOf, recordPull, whyNotOpen,
} from './pack-rules.js';
import { confettiLayer } from './confetti.js';
import { $, $$, confirmBox, dialog, html, icon, toast } from './ui.js';

const BLOOK_SIZE = 512;
const ART_SIZE = 800;
const TILES = 96;
const SHAKE_MS = 750;
const WAVE_MS_PER_PX = 0.28;
const WAVE_MS = 700;
const AMOUNTS = [1, 10, 100];

export const packVisual = (art) => `<span class="pack-visual"><img src="/pack/foil.png" alt="">${art ? `<img class="pack-art" src="${esc(art)}" alt="">` : '<i class="pack-art pack-blank">Pack art</i>'}</span>`;

// Packs keep their own copy of each picture, sized down, so they stay small
// and keep working if the project it came from changes.
async function toPicture(href, max) {
  const img = new Image();
  img.src = href;
  await img.decode();
  const scale = max / Math.max(img.naturalWidth || max, img.naturalHeight || max);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((img.naturalWidth || max) * scale);
  canvas.height = Math.round((img.naturalHeight || max) * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', 0.92);
}

/* ---------- Choosing a picture ---------- */

// Three sources: your projects, your uploads and the Blook assets.
function chooseAsset(title, template, max) {
  const sources = {
    'My projects': async () => (await listProjects())
      .filter((p) => !p.pack)
      .sort((a, b) => (b.template === template) - (a.template === template) || b.updatedAt - a.updatedAt)
      .map((p) => ({ name: p.name, thumb: p.thumb, read: async () => svgDataUrl(exportSVG(await getDoc(p.id))) })),
    Uploads: uploadedAssets,
    'Blook assets': async () => (await fetchBlooks()).map((b) => {
      const url = `/blooks/${encodeURIComponent(b.file)}`;
      return { name: b.name, thumb: url, read: async () => url };
    }),
  };
  return dialog((box, close) => {
    box.innerHTML = `<h2>${esc(title)}</h2>
      <div class="pick-tabs">${Object.keys(sources).map((s) => `<button type="button" data-s="${s}">${s}</button>`).join('')}</div>
      <div class="pick-grid"></div>
      <div class="dlg-actions"><button class="btn ghost" data-no>Cancel</button></div>`;
    $('[data-no]', box).onclick = () => close();
    const grid = $('.pick-grid', box);
    const show = async (source) => {
      $$('.pick-tabs button', box).forEach((b) => b.classList.toggle('on', b.dataset.s === source));
      grid.innerHTML = '<p class="muted">Loading...</p>';
      const items = await sources[source]().catch(() => []);
      grid.innerHTML = items.length ? '' : '<p class="muted">Nothing here yet.</p>';
      for (const item of items) {
        const b = html(`<button type="button" class="pick-item" title="${esc(item.name)}"><img alt="" loading="lazy"><span>${esc(item.name)}</span></button>`);
        if (item.thumb) $('img', b).src = item.thumb;
        b.onclick = async () => {
          try {
            close({ name: item.name, href: await toPicture(await item.read(), max) });
          } catch {
            toast(`${item.name} could not be used.`, 'warn');
          }
        };
        grid.append(b);
      }
    };
    $$('.pick-tabs button', box).forEach((b) => { b.onclick = () => show(b.dataset.s); });
    show('My projects');
  }, { wide: true });
}

/* ---------- The pack editor ---------- */

export async function savePack(doc) {
  await saveDoc(doc, doc.pack.art);
}

export function newPackProject() {
  const doc = newDoc({ name: 'My pack' });
  doc.pack = newPack();
  return doc;
}

export function editPack(doc, onChange) {
  const pack = doc.pack;
  let opened = false;

  const keep = async () => {
    doc.name = doc.name.trim() || 'My pack';
    await savePack(doc);
    onChange();
  };

  return dialog((box, close) => {
    const draw = () => {
      const total = pack.blooks.reduce((sum, b) => sum + Math.max(0, b.odds), 0);
      box.innerHTML = `<h2>Make your pack</h2>
        <div class="pack-maker">
          <div class="pack-side">
            <button type="button" class="pack-pick" id="packart" title="Choose the pack art">${packVisual(pack.art)}</button>
            <label class="field"><span>Pack name</span><input id="packname" maxlength="60" value="${esc(doc.name)}"></label>
            <label class="field"><span>Price in tokens</span><input id="packprice" type="number" min="0" max="1000000" value="${pack.price}"></label>
            <span class="field"><span>Blook background</span>
              <button type="button" class="back-pick" id="packback">${pack.back ? `<img src="${esc(pack.back)}" alt="">` : '<i>Choose a background</i>'}</button></span>
          </div>
          <div class="pack-list">
            <div class="pack-list-head"><b>Blooks</b><button type="button" class="btn ghost" id="addblook">${icon('plus')}<span>Add a Blook</span></button></div>
            ${pack.blooks.length ? '' : '<p class="muted">Add the Blooks that can come out of this pack.</p>'}
            ${pack.blooks.map((b) => `<div class="pack-row" data-b="${b.id}">
              <button type="button" class="pack-thumb" title="See this Blook"><img src="${esc(b.picture)}" alt=""></button>
              <input class="pack-name" maxlength="40" value="${esc(b.name)}" aria-label="Blook name">
              <select class="pack-rarity" aria-label="Rarity">${Object.keys(RARITIES).map((r) => `<option ${r === b.rarity ? 'selected' : ''}>${r}</option>`).join('')}</select>
              <label class="pack-odds"><input type="number" min="0" max="100" step="0.01" value="${b.odds}" aria-label="Odds"><span>%</span></label>
              <button type="button" class="ib pack-x" aria-label="Remove ${esc(b.name)}">${icon('x')}</button>
            </div>`).join('')}
            ${pack.blooks.length ? `<p class="muted small pack-total">Odds add up to <b>${Math.round(total * 100) / 100}%</b>. ${Math.abs(total - 100) > 0.01 ? '<button type="button" class="linkish" id="balance">Make it 100%</button>' : ''}</p>` : ''}
          </div>
        </div>
        <p class="size-err" role="alert" hidden></p>
        <div class="dlg-actions">
          <button type="button" class="btn ghost danger" id="packdelete">${icon('trash')}<span>Delete</span></button>
          <button type="button" class="btn ghost" id="packopen">${icon('play')}<span>Test open</span></button>
          <button type="button" class="btn primary" id="packdone">Save</button>
        </div>`;
      wire();
    };

    const readForm = () => {
      doc.name = $('#packname', box).value;
      pack.price = Math.max(0, Math.round(+$('#packprice', box).value) || 0);
      $$('.pack-row', box).forEach((row) => {
        const blook = pack.blooks.find((b) => b.id === row.dataset.b);
        blook.name = $('.pack-name', row).value.trim() || 'Blook';
        blook.rarity = $('.pack-rarity', row).value;
        blook.odds = Math.max(0, +$('.pack-odds input', row).value || 0);
      });
    };

    const wire = () => {
      $('#packart', box).onclick = async () => {
        readForm();
        const asset = await chooseAsset('Choose the pack art', 'pack', ART_SIZE);
        if (asset) pack.art = asset.href;
        draw();
      };
      $('#packback', box).onclick = async () => {
        readForm();
        const asset = await chooseAsset('Choose the Blook background', 'background', BLOOK_SIZE);
        if (asset) pack.back = asset.href;
        draw();
      };
      $('#addblook', box).onclick = async () => {
        readForm();
        const asset = await chooseAsset('Add a Blook', 'blook', BLOOK_SIZE);
        if (asset) pack.blooks.push({ id: uid('b'), name: asset.name, picture: asset.href, rarity: 'Uncommon', odds: RARITIES.Uncommon.odds });
        draw();
      };
      $('#balance', box)?.addEventListener('click', () => {
        readForm();
        pack.blooks = balanceOdds(pack.blooks);
        draw();
      });
      $$('.pack-row', box).forEach((row) => {
        $('.pack-x', row).onclick = () => {
          readForm();
          pack.blooks = pack.blooks.filter((b) => b.id !== row.dataset.b);
          draw();
        };
        $('.pack-thumb', row).onclick = () => {
          readForm();
          blookCard(pack.blooks.find((b) => b.id === row.dataset.b), doc);
        };
      });
      $('#packdone', box).onclick = async () => {
        readForm();
        await keep();
        close();
      };
      $('#packopen', box).onclick = async () => {
        readForm();
        const why = whyNotOpen(pack);
        if (why) {
          const err = $('.size-err', box);
          err.textContent = why;
          err.hidden = false;
          return;
        }
        opened = true;
        await keep();
        openPack(doc);
      };
      $('#packdelete', box).onclick = async () => {
        const sure = await confirmBox({ title: 'Delete this pack?', message: `"${doc.name}" will be gone for good. Your art stays.`, action: 'Delete', danger: true });
        if (!sure) return;
        await deleteProject(doc.id);
        onChange();
        close();
      };
    };
    draw();
  }, { wide: true }).then(() => opened);
}

export function blookCard(blook, doc) {
  const rarity = rarityOf(blook.rarity);
  const pulled = pullsOf(doc.pack, blook);
  return dialog((box, close) => {
    box.classList.add('blook-card');
    box.innerHTML = `<button class="blook-card-x" aria-label="Close">${icon('x')}</button>
      <div class="blook-card-art" style="${doc.pack.back ? `background-image:url('${esc(doc.pack.back)}')` : ''}"><img src="${esc(blook.picture)}" alt=""></div>
      <div class="blook-card-text">
        <h2>${esc(blook.name)}</h2>
        <p>${esc(doc.name)}</p>
        <div class="blook-card-chips">
          <span><img src="${gemOf(blook.rarity)}" alt="">${esc(blook.rarity)}</span>
          <span><i class="token">B</i>${rarity.sells}</span>
          <span>${chanceOf(blook, doc.pack.blooks).toFixed(1)}%</span>
        </div>
        ${pulled ? `<p class="blook-card-total">${pulled} total</p>` : ''}
      </div>`;
    $('.blook-card-x', box).onclick = () => close();
  }, { wide: true });
}

/* ---------- My Blooks ---------- */

// Everything that can come out of your packs. Ones you haven't pulled stay hidden.
export async function drawCollection(host, metas) {
  const docs = (await Promise.all(metas.map((m) => getDoc(m.id)))).filter((d) => d?.pack.blooks.length);
  const order = Object.keys(RARITIES);
  const sorted = (doc) => [...doc.pack.blooks].sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity));
  host.innerHTML = docs.length ? docs.map((doc) => `<section class="my-pack" data-id="${doc.id}">
      <h2>${esc(doc.name)}</h2>
      <div class="my-grid">${sorted(doc).map((b) => {
        const pulled = pullsOf(doc.pack, b);
        return `<button class="my-blook ${pulled ? '' : 'locked'}" data-b="${b.id}" title="${pulled ? esc(b.name) : 'Not pulled yet'}" ${pulled ? '' : 'disabled'}>
          <img src="${esc(b.picture)}" alt="${pulled ? esc(b.name) : ''}">
          ${pulled ? `<em style="background:${rarityOf(b.rarity).color}">${pulled}</em>` : icon('lock')}
        </button>`;
      }).join('')}</div>
    </section>`).join('') : '<p class="muted">Add some Blooks to a pack, then test open it.</p>';
  $$('.my-pack', host).forEach((section) => {
    const doc = docs.find((d) => d.id === section.dataset.id);
    $$('.my-blook:not(.locked)', section).forEach((b) => {
      b.onclick = () => blookCard(doc.pack.blooks.find((x) => x.id === b.dataset.b), doc);
    });
  });
}

/* ---------- Test opening ---------- */

const tiles = () => Array.from({ length: TILES }, () => `<i style="--glow:${(Math.random() * 0.62 + 0.38).toFixed(2)}"></i>`).join('');

// Chroma and Unique throw their own gem in with the confetti.
const gemImages = new Map();
function gemImage(name) {
  if (!gemImages.has(name)) gemImages.set(name, Object.assign(new Image(), { src: gemOf(name) }));
  return gemImages.get(name);
}

function celebrate(confetti, name) {
  const { confetti: c } = rarityOf(name);
  confetti.fire(c.from, { ...c, images: c.gems ? [gemImage(name)] : [] });
}

// The diagonal wave: each tile flips over in turn, starting from the bottom right.
function measureWave(stage) {
  const box = stage.getBoundingClientRect();
  $$('.opener-tiles i', stage).forEach((tile) => {
    const r = tile.getBoundingClientRect();
    tile.style.setProperty('--d', `${Math.max(0, Math.round((box.right - r.left + box.bottom - r.top) * WAVE_MS_PER_PX))}ms`);
  });
}

function wave(stage, color) {
  stage.dataset.wave = stage.dataset.wave === 'a' ? 'b' : 'a';
  if (color) stage.style.setProperty('--rarity', color);
  stage.classList.toggle('lit', !!color);
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function openPack(doc) {
  const stage = html(`<div class="opener" role="dialog" aria-modal="true" aria-label="Test open ${esc(doc.name)}">
    <div class="opener-tiles" aria-hidden="true">${tiles()}</div>
    <button class="opener-x" aria-label="Close">${icon('x')}</button>
    <span class="opener-count" aria-hidden="true">1/1</span>
    <div class="opener-body"></div>
  </div>`);
  const body = $('.opener-body', stage);
  const count = $('.opener-count', stage);
  const confetti = confettiLayer(stage);
  let amount = 1;
  let done = 0;
  let closed = false;

  const leave = () => { closed = true; confetti.stop(); stage.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); leave(); } };
  addEventListener('keydown', onKey, true);
  $('.opener-x', stage).onclick = leave;

  const showCount = () => { count.textContent = `${Math.max(done, 1)}/${amount}`; };

  const showPack = () => {
    done = 0;
    wave(stage, null);
    body.innerHTML = `<button class="opener-pack" aria-label="Open the pack">${packVisual(doc.pack.art)}</button>
      <div class="opener-amounts">${AMOUNTS.map((n) => `<button class="${n === amount ? 'on' : ''}" data-n="${n}">\u00d7${n}</button>`).join('')}</div>`;
    showCount();
    $('.opener-pack', body).onclick = tear;
    $$('.opener-amounts button', body).forEach((b) => {
      b.onclick = () => {
        amount = +b.dataset.n;
        $$('.opener-amounts button', body).forEach((x) => x.classList.toggle('on', x === b));
        showCount();
      };
    });
  };

  const pull = () => {
    const blook = pickBlook(doc.pack.blooks, Math.random());
    const isNew = recordPull(doc.pack, blook);
    done += 1;
    return { blook, isNew };
  };

  const tear = async () => {
    const button = $('.opener-pack', body);
    button.disabled = true;
    button.classList.add('shake');
    $('.opener-amounts', body).remove();
    await wait(SHAKE_MS);
    next();
  };

  const next = async () => {
    confetti.stop();
    if (stage.classList.contains('lit')) {
      body.innerHTML = '';
      wave(stage, null);
      await wait(WAVE_MS);
    }
    if (!closed) reveal(pull());
  };

  const skip = () => {
    let last = null;
    while (done < amount) last = pull();
    savePack(doc).catch(() => {});
    reveal(last, true);
  };

  const reveal = async ({ blook, isNew }, counted = false) => {
    if (!counted) savePack(doc).catch(() => {});
    showCount();
    const rarity = rarityOf(blook.rarity);
    body.innerHTML = '';
    stage.dataset.rarity = blook.rarity.toLowerCase();
    wave(stage, rarity.color);
    await wait(rarity.intro);
    if (closed) return;
    const more = done < amount;
    body.innerHTML = `<div class="reveal-card enter-${rarity.entrance}" style="${doc.pack.back ? `background-image:url('${esc(doc.pack.back)}')` : ''}">
        <b class="reveal-name">${esc(blook.name)}</b>
        <b class="reveal-rarity">${esc(blook.rarity)}</b>
        <img src="${esc(blook.picture)}" alt="">
        <b class="reveal-odds">${chanceOf(blook, doc.pack.blooks).toFixed(1)}%${isNew ? ' – NEW!' : ''}</b>
      </div>
      <div class="opener-next">
        <button class="btn primary big opener-again">${more ? 'Next' : 'Open another'}</button>
        ${more ? '<button class="btn ghost big opener-skip">Skip to the end</button>' : ''}
      </div>`;
    celebrate(confetti, blook.rarity);
    $('.opener-again', body).onclick = more ? next : () => { confetti.stop(); showPack(); };
    $('.opener-skip', body)?.addEventListener('click', skip);
  };

  showPack();
  document.body.append(stage);
  measureWave(stage);
}
