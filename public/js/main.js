// Picks the screen to show from the address bar.
import { renderHome } from './home.js';
import { renderAdmin } from './admin.js';
import { renderLogin } from './login.js';
import { openEditor, closeEditor } from './editor.js';
import { session, restoreSession } from './session.js';
import { S } from './state.js';
import { embedFont } from './render.js';
import { $ } from './ui.js';

const root = $('#app');

async function route() {
  if (S.doc) await closeEditor();
  document.querySelector('.menu')?.remove();
  document.querySelector('.popover')?.remove();
  const hash = location.hash.replace(/^#/, '') || '/';
  if (hash === '/admin') { await renderAdmin(root); return; }
  if (!session.user && !session.guest) { renderLogin(root, route); return; }
  const project = hash.match(/^\/p\/([\w-]+)$/);
  if (project) await openEditor(root, project[1]);
  else await renderHome(root, route);
}

// Exports carry the Blooket font inside them, so it looks right anywhere.
async function loadFonts() {
  try {
    const bytes = new Uint8Array(await (await fetch('/fonts/TitanOne.woff2')).arrayBuffer());
    embedFont('Titan One', btoa(String.fromCharCode(...bytes)));
    await document.fonts.load('64px "Titan One"');
  } catch { /* Text falls back to a plain font. */ }
}

addEventListener('hashchange', route);
await loadFonts();
await restoreSession();
route();
