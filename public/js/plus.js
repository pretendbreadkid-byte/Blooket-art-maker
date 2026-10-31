// The Plus offer. It is free for now. Payment gets connected here later.
import { session, isPlus, joinPlus, logOut } from './session.js';
import { $, dialog, icon, toast } from './ui.js';
import { esc } from './render.js';

export function plusDialog(reason = '') {
  return dialog((box, close) => {
    const perks = ['Extra shapes in the catalog', 'Export as PNG, JPG and PDF', 'Everything in Basic'];
    box.innerHTML = `<span class="plus-badge big">PLUS</span>
      <h2>${esc(reason || 'Blook Maker Plus')}</h2>
      <ul class="perks">${perks.map((p) => `<li>${icon('check')}<span>${p}</span></li>`).join('')}</ul>
      <p class="plus-price"><b>Free for now</b></p>
      ${session.guest ? '<p class="muted">You need an account to get Plus.</p>' : ''}
      <div class="dlg-actions">
        <button class="btn ghost" data-no>Not now</button>
        <button class="btn primary" data-yes>${session.guest ? 'Make an account' : 'Get Plus for free'}</button>
      </div>`;
    $('[data-no]', box).onclick = () => close(false);
    $('[data-yes]', box).onclick = async () => {
      if (session.guest) {
        close(false);
        logOut();
        location.hash = '#/';
        location.reload();
        return;
      }
      try {
        await joinPlus();
        toast('You have Plus now!', 'ok');
        close(true);
      } catch (error) {
        toast(error.message, 'warn');
      }
    };
  });
}

// Runs the action if you have Plus, otherwise offers it first.
export async function needsPlus(reason, action) {
  if (isPlus() || await plusDialog(reason)) await action();
}
