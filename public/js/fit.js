// Notices art outside the canvas and offers to grow the canvas around it.
import { S, commit, posed } from './state.js';
import { localBox, fitView } from './stage.js';
import { localToWorld } from './model.js';
import { exportSVG, rasterize } from './render.js';
import { $, toast } from './ui.js';

const MIN_SIZE = 16;
const MAX_SIZE = 8192;
const IGNORE_PX = 2;
const NEW_OVERFLOW_PX = 8;
const BASIC_MARGIN = 20;
const MAX_SCAN_PX = 4096;

let dismissed = null;

export const resetFitPrompt = () => { dismissed = null; };

// Everything visible, in document units, including outlines. Things with
// keyframes are left out when asked: flying in from off-screen is normal.
function artBounds({ skipAnimated }) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const layer of S.doc.layers) {
    for (const raw of layer.objects) {
      if (skipAnimated && raw.keys.length) continue;
      const b = localBox(raw.id);
      if (!b) continue;
      const o = posed(raw);
      const pad = o.stroke !== 'none' ? (o.strokeWidth || 0) / 2 : 0;
      const corners = [
        [b.x - pad, b.y - pad], [b.x + b.width + pad, b.y - pad],
        [b.x + b.width + pad, b.y + b.height + pad], [b.x - pad, b.y + b.height + pad],
      ];
      for (const [x, y] of corners) {
        const p = localToWorld(o, x, y);
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

function overflowOf(b) {
  return {
    left: Math.max(0, -b.x0), top: Math.max(0, -b.y0),
    right: Math.max(0, b.x1 - S.doc.width), bottom: Math.max(0, b.y1 - S.doc.height),
  };
}

function moveEverything(dx, dy) {
  for (const layer of S.doc.layers) {
    for (const o of layer.objects) {
      o.x += dx; o.y += dy;
      for (const k of o.keys) { k.pose.x += dx; k.pose.y += dy; }
    }
  }
}

function resizeCanvas(x, y, width, height) {
  const doc = S.doc;
  if (width > MAX_SIZE || height > MAX_SIZE) {
    toast(`A canvas can be up to ${MAX_SIZE} px wide. Your art is bigger than that.`, 'warn');
    return;
  }
  moveEverything(-x, -y);
  doc.width = Math.max(MIN_SIZE, width);
  doc.height = Math.max(MIN_SIZE, height);
  doc.cornerRadius = Math.min(doc.cornerRadius || 0, Math.min(doc.width, doc.height) / 2);
  fitView();
  commit();
}

function basicFit() {
  const b = artBounds({ skipAnimated: false });
  const x = Math.floor(Math.min(0, b.x0 - BASIC_MARGIN)), y = Math.floor(Math.min(0, b.y0 - BASIC_MARGIN));
  const right = Math.ceil(Math.max(S.doc.width, b.x1 + BASIC_MARGIN)), bottom = Math.ceil(Math.max(S.doc.height, b.y1 + BASIC_MARGIN));
  resizeCanvas(x, y, right - x, bottom - y);
}

// Draws just the art and reads where the real pixels are, so outlines and
// erased areas are measured exactly.
async function perfectFit() {
  const b = artBounds({ skipAnimated: false });
  const pad = 4;
  const box = { x: b.x0 - pad, y: b.y0 - pad, width: b.x1 - b.x0 + pad * 2, height: b.y1 - b.y0 + pad * 2 };
  const scale = Math.min(2, MAX_SCAN_PX / Math.max(box.width, box.height));
  const w = Math.ceil(box.width * scale), h = Math.ceil(box.height * scale);
  const canvas = await rasterize(exportSVG(S.doc, { frame: S.frame, box }), w, h);
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 8) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) { toast('There is nothing to fit to.', 'warn'); return; }
  const left = Math.floor(box.x + x0 / scale), top = Math.floor(box.y + y0 / scale);
  const right = Math.ceil(box.x + (x1 + 1) / scale), bottom = Math.ceil(box.y + (y1 + 1) / scale);
  resizeCanvas(left, top, right - left, bottom - top);
}

function hide() { $('#fitask').hidden = true; }

function askHowToFit() {
  const box = $('#fitask');
  box.innerHTML = `<b>Perfect fit or basic fit?</b>
    <p>Perfect wraps tightly around all your lines. Basic just makes the canvas big enough.</p>
    <div class="fit-actions">
      <button class="btn ghost small" data-fit="cancel">Cancel</button>
      <button class="btn ghost small" data-fit="basic">Basic fit</button>
      <button class="btn primary small" data-fit="perfect">Perfect fit</button>
    </div>`;
  box.onclick = (e) => {
    const choice = e.target.closest('[data-fit]')?.dataset.fit;
    if (!choice) return;
    hide();
    if (choice === 'basic') basicFit();
    if (choice === 'perfect') perfectFit().catch(() => toast('That did not work. Try again.', 'warn'));
    if (choice === 'cancel') dismissed = overflowOf(artBounds({ skipAnimated: S.doc.animated }));
  };
}

function askToExpand(over) {
  const box = $('#fitask');
  box.hidden = false;
  box.innerHTML = `<b>Expand canvas to fit?</b>
    <p>Some of your art is outside the canvas.</p>
    <div class="fit-actions">
      <button class="btn ghost small" data-a="no">No</button>
      <button class="btn primary small" data-a="yes">Yes</button>
    </div>`;
  box.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'no') { dismissed = over; hide(); }
    if (a === 'yes') askHowToFit();
  };
}

export function checkOverflow() {
  const box = $('#fitask');
  if (!box || !S.doc) return;
  const b = artBounds({ skipAnimated: S.doc.animated });
  const over = b && overflowOf(b);
  if (!over || !Object.values(over).some((v) => v > IGNORE_PX)) { hide(); dismissed = null; return; }
  if (!box.hidden) return;
  const isNew = !dismissed || Object.keys(over).some((k) => over[k] > dismissed[k] + NEW_OVERFLOW_PX);
  if (isNew) askToExpand(over);
}
