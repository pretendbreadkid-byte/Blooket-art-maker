// More fonts: download free ones from Google Fonts, or import your own font file.
// A project keeps a copy of every font it adds (in doc.fonts), so its text looks
// the same on any device and in every export, even offline.
import { embedFont, esc } from './render.js';
import { $, $$, dialog, icon, toast, readDataUrl } from './ui.js';

// Free fonts that suit Blooket-style art, shown first.
export const GOOGLE_FONTS = [
  'Lilita One', 'Luckiest Guy', 'Bangers', 'Fredoka', 'Baloo 2', 'Chewy', 'Bubblegum Sans', 'Sniglet', 'Modak', 'Rubik Mono One',
  'Bungee', 'Righteous', 'Lobster', 'Pacifico', 'Permanent Marker', 'Caveat', 'Indie Flower', 'Patrick Hand', 'Shadows Into Light', 'Amatic SC',
  'Creepster', 'Nosifer', 'Press Start 2P', 'Silkscreen', 'VT323', 'Orbitron', 'Audiowide', 'Black Ops One', 'Bungee Shade', 'Monoton',
  'Poppins', 'Montserrat', 'Nunito', 'Rubik', 'Oswald', 'Anton', 'Roboto', 'Open Sans', 'Playfair Display', 'Cinzel',
];

const FORMATS = { woff2: ['font/woff2', 'woff2'], woff: ['font/woff', 'woff'], ttf: ['font/ttf', 'truetype'], otf: ['font/otf', 'opentype'] };
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const cleanFamily = (name) => String(name).replace(/[^\w ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

const registered = new Set();

// Makes a font usable on the page and built into exports.
export async function registerFont({ family, data, format }) {
  if (registered.has(family) || !FORMATS[format]) return;
  const [mime] = FORMATS[format];
  const face = new FontFace(family, `url(data:${mime};base64,${data})`);
  document.fonts.add(await face.load());
  embedFont(family, data, format);
  registered.add(family);
}

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

// Downloads a Google font's regular style (its Latin letters) as a woff2 file.
export async function downloadGoogleFont(name) {
  const family = cleanFamily(name);
  if (!family) throw new Error('Type the name of a Google font.');
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`).then((r) => {
    if (!r.ok) throw new Error(`Google Fonts has no font called "${family}".`);
    return r.text();
  });
  // Pick the block for Latin letters if there are several.
  const blocks = css.split('@font-face').slice(1);
  const latin = blocks.find((b) => /\/\* latin \*\//.test(`/* latin */${b}`) && /U\+0000-00FF/.test(b)) || blocks[blocks.length - 1];
  const url = latin?.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
  if (!url) throw new Error(`"${family}" could not be downloaded.`);
  const file = await fetch(url).then((r) => r.arrayBuffer());
  return { family, data: toBase64(file), format: 'woff2', source: 'google' };
}

// Reads a font file someone chose: .ttf, .otf, .woff or .woff2.
export async function importFontFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!FORMATS[ext]) throw new Error('Fonts need to be .ttf, .otf, .woff or .woff2 files.');
  if (file.size > MAX_FONT_BYTES) throw new Error('That font file is too big. Fonts up to 2 MB work.');
  const family = cleanFamily(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')) || 'My Font';
  const data = (await readDataUrl(file)).split(',')[1];
  return { family, data, format: ext, source: 'file' };
}

// Every font a project added, ready to use when it opens.
export async function loadDocFonts(doc) {
  await Promise.all((doc.fonts || []).map((f) => registerFont(f).catch(() => { /* A broken font falls back to a normal one. */ })));
}

// Adds a font to the project (once) and makes it usable.
export async function addFontTo(doc, font) {
  await registerFont(font);
  doc.fonts = [...(doc.fonts || []).filter((f) => f.family !== font.family), font];
  return font.family;
}

// The More fonts window. Resolves to the family that was added, or nothing.
export function fontDialog(doc) {
  return dialog((box, close) => {
    box.classList.add('font-dlg');
    const previewCss = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.map((f) => `family=${f.replace(/ /g, '+')}`).join('&')}&display=swap&text=${encodeURIComponent([...new Set(GOOGLE_FONTS.join('').replace(/ /g, '') + 'Aa')].join(''))}`;
    box.innerHTML = `<h2>More fonts</h2>
      <link rel="stylesheet" href="${esc(previewCss)}">
      <label class="cat-search">${icon('search')}<input id="fsearch" placeholder="Search, or type any Google font name" autocomplete="off"></label>
      <div class="font-grid">${GOOGLE_FONTS.map((f) => `<button class="font-card" data-f="${esc(f)}" style="font-family:'${esc(f)}', sans-serif"><b>${esc(f)}</b></button>`).join('')}</div>
      <p class="font-any" hidden><button class="btn ghost small" id="fany">${icon('download')}<span></span></button></p>
      <p class="size-err" role="alert" hidden></p>
      <div class="dlg-actions">
        <label class="btn ghost" id="fupload">${icon('upload')}<span>Import a font file</span><input type="file" accept=".ttf,.otf,.woff,.woff2" hidden></label>
        <div class="grow"></div>
        <button class="btn ghost" data-no>Cancel</button>
      </div>`;
    const err = $('.size-err', box);
    const busy = (on) => box.classList.toggle('busy', on);
    const add = async (get) => {
      err.hidden = true;
      busy(true);
      try {
        const family = await addFontTo(doc, await get());
        toast(`${family} is ready to use.`, 'ok');
        close(family);
      } catch (error) {
        err.textContent = error.message || 'That font could not be added.';
        err.hidden = false;
      } finally {
        busy(false);
      }
    };
    $$('.font-card', box).forEach((b) => { b.onclick = () => add(() => downloadGoogleFont(b.dataset.f)); });
    const search = $('#fsearch', box), any = $('.font-any', box);
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      $$('.font-card', box).forEach((b) => { b.hidden = !!q && !b.dataset.f.toLowerCase().includes(q); });
      const exact = GOOGLE_FONTS.some((f) => f.toLowerCase() === q);
      any.hidden = !q || exact;
      $('#fany span', box).textContent = `Download "${cleanFamily(search.value)}" from Google Fonts`;
    };
    search.onkeydown = (e) => { if (e.key === 'Enter' && search.value.trim()) add(() => downloadGoogleFont(search.value)); };
    $('#fany', box).onclick = () => add(() => downloadGoogleFont(search.value));
    const file = $('#fupload input', box);
    file.onchange = () => { const [f] = file.files; file.value = ''; if (f) add(() => importFontFile(f)); };
    $('[data-no]', box).onclick = () => close();
    search.focus();
  }, { wide: true });
}
