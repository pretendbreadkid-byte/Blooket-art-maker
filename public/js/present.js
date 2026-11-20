// Shows slides full screen, one at a time, like a presentation.
// Arrow keys, space or a click go on; Escape stops. Resolves to the last slide shown.
import { exportSVG } from './render.js';
import { icon } from './ui.js';

export function present(doc, start = 0) {
  return new Promise((resolve) => {
    const count = doc.pages.length;
    let at = Math.max(0, Math.min(start, count - 1));
    const urls = new Map();
    const urlOf = (n) => {
      if (!urls.has(n)) urls.set(n, URL.createObjectURL(new Blob([exportSVG(doc, { frame: n })], { type: 'image/svg+xml' })));
      return urls.get(n);
    };
    const view = document.createElement('div');
    view.className = 'present';
    view.setAttribute('role', 'dialog');
    view.setAttribute('aria-label', 'Presenting slides');
    view.innerHTML = `<img class="present-slide" alt="">
      <div class="present-bar">
        <button class="ib" data-a="prev" aria-label="Previous slide">${icon('prev')}</button>
        <span class="present-count"></span>
        <button class="ib" data-a="next" aria-label="Next slide">${icon('next')}</button>
        <button class="ib" data-a="close" aria-label="Stop presenting" title="Stop (Esc)">${icon('x')}</button>
      </div>`;
    const img = view.querySelector('img');
    const label = view.querySelector('.present-count');
    const show = () => {
      img.src = urlOf(at);
      label.textContent = `${at + 1} / ${count}`;
      if (at + 1 < count) new Image().src = urlOf(at + 1);
    };
    const go = (n) => { at = Math.max(0, Math.min(n, count - 1)); show(); };
    const close = () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFull);
      if (document.fullscreenElement === view) document.exitFullscreen().catch(() => {});
      view.remove();
      setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000);
      resolve(at);
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', '.'].includes(e.key)) go(at + 1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', ','].includes(e.key)) go(at - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(count - 1);
      else if (e.key === 'Escape') close();
    };
    // Leaving full screen (Esc in the browser) stops too.
    const onFull = () => { if (!document.fullscreenElement) close(); };
    view.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'prev') go(at - 1);
      else if (a === 'next') go(at + 1);
      else if (a === 'close') close();
      else if (!e.target.closest('.present-bar')) go(at + 1);
    });
    view.addEventListener('contextmenu', (e) => { e.preventDefault(); go(at - 1); });
    document.body.append(view);
    window.addEventListener('keydown', onKey, true);
    show();
    view.requestFullscreen?.().then(() => document.addEventListener('fullscreenchange', onFull)).catch(() => {});
  });
}
