// The Export dialog and the file formats behind it.
import { S } from './state.js';
import { exportSVG, rasterize, esc } from './render.js';
import { $, $$, dialog, icon, toast } from './ui.js';

const FORMATS = [
  { id: 'svg', label: 'SVG', note: 'Sharp at any size' },
  { id: 'webp', label: 'WEBP', note: 'Small picture file' },
  { id: 'png', label: 'PNG', note: 'See-through background' },
  { id: 'jpg', label: 'JPG', note: 'White background' },
  { id: 'pdf', label: 'PDF', note: 'Ready to print' },
];

const JPEG_QUALITY = 0.92;
const WEBP_QUALITY = 0.92;

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make that file.'))), type, quality);
});

// Wraps one JPEG in the smallest valid PDF, one page the size of the canvas.
export function jpegToPdf(jpeg, widthPx, heightPx) {
  const encoder = new TextEncoder();
  const w = +(widthPx * 0.75).toFixed(2), h = +(heightPx * 0.75).toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Art Do Q`;
  const parts = [encoder.encode('%PDF-1.4\n')];
  let offset = parts[0].length;
  const offsets = [];
  const add = (...chunks) => {
    offsets.push(offset);
    for (const c of chunks) {
      const bytes = typeof c === 'string' ? encoder.encode(c) : c;
      parts.push(bytes);
      offset += bytes.length;
    }
  };
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  add(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << /XObject << /Art 5 0 R >> >> >>\nendobj\n`);
  add(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  add(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream\nendobj\n');
  const rows = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  const xrefAt = offset;
  add(`xref\n0 6\n0000000000 65535 f \n${rows}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return parts;
}

// JPG and PDF have no transparency, so they sit on white.
function onWhite(canvas) {
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat;
}

async function makeFile(doc, format, { animate, frame }) {
  if (format === 'svg') return new Blob([exportSVG(doc, { frame, animate })], { type: 'image/svg+xml' });
  const canvas = await rasterize(exportSVG(doc, { frame }), doc.width, doc.height);
  if (format === 'png') return toBlob(canvas, 'image/png');
  if (format === 'webp') {
    const blob = await toBlob(canvas, 'image/webp', WEBP_QUALITY);
    if (blob.type !== 'image/webp') throw new Error('This browser cannot make WEBP files. Try Chrome or Edge.');
    return blob;
  }
  const jpeg = await toBlob(onWhite(canvas), 'image/jpeg', JPEG_QUALITY);
  if (format === 'jpg') return jpeg;
  const parts = jpegToPdf(new Uint8Array(await jpeg.arrayBuffer()), doc.width, doc.height);
  return new Blob(parts, { type: 'application/pdf' });
}

export function exportDialog() {
  const doc = S.doc;
  const safe = doc.name.replace(/[^\w -]+/g, '').trim() || 'art';
  let format = 'svg';
  dialog((box, close) => {
    const paint = () => {
      const animated = doc.animated && format === 'svg';
      box.innerHTML = `<h2>Export</h2>
        <p class="muted">${doc.width} × ${doc.height} px.</p>
        <label class="field"><span>File name</span><input id="xname" value="${esc($('#xname', box)?.value ?? safe)}"></label>
        <div class="format-grid">${FORMATS.map((f) => `<button class="format ${f.id === format ? 'on' : ''}" data-f="${f.id}">
          <b>${f.label}</b><small>${f.note}</small>
        </button>`).join('')}</div>
        ${animated ? `<div class="choice-row">
          <label class="radio"><input type="radio" name="kind" value="anim" checked><span><b>Animated</b><small>Plays and loops in any web browser</small></span></label>
          <label class="radio"><input type="radio" name="kind" value="frame"><span><b>Just this frame</b><small>A still picture of frame ${S.frame + 1}</small></span></label>
        </div>` : ''}
        ${doc.animated && format !== 'svg' ? `<p class="muted">This saves frame ${S.frame + 1} as a still picture.</p>` : ''}
        <div class="dlg-actions">
          <button class="btn ghost" data-no>Cancel</button>
          <button class="btn primary" data-yes>${icon('download')}<span>Download</span></button>
        </div>`;
      $('[data-no]', box).onclick = () => close();
      $$('[data-f]', box).forEach((b) => {
        b.onclick = () => {
          const chosen = FORMATS.find((f) => f.id === b.dataset.f);
          const name = $('#xname', box).value;
          const pick = () => {
            format = chosen.id;
            paint();
            $('#xname', box).value = name;
          };
          pick();
        };
      });
      $('[data-yes]', box).onclick = async () => {
        const animate = doc.animated && format === 'svg' && $('[name=kind]:checked', box).value === 'anim';
        const name = ($('#xname', box).value.trim() || safe).replace(/\.(svg|webp|png|jpe?g|pdf)$/i, '');
        try {
          download(`${name}.${format}`, await makeFile(doc, format, { animate, frame: S.frame }));
          close();
          toast('Your file is downloading.', 'ok');
        } catch (error) {
          toast(error.message, 'warn');
        }
      };
    };
    paint();
  });
}
