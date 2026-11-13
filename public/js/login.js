// The welcome screen: log in, make an account, or play as a guest.
import { logIn, signUp, playAsGuest } from './session.js';
import { fetchBlooks } from './pieces.js';
import { esc } from './render.js';
import { $, $$, icon } from './ui.js';

const FLOATING_BLOOKS = 18;
const between = (lo, hi) => lo + Math.random() * (hi - lo);

// Real blooks drift up the screen, each at its own size and speed.
async function floatBlooks(layer) {
  const blooks = (await fetchBlooks()).filter((b) => !/animation|shape/.test(b.file));
  const picked = [...blooks].sort(() => Math.random() - 0.5).slice(0, FLOATING_BLOOKS);
  const lanes = picked.map((_, i) => i).sort(() => Math.random() - 0.5);
  layer.innerHTML = picked.map((b, i) => {
    const seconds = between(20, 38);
    const style = [
      `left:${((lanes[i] + between(0.1, 0.7)) / picked.length) * 100}%`,
      `width:${Math.round(between(64, 124))}px`,
      `animation-duration:${seconds}s`,
      `animation-delay:${-between(0, seconds)}s`,
      `--sway:${Math.round(between(-70, 70))}px`,
      `--spin:${Math.round(between(6, 22))}deg`,
      `--rest:${Math.round(between(4, 86))}%`,
    ].join(';');
    return `<img class="floater" src="/blooks/${esc(encodeURIComponent(b.file))}" alt="" style="${style}">`;
  }).join('');
}

const FEATURES = [
  ['pencil', 'Draw and shape', 'Pencil, shapes, curves and text. Warp, weld and smooth anything you make.'],
  ['blook', 'The real Blook look', 'Thick outlines, underbelly shadows, shine and textures in one click.'],
  ['play', 'Animate', 'Make your Blook bounce, blink and wave, then export it to play anywhere.'],
  ['pack', 'Test your own packs', 'Turn your Blooks into a pack and open it with the real odds and confetti.'],
];
const SHOWCASE = 6;
const GALLERY = 12;

// What a new visitor sees first: what the site does, real art, and a way in.
export async function renderLanding(root, onDone) {
  document.title = 'Blook Berry · Make your own Blooket-style Blooks';
  root.innerHTML = `<div class="landing">
    <header class="land-top">
      <a class="land-brand" href="#/"><span class="brand-mark" data-sideways-logo><img src="/logo.svg" alt=""></span><b>Blook Berry</b></a>
      <nav>
        <a href="/tutorials">Tutorials</a>
        <a href="#/login">Log in</a>
        <button class="btn primary" data-start>Start drawing</button>
      </nav>
    </header>
    <section class="land-hero">
      <div class="land-copy">
        <h1>Make your own Blooks</h1>
        <p>A free art maker for Blooket-style art. Draw a Blook, give it the real look, animate it, and test open your own packs.</p>
        <div class="land-ctas">
          <button class="btn primary big" data-start>${icon('play')}<span>Start drawing</span></button>
          <a class="btn ghost big" href="#/signup">${icon('user')}<span>Make a free account</span></a>
        </div>
        <p class="land-small">No account needed to try it. Make one to keep your art on any device.</p>
      </div>
      <div class="land-show" aria-hidden="true"></div>
    </section>
    <section class="land-features">${FEATURES.map(([ic, title, text]) => `<div class="land-feature"><span>${icon(ic)}</span><h2>${title}</h2><p>${text}</p></div>`).join('')}</section>
    <section class="land-gallery-wrap">
      <h2>Blooks you can start from</h2>
      <p>Over 200 Blooks to drag in, recolour, take apart and remix.</p>
      <div class="land-gallery"></div>
    </section>
    <section class="land-tuts" hidden>
      <h2>Learn how</h2>
      <div class="land-tut-grid"></div>
      <a class="btn ghost" href="/tutorials">See all tutorials</a>
    </section>
    <section class="land-end">
      <h2>Ready to make one?</h2>
      <button class="btn primary big" data-start>${icon('play')}<span>Start drawing</span></button>
    </section>
    <footer class="land-foot"><a href="/tutorials">Tutorials</a> · <a href="/privacy.html">Privacy</a> · Blook Berry is a fan-made tool and is not made by Blooket.</footer>
  </div>`;
  $$('[data-start]', root).forEach((b) => { b.onclick = () => { playAsGuest(); location.hash = '#/'; onDone(); }; });

  const blooks = (await fetchBlooks()).filter((b) => !/animation|shape/.test(b.file)).sort(() => Math.random() - 0.5);
  const pic = (b) => `<img src="/blooks/${esc(encodeURIComponent(b.file))}" alt="${esc(b.name)}" loading="lazy">`;
  const show = $('.land-show', root);
  if (show) show.innerHTML = blooks.slice(0, SHOWCASE).map((b, i) => `<span class="land-tile t${i}">${pic(b)}</span>`).join('');
  const gallery = $('.land-gallery', root);
  if (gallery) gallery.innerHTML = blooks.slice(SHOWCASE, SHOWCASE + GALLERY).map((b) => `<figure>${pic(b)}<figcaption>${esc(b.name)}</figcaption></figure>`).join('');

  try {
    const { tutorials } = await (await fetch('/api/tutorials')).json();
    const box = $('.land-tuts', root);
    if (box && tutorials?.length) {
      $('.land-tut-grid', box).innerHTML = tutorials.slice(0, 3).map((t) => `<a class="land-tut" href="/tutorials/${t.id}">
        <span>${t.hasThumb ? `<img src="/api/tutorials/${t.id}/thumb?v=${t.at}" alt="" loading="lazy">` : t.video?.kind === 'youtube' ? `<img src="https://i.ytimg.com/vi/${esc(t.video.yt)}/hqdefault.jpg" alt="" loading="lazy">` : '<img src="/logo.svg" alt="" class="noimg">'}</span><b>${esc(t.name)}</b></a>`).join('');
      box.hidden = false;
    }
  } catch { /* No tutorials to show. */ }
}

export function renderLogin(root, onDone, startMode = 'login') {
  document.title = 'Welcome · Blook Berry';
  let mode = startMode;

  root.innerHTML = `<div class="welcome">
    <div class="floaters" aria-hidden="true"></div>
    <a class="welcome-back" href="#/">${icon('back')}<span>Back</span></a>
    <section class="welcome-art">
      <div class="welcome-copy">
        <span class="brand-mark big" data-sideways-logo><img src="/logo.svg" alt=""></span>
        <h1>Blook Berry</h1>
        <p>Draw it. Warp it. Animate it.</p>
      </div>
    </section>
    <section class="welcome-form">
      <form class="login-card">
        <div class="login-tabs" role="tablist">
          <button type="button" role="tab" data-mode="login">Log in</button>
          <button type="button" role="tab" data-mode="signup">Create account</button>
        </div>
        <label class="field"><span>Username</span><input id="lname" autocomplete="username" maxlength="20" required></label>
        <label class="field"><span>Password</span><input id="lpass" type="password" autocomplete="current-password" maxlength="100" required></label>
        <p class="login-note muted small"></p>
        <p class="size-err" role="alert" hidden></p>
        <button class="btn primary big" id="lgo"></button>
        <div class="login-or"><span>or</span></div>
        <button type="button" class="btn ghost big" id="lguest">${icon('play')}<span>Play as guest</span></button>
        <p class="muted small login-guest">Guests can make art and export it, but nothing gets saved. With an account, your art follows you to any device.</p>
      </form>
    </section>
  </div>`;

  floatBlooks($('.floaters', root));
  const err = $('.size-err', root);
  const pass = $('#lpass', root);
  const setMode = (next) => {
    mode = next;
    $$('.login-tabs button', root).forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('#lgo', root).textContent = mode === 'login' ? 'Log in' : 'Create my account';
    $('.login-note', root).textContent = mode === 'login' ? '' : 'Use 3 to 20 letters or numbers, and a password of 6 or more characters. There is no password reset yet, so remember it.';
    pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    err.hidden = true;
  };
  setMode(mode);
  $$('.login-tabs button', root).forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $('#lguest', root).onclick = () => { playAsGuest(); location.hash = '#/'; onDone(); };
  $('form', root).onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    $('#lgo', root).disabled = true;
    try {
      await (mode === 'login' ? logIn : signUp)($('#lname', root).value.trim(), pass.value);
      location.hash = '#/';
      onDone();
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
      $('#lgo', root).disabled = false;
    }
  };
  $('#lname', root).focus();
}
