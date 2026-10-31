// Picks the screen to show from the address bar.
import { renderHome } from './home.js';
import { renderAdmin } from './admin.js';
import { openEditor, closeEditor } from './editor.js';
import { S } from './state.js';
import { $ } from './ui.js';

const root = $('#app');

async function route() {
  if (S.doc) await closeEditor();
  document.querySelector('.menu')?.remove();
  document.querySelector('.popover')?.remove();
  const hash = location.hash.replace(/^#/, '') || '/';
  const project = hash.match(/^\/p\/([\w-]+)$/);
  if (project) await openEditor(root, project[1]);
  else if (hash === '/admin') await renderAdmin(root);
  else await renderHome(root);
}

addEventListener('hashchange', route);
route();
