// Blookberry AI (beta): describe a Blook and get a few versions to pick from. It
// is free and runs on this device. A real Blook named in the description is the
// starting point, recoloured and dressed up as asked; anything else is built from
// Blook parts in the same style.
import { readPrompt, drawBlook, seeded, recolorSvg, addTopper, matchBlooks, COLORS } from './blook-gen.js';
import { fetchBlooks } from './pieces.js';
import { addPictureApart } from './blooks.js';
import { addImageFromUrl } from './tools.js';
import { esc } from './render.js';
import { $, $$, dialog, icon } from './ui.js';

const IDEAS = ['A pumpkin wearing a witch hat', 'A grumpy purple dragon', 'A sleepy blue robot', 'A pink chick with a crown', 'A spotted cow', 'A cupcake angel'];
const VERSIONS = 3;

function svgHref(svg) {
  const bytes = new TextEncoder().encode(svg);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(text)}`;
}

// Where a real Blook's art sits, measured by drawing it out of sight.
function artBox(svg) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:300px;height:345px;visibility:hidden';
  holder.innerHTML = svg;
  document.body.append(holder);
  try {
    const b = holder.querySelector('svg').getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return { x: 0, y: 0, width: 300, height: 345 };
  } finally {
    holder.remove();
  }
}

const title = (text) => text.replace(/^(a|an|the)\s+/i, '').replace(/\b\w/g, (m) => m.toUpperCase()).slice(0, 40) || 'My Blook';

let blookFiles = null;
async function realBlook(file) {
  const res = await fetch(`/blooks/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error('missing');
  return res.text();
}

// A few versions of the description. round: which "Try again" this is.
async function makeVersions(prompt, round) {
  const traits = readPrompt(prompt);
  blookFiles ??= (await fetchBlooks().catch(() => [])).map((b) => b.file);
  const names = blookFiles.map((f) => f.replace(/\.svg$/, ''));
  const matches = matchBlooks(prompt, names);
  const dressed = traits.hat || (traits.top === 'halo');
  const versions = [];
  // Real Blooks first: the first try uses the best match, later tries the next ones.
  for (const name of matches.slice(round % Math.max(1, matches.length), (round % Math.max(1, matches.length)) + 2)) {
    try {
      let svg = await realBlook(`${name}.svg`);
      if (traits.colorWord) svg = recolorSvg(svg, COLORS[traits.colorWord]);
      if (dressed) svg = addTopper(svg, traits, artBox(svg), seeded(round * 7 + versions.length));
      versions.push({ svg, from: name });
    } catch { /* That one could not be read; the others still come. */ }
  }
  let seed = (round + 1) * 1000 + [...prompt].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  while (versions.length < VERSIONS) versions.push({ svg: drawBlook(traits, seeded(seed++)), from: null });
  return versions;
}

export function blookberryDialog() {
  let prompt = '';
  let versions = [];
  let chosen = 0;
  let round = 0;
  return dialog((box, close) => {
    box.classList.add('ai-dlg');
    const head = `<div class="ai-head"><span class="ai-mark"><img src="/logo.svg" alt=""></span><h2>Blookberry AI</h2><span class="beta">BETA</span></div>`;

    const drawAsk = (note = '') => {
      box.innerHTML = `${head}
        <p class="muted">Describe a Blook and Blookberry AI makes a few to choose from, using the real Blooks as its guide. It's free.</p>
        <label class="field"><span>Your Blook</span><textarea id="aiprompt" maxlength="200" rows="2" placeholder="A pumpkin wearing a witch hat">${esc(prompt)}</textarea></label>
        <div class="ai-ideas">${IDEAS.map((i) => `<button type="button" class="chip" data-idea="${esc(i)}">${esc(i)}</button>`).join('')}</div>
        <p class="muted small">Try colours (blue, pink, gold), things (dragon, robot, pumpkin, cat, ghost), moods (sleepy, grumpy, cute, cool), and extras (crown, witch hat, party hat, halo, spotted, striped). Naming a real Blook, like "blue chick", starts from that one.</p>
        ${note ? `<p class="size-err" role="alert">${esc(note)}</p>` : ''}
        <div class="dlg-actions"><button class="btn ghost" data-no>Cancel</button><button class="btn primary" id="aigo">${icon('star')}<span>Make my Blook</span></button></div>`;
      const field = $('#aiprompt', box);
      field.focus();
      $('[data-no]', box).onclick = () => close();
      $$('[data-idea]', box).forEach((b) => { b.onclick = () => { field.value = b.dataset.idea; go(); }; });
      field.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } };
      $('#aigo', box).onclick = go;
    };

    const drawResult = () => {
      const pickedFrom = versions[chosen].from;
      box.innerHTML = `${head}
        <p class="ai-prompt">"${esc(prompt)}"</p>
        <div class="ai-picks">${versions.map((v, i) => `<button class="ai-pick ${i === chosen ? 'on' : ''}" data-v="${i}" aria-label="Version ${i + 1}"><img src="${esc(svgHref(v.svg))}" alt=""></button>`).join('')}</div>
        <p class="muted small">${pickedFrom ? `Made from the real ${esc(pickedFrom)} Blook.` : 'Built from Blook parts.'} Pick the one you like.</p>
        <div class="dlg-actions">
          <button class="btn ghost" id="aiedit">${icon('back')}<span>Change words</span></button>
          <button class="btn ghost" id="aiagain">${icon('loop')}<span>More like this</span></button>
          <button class="btn ghost" id="aipic">${icon('image')}<span>Add as a picture</span></button>
          <button class="btn primary" id="aiadd">${icon('apart')}<span>Add to canvas</span></button>
        </div>`;
      $$('.ai-pick', box).forEach((b) => { b.onclick = () => { chosen = +b.dataset.v; drawResult(); }; });
      $('#aiedit', box).onclick = () => drawAsk();
      $('#aiagain', box).onclick = async () => { round += 1; versions = await makeVersions(prompt, round); chosen = 0; drawResult(); };
      const href = () => svgHref(versions[chosen].svg);
      $('#aipic', box).onclick = async () => { close(); await addImageFromUrl(href()); };
      $('#aiadd', box).onclick = async () => {
        close();
        try { await addPictureApart(href(), title(prompt), undefined, undefined, { together: true }); } catch { await addImageFromUrl(href()); }
      };
    };

    async function go() {
      prompt = $('#aiprompt', box).value.trim();
      if (!prompt) { drawAsk('Describe the Blook you want first.'); return; }
      round = 0;
      chosen = 0;
      versions = await makeVersions(prompt, round);
      if (box.isConnected) drawResult();
    }

    drawAsk();
  }, { wide: true });
}
