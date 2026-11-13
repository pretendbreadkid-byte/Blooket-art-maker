// Picks the screen to show from the address bar.
import { renderHome } from './home.js';
import { renderAdmin } from './admin.js';
import { renderWelcome } from './welcome.js';
import { openEditor, closeEditor } from './editor.js';
import { hasStarted } from './session.js';
import { useLocal, listProjects } from './store.js';
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
  // First visit: the welcome page. After that, straight to your art.
  if (hash === '/welcome' || (hash === '/' && !hasStarted() && !(await listProjects()).length)) { await renderWelcome(root); return; }
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
await useLocal();
route();
