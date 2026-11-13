// The welcome page: what Blook Berry does, art made in it, tutorials, and ways in.
import { markStarted } from './session.js';
import { fetchBlooks } from './pieces.js';
import { newDoc } from './model.js';
import { saveDoc } from './store.js';
import { TEMPLATES } from './templates.js';
import { openWithTool } from './editor.js';
import { showTestPage } from './home.js';
import { esc } from './render.js';
import { $, $$, icon, toast } from './ui.js';

// Each card opens straight into that thing.
const FEATURES = [
  ['draw', 'pencil', 'Draw and shape', 'Pencil, shapes, curves and text. Warp, weld and smooth anything you make.', 'Start a drawing'],
  ['blook', 'blook', 'The real Blook look', 'Thick outlines, underbelly shadows, shine and textures in one click.', 'Make a Blook'],
  ['animate', 'play', 'Animate', 'Make your Blook bounce, blink and wave, then export it to play anywhere.', 'Animate a Blook'],
  ['packs', 'pack', 'Test your own packs', 'Turn your Blooks into a pack and open it with the real odds and confetti.', 'Open the pack tester'],
];

// Art made in Blook Berry. Six of them, picked fresh each visit, float at the top.
const SHOWCASE_ART = [
  ['pumpkin-dragon.svg', 'Pumpkin Dragon'], ['christmas-tree-dragon.svg', 'Christmas Tree Dragon'], ['battle-scarred-mike.svg', 'Battle-Scarred Mike'],
  ['gold-bread-3.svg', 'Gold Bread'], ['silver-play-button.svg', 'Silver Play Button'], ['frozen-ted.svg', 'Frozen Ted'],
  ['green-screen.svg', 'Green Screen'], ['heisenberg-sketch.png', 'Heisenberg Sketch'], ['methylamine.png', 'Methylamine'],
];
const SHOWCASE = 6;
const GALLERY = 12;
const shuffled = (list) => [...list].sort(() => Math.random() - 0.5);

function blookDoc(name, animated) {
  const t = TEMPLATES.blook;
  const doc = newDoc({ name, width: t.width, height: t.height, animated, animMode: 'keys' });
  return Object.assign(doc, { template: 'blook', overlay: true, cornerRadius: t.radius, background: t.background });
}

async function go(what) {
  markStarted();
  if (what === 'packs') { showTestPage(); location.hash = '#/art'; return; }
  const doc = what === 'draw' ? newDoc({ name: 'My drawing' })
    : blookDoc(what === 'animate' ? 'My animated Blook' : 'My Blook', what === 'animate');
  try {
    await saveDoc(doc);
    if (what === 'draw') openWithTool('pencil');
    location.hash = `#/p/${doc.id}`;
  } catch {
    toast('That could not start. Try again.', 'warn');
  }
}

// returning: this browser already has art, so the top button says "My art".
export async function renderWelcome(root, returning = false) {
  document.title = 'Blook Berry · Make your own Blooket-style Blooks';
  root.innerHTML = `<div class="landing">
    <header class="land-top">
      <a class="land-brand" href="#/"><span class="brand-mark" data-sideways-logo><img src="/logo.svg" alt=""></span><b>Blook Berry</b></a>
      <nav>
        <a class="land-nav-tuts" href="/tutorials">${icon('play')}<span>Tutorials</span></a>
        <button class="btn primary" data-start>${returning ? 'My art' : 'Start drawing'}</button>
      </nav>
    </header>
    <section class="land-hero">
      <div class="land-copy">
        <h1>Make your own Blooks</h1>
        <p>A free art maker for Blooket-style art. Draw a Blook, give it the real look, animate it, and test open your own packs.</p>
        <div class="land-ctas">
          <button class="btn primary big" data-start>${icon('pencil')}<span>Start drawing</span></button>
          <a class="btn ghost big" href="/tutorials">${icon('play')}<span>Watch tutorials</span></a>
        </div>
        <p class="land-small">No sign-up. Your art saves right in your browser.</p>
      </div>
      <div class="land-show" aria-hidden="true"></div>
    </section>
    <section class="land-tuts">
      <div class="land-tuts-head">
        <h2>Learn how</h2>
        <p>Short videos that take you from a blank canvas to a finished Blook.</p>
      </div>
      <div class="land-tut-grid"></div>
      <a class="btn primary big land-tuts-all" href="/tutorials">${icon('play')}<span>See all tutorials</span></a>
    </section>
    <section class="land-features">${FEATURES.map(([id, ic, title, text, cta]) => `<button class="land-feature" data-go="${id}">
      <span class="land-feature-ico">${icon(ic)}</span><h2>${title}</h2><p>${text}</p><b class="land-go">${cta} →</b></button>`).join('')}</section>
    <section class="land-gallery-wrap">
      <h2>Blooks you can start from</h2>
      <p>Over 200 Blooks to drag in, recolour, take apart and remix.</p>
      <div class="land-gallery"></div>
    </section>
    <section class="land-end">
      <h2>Ready to make one?</h2>
      <button class="btn primary big" data-start>${icon('pencil')}<span>Start drawing</span></button>
    </section>
    <footer class="land-foot"><a href="/tutorials">Tutorials</a> · <a href="/privacy.html">Privacy</a> · Blook Berry is a fan-made tool and is not made by Blooket.</footer>
  </div>`;
  $$('[data-start]', root).forEach((b) => { b.onclick = () => { markStarted(); location.hash = '#/art'; }; });
  $$('[data-go]', root).forEach((b) => { b.onclick = () => go(b.dataset.go); });

  $('.land-show', root).innerHTML = shuffled(SHOWCASE_ART).slice(0, SHOWCASE)
    .map(([file, name], i) => `<span class="land-tile t${i}"><img src="/showcase/${esc(file)}" alt="${esc(name)}"></span>`).join('');

  const tutorials = fetch('/api/tutorials').then((r) => r.json()).then((d) => d.tutorials || []).catch(() => []);
  const blooks = fetchBlooks();

  const list = await tutorials;
  const grid = $('.land-tut-grid', root);
  if (grid) {
    grid.innerHTML = list.length
      ? list.slice(0, 3).map((t) => `<a class="land-tut" href="/tutorials/${esc(t.slug)}">
          <span class="land-tut-pic">${t.thumb ? `<img src="${esc(t.thumb)}" alt="" loading="lazy">` : '<img src="/logo.svg" alt="" class="noimg">'}<i class="land-tut-play"></i></span><b>${esc(t.name)}</b></a>`).join('')
      : `<div class="land-tut-soon"><span>${icon('play')}</span><b>The first tutorials are on the way.</b><small>Check the Tutorials page soon.</small></div>`;
  }

  const gallery = $('.land-gallery', root);
  const picks = shuffled((await blooks).filter((b) => !/animation|shape/.test(b.file))).slice(0, GALLERY);
  if (gallery) gallery.innerHTML = picks.map((b) => `<figure><img src="/blooks/${esc(encodeURIComponent(b.file))}" alt="${esc(b.name)}" loading="lazy"><figcaption>${esc(b.name)}</figcaption></figure>`).join('');
}
