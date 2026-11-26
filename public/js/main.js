// Picks the screen to show from the address bar.
import { renderHome } from './home.js';
import { renderAdmin } from './admin.js';
import { renderTemplates } from './community.js';
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
  // blookberry.com opens on the welcome page. Your art is at #/art.
  const project = hash.match(/^\/p\/([\w-]+)$/);
  if (project) await openEditor(root, project[1]);
  else if (hash === '/art') await renderHome(root, route);
  else if (hash === '/templates') await renderTemplates(root);
  else await renderWelcome(root, hasStarted() || (await listProjects()).length > 0);
}

// Exports carry the built-in fonts inside them, so they look right anywhere.
const BUILT_IN_FONTS = [['Titan One', '/fonts/TitanOne.woff2'], ['DSEG7 Classic', '/fonts/DSEG7Classic.woff2']];
async function loadFonts() {
  await Promise.all(BUILT_IN_FONTS.map(async ([family, url]) => {
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      embedFont(family, btoa(String.fromCharCode(...bytes)));
      await document.fonts.load(`64px "${family}"`);
    } catch { /* Text falls back to a plain font. */ }
  }));
}

addEventListener('hashchange', route);
await loadFonts();
await useLocal();
route();
