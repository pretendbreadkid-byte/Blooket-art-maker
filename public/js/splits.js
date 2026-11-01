// Drag handles that resize the panels. Your sizes are remembered in this browser.
import { $$ } from './ui.js';

const KEY = 'blook-panel-sizes';

const SPLITS = {
  right: { css: '--right-w', min: 200, max: () => innerWidth * 0.5, read: (e, box) => box.right - e.clientX },
  side: { css: '--side-w', min: 170, max: () => innerWidth * 0.5, read: (e, box) => e.clientX - box.left },
  time: { css: '--time-h', min: 70, max: () => innerHeight * 0.65, read: (e, box) => box.bottom - e.clientY },
};

function loadSizes() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function saveSizes(sizes) {
  try { localStorage.setItem(KEY, JSON.stringify(sizes)); } catch { /* They just reset next time. */ }
}

function apply(ed, sizes) {
  for (const [name, split] of Object.entries(SPLITS)) {
    if (sizes[name]) ed.style.setProperty(split.css, `${sizes[name]}px`);
    else ed.style.removeProperty(split.css);
  }
}

// The timeline's height is its body, so the bars above it are taken away.
const sizeTarget = (name, handle, ed) => ({
  right: () => ed.getBoundingClientRect(),
  side: () => ($$('.ed-catalog:not([hidden])', ed)[0] || ed).getBoundingClientRect(),
  time: () => ed.getBoundingClientRect(),
}[name]());

function timelineExtra(ed) {
  const box = ed.querySelector('#timeline').getBoundingClientRect();
  const body = ed.querySelector('.time-body, .page-strip')?.getBoundingClientRect();
  return body ? box.height - body.height : 0;
}

export function mountSplits(root) {
  const ed = root.querySelector('.ed');
  const sizes = loadSizes();
  apply(ed, sizes);
  for (const handle of $$('.split', ed)) {
    const name = handle.dataset.split;
    const split = SPLITS[name];
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      const extra = name === 'time' ? timelineExtra(ed) : 0;
      const move = (ev) => {
        const wanted = split.read(ev, sizeTarget(name, handle, ed)) - extra;
        sizes[name] = Math.round(Math.max(split.min, Math.min(split.max(), wanted)));
        apply(ed, sizes);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.classList.remove('dragging');
        saveSizes(sizes);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('dblclick', () => {
      delete sizes[name];
      apply(ed, sizes);
      saveSizes(sizes);
    });
  }
}
