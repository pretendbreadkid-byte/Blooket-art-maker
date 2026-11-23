// Extra looks for Blook Berry. Classic is for everyone; the others unlock with a code.
// What you unlocked and which look you picked are kept in this browser.
import { $, $$, icon, dialog, toast } from './ui.js';

export const THEMES = {
  classic: { name: 'Classic', note: 'The Blook Berry look', side: '#b8344f', main: 'linear-gradient(150deg, #20c9d6, #2f9cec)', button: '#0bc2cf' },
  fall: { name: 'Fall', note: 'Leaves, pumpkins and warm colours', side: '#a5431c', main: 'linear-gradient(150deg, #f6b24a, #d8622a)', button: '#e9781e', locked: true },
};
const UNLOCK_KEY = 'bb-unlocked';
const SKIN_KEY = 'bb-skin';

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not saved */ }
}

export const unlocked = () => ['classic', ...read(UNLOCK_KEY, []).filter((t) => THEMES[t])];
export const hasExtras = () => unlocked().length > 1;
export function currentTheme() {
  const t = read(SKIN_KEY, 'classic');
  return unlocked().includes(t) ? t : 'classic';
}

export function setTheme(t) {
  write(SKIN_KEY, t);
  applyTheme();
}

export function applyTheme() {
  const t = currentTheme();
  if (t === 'classic') delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = t;
}

async function redeem(code) {
  const res = await fetch('/api/codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again in a moment.');
  const have = read(UNLOCK_KEY, []);
  if (!have.includes(data.theme)) write(UNLOCK_KEY, [...have, data.theme]);
  return data.theme;
}

// Type in a code, and pick from the looks you have.
export function openCodes(onChange = () => {}) {
  return dialog((box, close) => {
    const draw = () => {
      const have = unlocked();
      const now = currentTheme();
      box.innerHTML = `<h2>Codes</h2>
        <p class="muted">Got a code? Type it in to unlock something special.</p>
        <form class="code-row" id="codeform"><input id="code" placeholder="FALL-XXXX-XXXX-XXXX" maxlength="24" autocomplete="off" spellcheck="false" aria-label="Code" autofocus>
          <button class="btn primary" type="submit">${icon('gift')}<span>Unlock</span></button></form>
        <b>Themes</b>
        <div class="theme-pick">${Object.entries(THEMES).map(([id, t]) => `<button class="theme-card ${id === now ? 'on' : ''}" data-theme-id="${id}" ${have.includes(id) ? '' : 'disabled'}>
          <span class="theme-swatch"><i style="background:${t.side}"></i><i style="background:${t.main}"><b style="background:${t.button}"></b></i></span>
          <span>${have.includes(id) ? '' : icon('lock')} ${t.name}</span><small>${have.includes(id) ? t.note : 'Unlock it with a code'}</small></button>`).join('')}</div>
        <div class="dlg-actions"><button class="btn ghost" data-done>Done</button></div>`;
      $('[data-done]', box).onclick = () => close();
      $$('.theme-card', box).forEach((b) => {
        b.onclick = () => { setTheme(b.dataset.themeId); onChange(); draw(); };
      });
      const form = $('#codeform', box);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const input = $('#code', box);
        const button = $('button', form);
        if (!input.value.trim()) return;
        button.disabled = true;
        try {
          const theme = await redeem(input.value);
          setTheme(theme);
          onChange();
          toast(`You unlocked the ${THEMES[theme].name} theme! Switch looks here any time.`, 'ok');
          draw();
        } catch (error) {
          button.disabled = false;
          toast(error.message, 'warn');
          input.select();
        }
      };
      $('#code', box).focus();
    };
    draw();
  });
}
