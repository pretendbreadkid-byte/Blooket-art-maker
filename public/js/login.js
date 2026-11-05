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

export function renderLogin(root, onDone) {
  document.title = 'Welcome · Blook Berry';
  let mode = 'login';

  root.innerHTML = `<div class="welcome">
    <div class="floaters" aria-hidden="true"></div>
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
  setMode('login');
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
