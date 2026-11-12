// Background remover for pictures. The background is found by spreading in from
// the picture's edges (and from any spots you click) through pixels that change
// colour gradually, so plain, gradient and photo backgrounds all come away. The
// edge of what is left is softened so it isn't jagged.
import { S, commit, refresh, selected } from './state.js';
import { $, dialog, html, icon, toast } from './ui.js';

const PREVIEW_W = 560, PREVIEW_H = 380;
const MAX_SIDE = 2048;
export const DEFAULT_STRENGTH = 40;

const dist = (a, i, b, j) => Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]);

// 1 for background, 0 for the subject. strength: how different a colour can be
// and still count as background. seeds: extra [x, y] spots that are background.
export function findBackground(rgba, width, height, strength = DEFAULT_STRENGTH, seeds = []) {
  const total = width * height;
  const bg = new Uint8Array(total);
  // Each pixel remembers where its stretch of background started, so a slow
  // gradient is followed but a sudden change of colour stops the spread.
  const origin = new Int32Array(total).fill(-1);
  const step = strength * 0.9, far = strength * 3;
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  const start = (i) => {
    if (origin[i] !== -1) return;
    origin[i] = i;
    bg[i] = 1;
    queue[tail++] = i;
  };
  const opaque = (i) => rgba[i * 4 + 3] >= 128;
  // See-through pixels are background already.
  for (let i = 0; i < total; i++) if (!opaque(i)) { bg[i] = 1; origin[i] = i; queue[tail++] = i; }
  for (let x = 0; x < width; x++) { start(x); start((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { start(y * width); start(y * width + width - 1); }
  for (const [x, y] of seeds) {
    const sx = Math.max(0, Math.min(width - 1, Math.round(x))), sy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const i = sy * width + sx;
    if (origin[i] === -1) start(i); else if (!bg[i]) { bg[i] = 1; queue[tail++] = i; }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const from = origin[i] * 4;
    const try_ = (j) => {
      if (bg[j]) return;
      if (!opaque(j)) { bg[j] = 1; origin[j] = j; queue[tail++] = j; return; }
      if (dist(rgba, i * 4, rgba, j * 4) > step || dist(rgba, from, rgba, j * 4) > far) return;
      bg[j] = 1;
      origin[j] = origin[i];
      queue[tail++] = j;
    };
    if (x > 0) try_(i - 1);
    if (x < width - 1) try_(i + 1);
    if (i >= width) try_(i - width);
    if (i < total - width) try_(i + width);
  }
  return bg;
}

// Clears the background, with a one-pixel soft edge on what is left.
export function cutOut(rgba, width, height, bg) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < width * height; i++) {
    if (bg[i]) { out[i * 4 + 3] = 0; continue; }
    const x = i % width;
    let near = 0;
    if (x > 0 && bg[i - 1]) near++;
    if (x < width - 1 && bg[i + 1]) near++;
    if (i >= width && bg[i - width]) near++;
    if (i < width * (height - 1) && bg[i + width]) near++;
    if (near) out[i * 4 + 3] = Math.round(out[i * 4 + 3] * (1 - near * 0.18));
  }
  return out;
}

async function pixelsOf(href) {
  const img = new Image();
  img.src = href;
  await img.decode();
  const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512;
  const k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w0 * k)), height: Math.max(1, Math.round(h0 * k)) });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

export const canRemoveBackground = () => selected().some((o) => o.type === 'image' && o.href);

// Shows the picture without its background. Drag Strength, or click leftover
// background to take it away too. Remove background keeps the result.
export async function removeBackground() {
  const item = selected().find((o) => o.type === 'image' && o.href);
  if (!item) return;
  let full;
  try { full = await pixelsOf(item.href); } catch { toast('That picture could not be opened.', 'warn'); return; }
  const { canvas, ctx, data } = full;
  const w = canvas.width, h = canvas.height;
  // The preview works on a smaller copy so dragging the slider stays quick.
  const k = Math.min(1, PREVIEW_W / w, PREVIEW_H / h);
  const small = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) });
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(canvas, 0, 0, small.width, small.height);
  const smallData = sctx.getImageData(0, 0, small.width, small.height);
  let strength = DEFAULT_STRENGTH;
  const seeds = [];

  const kept = await dialog((box, close) => {
    box.classList.add('bg-remove');
    box.innerHTML = `<h2>Remove background</h2>
      <div class="bgr-stage"></div>
      <p class="muted small">Click any leftover background to remove it too.</p>
      <label class="slider"><span>Strength</span><input type="range" min="5" max="150" value="${strength}"><span class="val"><b>${strength}</b></span></label>
      <div class="dlg-actions">
        <button class="btn ghost" data-undo disabled>${icon('undo')}<span>Undo click</span></button>
        <div class="grow"></div>
        <button class="btn ghost" data-no>Cancel</button>
        <button class="btn primary" data-yes>${icon('check')}<span>Remove background</span></button>
      </div>`;
    const view = Object.assign(document.createElement('canvas'), { width: small.width, height: small.height });
    $('.bgr-stage', box).append(view);
    const vctx = view.getContext('2d');
    const draw = () => {
      const bg = findBackground(smallData.data, small.width, small.height, strength, seeds.map(([x, y]) => [x * k, y * k]));
      vctx.putImageData(new ImageData(cutOut(smallData.data, small.width, small.height, bg), small.width, small.height), 0, 0);
      $('[data-undo]', box).disabled = !seeds.length;
    };
    draw();
    const range = $('input[type=range]', box);
    range.oninput = () => { strength = +range.value; $('.val b', box).textContent = strength; draw(); };
    view.onclick = (e) => {
      const r = view.getBoundingClientRect();
      seeds.push([((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h]);
      draw();
    };
    $('[data-undo]', box).onclick = () => { seeds.pop(); draw(); };
    $('[data-no]', box).onclick = () => close();
    $('[data-yes]', box).onclick = () => close(true);
  }, { wide: true });
  if (!kept) return;

  // The real thing, at full size.
  const bg = findBackground(data.data, w, h, strength, seeds);
  ctx.putImageData(new ImageData(cutOut(data.data, w, h, bg), w, h), 0, 0);
  item.href = canvas.toDataURL('image/png');
  commit();
  refresh();
  toast('Background removed. Undo brings it back.', 'ok');
}
