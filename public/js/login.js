// The welcome screen: log in, make an account, or play as a guest.
import { logIn, signUp, playAsGuest } from './session.js';
import { BASIC_SHAPES, shapeThumb } from './shapes.js';
import { $, $$, icon } from './ui.js';

const FLOATERS = ['star', 'heart', 'circle', 'hexagon', 'moon', 'burst', 'triangle', 'plus'];

export function renderLogin(root, onDone) {
  document.title = 'Welcome · Blook Maker';
  let mode = 'login';
  const floaters = FLOATERS.map((id, i) => {
    const shape = BASIC_SHAPES.find((s) => s.id === id);
    return `<span class="floater f${i}">${shapeThumb(shape)}</span>`;
  }).join('');

  root.innerHTML = `<div class="welcome">
    <section class="welcome-art" aria-hidden="true">
      ${floaters}
      <div class="welcome-copy">
        <span class="brand-mark big">${icon('shapes')}</span>
        <h1>Blook Maker</h1>
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
        <p class="muted small login-guest">Guests can make art and export it, but nothing gets saved.</p>
      </form>
    </section>
  </div>`;

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
