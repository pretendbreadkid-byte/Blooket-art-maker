// Blookberry AI (beta): describe a Blook and it is drawn for you, in the style of
// the real Blooks, then added to the canvas as pieces you can edit.
import { call, session } from './session.js';
import { addPictureApart } from './blooks.js';
import { addImageFromUrl } from './tools.js';
import { esc } from './render.js';
import { $, $$, dialog, icon, toast } from './ui.js';

const IDEAS = ['A pumpkin wearing a witch hat', 'A sleepy baby dragon', 'A toaster robot', 'A frog astronaut', 'A cupcake with sprinkles', 'A grumpy storm cloud'];

function svgHref(svg) {
  const bytes = new TextEncoder().encode(svg);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(text)}`;
}

export function blookberryDialog() {
  let prompt = '';
  let result = null;
  let busy = false;
  return dialog((box, close) => {
    box.classList.add('ai-dlg');
    const head = `<div class="ai-head"><span class="ai-mark"><img src="/logo.svg" alt=""></span><h2>Blookberry AI</h2><span class="beta">BETA</span></div>`;

    const drawAsk = (note = '') => {
      box.innerHTML = `${head}
        <p class="muted">Describe a Blook and Blookberry AI draws it in Blooket's style, using hundreds of real Blooks as its guide.</p>
        <label class="field"><span>Your Blook</span><textarea id="aiprompt" maxlength="300" rows="3" placeholder="A pumpkin wearing a witch hat">${esc(prompt)}</textarea></label>
        <div class="ai-ideas">${IDEAS.map((i) => `<button type="button" class="chip" data-idea="${esc(i)}">${esc(i)}</button>`).join('')}</div>
        ${note ? `<p class="size-err" role="alert">${esc(note)}</p>` : ''}
        <div class="dlg-actions"><button class="btn ghost" data-no>Cancel</button><button class="btn primary" id="aigo">${icon('star')}<span>Draw my Blook</span></button></div>`;
      const field = $('#aiprompt', box);
      field.focus();
      $('[data-no]', box).onclick = () => close();
      $$('[data-idea]', box).forEach((b) => { b.onclick = () => { field.value = b.dataset.idea; field.focus(); }; });
      field.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } };
      $('#aigo', box).onclick = go;
    };

    const drawBusy = () => {
      const started = Date.now();
      box.innerHTML = `${head}
        <div class="ai-busy"><span class="ai-spin"><img src="/logo.svg" alt=""></span>
          <b>Drawing "${esc(prompt)}"...</b><span class="muted">This can take a minute or two. <i id="aitime">0s</i></span></div>`;
      const timer = setInterval(() => {
        const t = $('#aitime', box);
        if (!t) { clearInterval(timer); return; }
        t.textContent = `${Math.round((Date.now() - started) / 1000)}s`;
      }, 1000);
    };

    const drawResult = () => {
      box.innerHTML = `${head}
        <div class="ai-result"><img src="${esc(svgHref(result.svg))}" alt="${esc(prompt)}"></div>
        <p class="muted small">${result.left} left today.${result.references?.length ? ` Inspired by ${result.references.map(esc).join(', ')}.` : ''}</p>
        <div class="dlg-actions">
          <button class="btn ghost" id="aiagain">${icon('loop')}<span>Try again</span></button>
          <button class="btn ghost" id="aipic">${icon('image')}<span>Add as a picture</span></button>
          <button class="btn primary" id="aiadd">${icon('apart')}<span>Add to canvas</span></button>
        </div>`;
      $('#aiagain', box).onclick = () => drawAsk();
      $('#aipic', box).onclick = async () => { close(); await addImageFromUrl(svgHref(result.svg)); };
      $('#aiadd', box).onclick = async () => {
        close();
        try { await addPictureApart(svgHref(result.svg), prompt.slice(0, 40), undefined, undefined, { together: true }); } catch { await addImageFromUrl(svgHref(result.svg)); }
      };
    };

    async function go() {
      if (busy) return;
      prompt = $('#aiprompt', box).value.trim();
      if (!prompt) { drawAsk('Describe the Blook you want first.'); return; }
      busy = true;
      drawBusy();
      try {
        result = await call('POST', '/api/ai/blook', { prompt });
        if (box.isConnected) drawResult();
      } catch (error) {
        if (box.isConnected) drawAsk(error.message);
        else toast(error.message, 'warn');
      } finally {
        busy = false;
      }
    }

    if (session.guest || !session.user) {
      box.innerHTML = `${head}<p>Make an account to use Blookberry AI. It is free while it is in beta.</p>
        <div class="dlg-actions"><button class="btn primary" data-no>OK</button></div>`;
      $('[data-no]', box).onclick = () => close();
      return;
    }
    drawAsk();
    call('GET', '/api/ai/status').then(({ ready }) => {
      if (!ready && box.isConnected && !busy) drawAsk('Blookberry AI is not switched on yet. The site owner needs to add an ANTHROPIC_API_KEY.');
    }).catch(() => {});
  }, { wide: true });
}
