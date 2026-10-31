'use strict';
const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- storage ---------- */
let db;
try { db = JSON.parse(localStorage.getItem('artmaker') || 'null'); } catch (e) { db = null; }
if (!db) db = { folders: [{ id: 'art', name: 'Art' }], projects: [], catalog: [] };
const save = () => { try { localStorage.setItem('artmaker', JSON.stringify(db)); } catch (e) { alert('Could not save: storage full?'); } };

/* ---------- geometry helpers ---------- */
function shapePts(kind, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2;
  const rel = a => a.map(([px, py]) => [x + px * w, y + py * h]);
  switch (kind) {
    case 'rect': return rel([[0, 0], [1, 0], [1, 1], [0, 1]]);
    case 'triangle': return rel([[.5, 0], [1, 1], [0, 1]]);
    case 'diamond': return rel([[.5, 0], [1, .5], [.5, 1], [0, .5]]);
    case 'line': return [[x, y], [x + w, y + h]];
    case 'arrow': return rel([[0, .3], [.55, .3], [.55, 0], [1, .5], [.55, 1], [.55, .7], [0, .7]]);
    case 'star': case 'pentagon': case 'hexagon': {
      const n = kind === 'hexagon' ? 6 : 5, pts = [];
      const count = kind === 'star' ? n * 2 : n;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / count;
        const r = kind === 'star' && i % 2 ? .4 : 1;
        pts.push([cx + Math.cos(a) * r * w / 2, cy + Math.sin(a) * r * h / 2]);
      }
      return pts;
    }
  }
  return [];
}
const BASIC = ['rect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow', 'line'];

function polyPath(pts, r, closed) {
  const f = n => +n.toFixed(2);
  if (!pts.length) return '';
  if (!r || pts.length < 3) return 'M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + (closed ? 'Z' : '');
  let d = '';
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    const da = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, dc = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const ra = Math.min(r, da / 2), rc = Math.min(r, dc / 2);
    const p1 = [b[0] + (a[0] - b[0]) / da * ra, b[1] + (a[1] - b[1]) / da * ra];
    const p2 = [b[0] + (c[0] - b[0]) / dc * rc, b[1] + (c[1] - b[1]) / dc * rc];
    d += (i ? 'L' : 'M') + f(p1[0]) + ' ' + f(p1[1]) + 'Q' + f(b[0]) + ' ' + f(b[1]) + ' ' + f(p2[0]) + ' ' + f(p2[1]);
  }
  return d + 'Z';
}

function sanitizeSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('Not a valid SVG file');
  root.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n => n.remove());
  [root, ...root.querySelectorAll('*')].forEach(el => [...el.attributes].forEach(a => {
    const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
    if (n.startsWith('on') || ((n === 'href' || n === 'xlink:href') && !v.startsWith('#')) || /^(javascript|data|vbscript):/.test(v)) el.removeAttribute(a.name);
  }));
  let vb = root.getAttribute('viewBox');
  if (!vb) vb = `0 0 ${parseFloat(root.getAttribute('width')) || 100} ${parseFloat(root.getAttribute('height')) || 100}`;
  const parts = vb.split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(isNaN) || parts[2] <= 0 || parts[3] <= 0) throw new Error('Bad viewBox');
  const ser = new XMLSerializer();
  return { vb: parts.join(' '), markup: [...root.childNodes].map(n => ser.serializeToString(n)).join('') };
}

/* ---------- rendering ---------- */
function itemSvg(it) {
  const st = `fill="${esc(it.fill)}" stroke="${esc(it.stroke)}" stroke-width="${+it.sw || 0}" stroke-linejoin="round" stroke-linecap="round"`;
  const id = `data-id="${it.id}"`;
  switch (it.type) {
    case 'poly': return `<path ${id} d="${polyPath(it.pts, it.radius, it.closed)}" ${st.replace(/fill="[^"]*"/, `fill="${it.closed ? esc(it.fill) : 'none'}"`)}/>`;
    case 'ellipse': return `<ellipse ${id} cx="${it.cx}" cy="${it.cy}" rx="${Math.abs(it.rx)}" ry="${Math.abs(it.ry)}" ${st}/>`;
    case 'path': return `<path ${id} d="${polyPath(it.pts, 0, false)}" fill="none" stroke="${esc(it.stroke)}" stroke-width="${+it.sw}" stroke-linejoin="round" stroke-linecap="round" opacity="${+it.opacity || 1}"/>`;
    case 'text': return `<text ${id} x="${it.x}" y="${it.y}" font-size="${+it.size}" font-family="sans-serif" fill="${esc(it.fill)}" stroke="${it.sw ? esc(it.stroke) : 'none'}" stroke-width="${+it.sw || 0}">${esc(it.text)}</text>`;
    case 'svg': return `<svg ${id} x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" viewBox="${esc(it.vb)}" preserveAspectRatio="none" overflow="hidden">${it.markup}</svg>`;
  }
  return '';
}
const layerSvg = (p, l, fid, forExport) => `<g data-layer="${l.id}">${(l.items[fid] || []).map(itemSvg).join('')}</g>`;
function frameSvg(p, fid) {
  return p.layers.filter(l => l.visible).map(l => layerSvg(p, l, fid)).join('');
}
function exportSvg(p) {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.w}" height="${p.h}" viewBox="0 0 ${p.w} ${p.h}">` +
    `<rect width="100%" height="100%" fill="${esc(p.bg)}"/>`;
  if (!p.animated || p.frames.length < 2) return head + frameSvg(p, p.frames[cur].id) + '</svg>';
  const n = p.frames.length, dur = n / p.fps;
  const keyTimes = p.frames.map((_, i) => +(i / n).toFixed(5)).join(';');
  const groups = p.frames.map((f, i) => {
    const vals = p.frames.map((_, j) => j === i ? 'visible' : 'hidden').join(';');
    return `<g visibility="${i ? 'hidden' : 'visible'}">${frameSvg(p, f.id)}<animate attributeName="visibility" calcMode="discrete" values="${vals}" keyTimes="${keyTimes}" dur="${dur}s" repeatCount="indefinite"/></g>`;
  }).join('');
  return head + groups + '</svg>';
}

/* ---------- state ---------- */
let proj = null, cur = 0, layerId = null, sel = null, tool = 'select', shape = { kind: 'rect' }, history = [], drag = null, timer = null;
const stage = $('#stage');
const activeLayer = () => proj.layers.find(l => l.id === layerId);
const curItems = (l = activeLayer()) => (l.items[proj.frames[cur].id] ||= []);
const findItem = id => { for (const l of proj.layers) { const it = curItems(l).find(i => i.id === id); if (it) return { it, l }; } return null; };
const checkpoint = () => { history.push(JSON.stringify({ layers: proj.layers, frames: proj.frames, cur, bg: proj.bg })); if (history.length > 60) history.shift(); };
const commit = () => { save(); render(); };

/* ---------- home screen ---------- */
function renderHome() {
  $('#folders').innerHTML = db.folders.map(f => {
    const ps = db.projects.filter(p => p.folder === f.id);
    return `<div class="folder"><h2>📁 ${esc(f.name)} ${f.id !== 'art' ? `<button data-delf="${f.id}">🗑</button>` : ''}</h2><div class="projs">` +
      (ps.map(p => `<div class="proj"><b>${esc(p.name)}</b><small>${p.w}×${p.h} · ${p.animated ? 'Animated' : 'Still'}</small>` +
        `<button data-open="${p.id}">Open</button> <button data-delp="${p.id}">🗑</button></div>`).join('') || '<small>No projects yet</small>') + '</div></div>';
  }).join('');
}
$('#folders').onclick = e => {
  const t = e.target;
  if (t.dataset.open) openProject(t.dataset.open);
  if (t.dataset.delp && confirm('Delete this project?')) { db.projects = db.projects.filter(p => p.id !== t.dataset.delp); save(); renderHome(); }
  if (t.dataset.delf && confirm('Delete this folder and all its projects?')) {
    db.folders = db.folders.filter(f => f.id !== t.dataset.delf); db.projects = db.projects.filter(p => p.folder !== t.dataset.delf); save(); renderHome();
  }
};
$('#newFolder').onclick = () => {
  const name = (prompt('Folder name?') || '').trim();
  if (name) { db.folders.push({ id: uid(), name }); save(); renderHome(); }
};
$('#newProject').onclick = () => {
  $('#dlgFolder').innerHTML = db.folders.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  $('#dlg').showModal();
};
$('#preset').onchange = e => { $('#customSize').hidden = e.target.value !== 'custom'; };
$('#newForm').onsubmit = e => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  const f = new FormData(e.target);
  let [w, h] = $('#preset').value === 'custom' ? [+f.get('w'), +f.get('h')] : $('#preset').value.split('x').map(Number);
  w = Math.min(8000, Math.max(16, w || 800)); h = Math.min(8000, Math.max(16, h || 600));
  const fid = uid(), lid = uid();
  db.projects.push({
    id: uid(), name: f.get('name').trim() || 'Untitled', folder: f.get('folder'), animated: f.get('animated') === 'yes',
    w, h, bg: '#ffffff', fps: 8, frames: [{ id: fid }], layers: [{ id: lid, name: 'Layer 1', visible: true, items: { [fid]: [] } }]
  });
  save(); renderHome();
};

/* ---------- editor ---------- */
function openProject(id) {
  proj = db.projects.find(p => p.id === id); cur = 0; sel = null; history = [];
  layerId = proj.layers[proj.layers.length - 1].id;
  $('#home').hidden = true; $('#editor').hidden = false;
  $('#pname').value = proj.name; $('#timeline').hidden = !proj.animated; $('#fps').value = proj.fps;
  stage.setAttribute('viewBox', `0 0 ${proj.w} ${proj.h}`);
  const ratio = proj.w / proj.h; stage.style.aspectRatio = ratio; stage.style.width = ratio >= 1 ? 'min(100%, ' + proj.w + 'px)' : 'auto';
  stage.style.height = ratio < 1 ? 'min(100%, ' + proj.h + 'px)' : 'auto';
  render(); renderTools(); renderCatalog();
}
$('#back').onclick = () => { stopPlay(); save(); proj = null; $('#editor').hidden = true; $('#home').hidden = false; renderHome(); };
$('#pname').oninput = e => { proj.name = e.target.value; save(); };

const TOOLS = [['select', '➤', 'Select / move'], ['node', '◇', 'Edit points'], ['pencil', '✏️', 'Pencil'], ['marker', '🖍', 'Marker'],
  ['eraser', '🧽', 'Eraser'], ['bucket', '🪣', 'Bucket'], ['text', 'T', 'Text'], ['shape', '⬛', 'Shape (pick from catalog)']];
function renderTools() {
  $('#tools').innerHTML = TOOLS.map(([k, i, t]) => `<button data-t="${k}" title="${t}" class="${tool === k ? 'active' : ''}">${i}<br>${t.split(' ')[0]}</button>`).join('');
}
$('#tools').onclick = e => { const b = e.target.closest('button'); if (b) { tool = b.dataset.t; renderTools(); render(); } };

function render() {
  if (!proj) return;
  let html = `<rect width="${proj.w}" height="${proj.h}" fill="${esc(proj.bg)}"/>` + frameSvg(proj, proj.frames[cur].id);
  stage.innerHTML = html + '<g id="ui"></g>';
  const found = sel && findItem(sel);
  if (!found) sel = null;
  if (found && (tool === 'node' || tool === 'select')) drawHandles(found.it);
  renderLayers(); renderFrames();
}
function handle(x, y, h) {
  const r = Math.max(proj.w, proj.h) / 90;
  return `<circle data-h="${h}" cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#4f8cff" stroke-width="${r / 3}" style="cursor:move"/>`;
}
function bbox(it) {
  const el = stage.querySelector(`[data-id="${it.id}"]`);
  try { return el.getBBox(); } catch (e) { return null; }
}
function drawHandles(it) {
  let h = '';
  const b = bbox(it);
  if (b) h += `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="#4f8cff" stroke-dasharray="6 4" stroke-width="${Math.max(proj.w, proj.h) / 400}" pointer-events="none"/>`;
  if (tool === 'node') {
    if (it.type === 'poly' || it.type === 'path') it.pts.forEach((p, i) => h += handle(p[0], p[1], i));
    if (it.type === 'ellipse') h += handle(it.cx + it.rx, it.cy, 'rx') + handle(it.cx, it.cy + it.ry, 'ry');
    if (it.type === 'svg') h += handle(it.x + it.w, it.y + it.h, 'br');
    if (it.type === 'text' && b) h += handle(b.x + b.width, b.y, 'fs');
  }
  $('#ui').innerHTML = h;
}

/* layers */
function renderLayers() {
  $('#layers').innerHTML = [...proj.layers].reverse().map(l => `<li data-l="${l.id}" class="${l.id === layerId ? 'sel' : ''}">` +
    `<button data-a="vis" title="Show/hide">${l.visible ? '👁' : '🚫'}</button><span data-a="sel" title="Double-click to rename">${esc(l.name)}</span>` +
    `<button data-a="up">▲</button><button data-a="down">▼</button><button data-a="del">✕</button></li>`).join('');
}
$('#addLayer').onclick = () => {
  checkpoint();
  const l = { id: uid(), name: 'Layer ' + (proj.layers.length + 1), visible: true, items: {} };
  proj.layers.push(l); layerId = l.id; commit();
};
$('#layers').onclick = e => {
  const li = e.target.closest('li'), a = e.target.dataset.a; if (!li || !a) return;
  const i = proj.layers.findIndex(l => l.id === li.dataset.l), l = proj.layers[i];
  if (a === 'sel') layerId = l.id;
  else {
    checkpoint();
    if (a === 'vis') l.visible = !l.visible;
    if (a === 'up' && i < proj.layers.length - 1) [proj.layers[i], proj.layers[i + 1]] = [proj.layers[i + 1], proj.layers[i]];
    if (a === 'down' && i > 0) [proj.layers[i], proj.layers[i - 1]] = [proj.layers[i - 1], proj.layers[i]];
    if (a === 'del') {
      if (proj.layers.length < 2) { alert('A project needs at least one layer.'); history.pop(); return; }
      proj.layers.splice(i, 1); if (layerId === l.id) layerId = proj.layers[Math.max(0, i - 1)].id;
    }
  }
  commit();
};
$('#layers').ondblclick = e => {
  const li = e.target.closest('li'); if (!li || e.target.dataset.a !== 'sel') return;
  const l = proj.layers.find(x => x.id === li.dataset.l), n = (prompt('Layer name', l.name) || '').trim();
  if (n) { l.name = n; commit(); }
};

/* frames */
function renderFrames() {
  if (!proj.animated) return;
  $('#frames').innerHTML = proj.frames.map((f, i) => `<button data-f="${i}" class="${i === cur ? 'active' : ''}">${i + 1}</button>`).join('');
}
$('#frames').onclick = e => { const b = e.target.closest('button'); if (b) { cur = +b.dataset.f; render(); } };
function addFrame(copy) {
  checkpoint();
  const nf = { id: uid() };
  proj.layers.forEach(l => { l.items[nf.id] = copy ? clone(curItems(l)).map(i => ({ ...i, id: uid() })) : []; });
  proj.frames.splice(cur + 1, 0, nf); cur++; commit();
}
$('#addFrame').onclick = () => addFrame(false);
$('#dupFrame').onclick = () => addFrame(true);
$('#delFrame').onclick = () => {
  if (proj.frames.length < 2) return;
  checkpoint();
  const [f] = proj.frames.splice(cur, 1); proj.layers.forEach(l => delete l.items[f.id]);
  cur = Math.min(cur, proj.frames.length - 1); commit();
};
$('#fps').onchange = e => { proj.fps = Math.min(60, Math.max(1, +e.target.value || 8)); e.target.value = proj.fps; save(); if (timer) { stopPlay(); startPlay(); } };
function startPlay() { $('#play').textContent = '⏸ Stop'; timer = setInterval(() => { cur = (cur + 1) % proj.frames.length; render(); }, 1000 / proj.fps); }
function stopPlay() { if (timer) clearInterval(timer); timer = null; $('#play').textContent = '▶ Play'; }
$('#play').onclick = () => timer ? stopPlay() : startPlay();

/* catalog */
function thumb(entry) {
  if (entry.custom) return `<svg viewBox="${esc(entry.vb)}">${entry.markup}</svg>`;
  if (entry.kind === 'ellipse') return '<svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="45" ry="35" fill="#4f8cff"/></svg>';
  const pts = shapePts(entry.kind, 5, 5, 90, 90);
  return `<svg viewBox="0 0 100 100"><path d="${polyPath(pts, 0, entry.kind !== 'line')}" fill="${entry.kind === 'line' ? 'none' : '#4f8cff'}" stroke="#4f8cff" stroke-width="4"/></svg>`;
}
function renderCatalog() {
  const admin = $('#admin').checked;
  $('#adminBox').hidden = !admin;
  $('#catalog').innerHTML = BASIC.map(k => `<button data-k="${k}" title="${k}">${thumb({ kind: k })}</button>`).join('') +
    db.catalog.map(c => `<div style="position:relative"><button data-c="${c.id}" title="${esc(c.name)}" style="width:100%;height:44px">${thumb({ custom: 1, ...c })}</button>` +
      (admin ? `<button data-dc="${c.id}" style="position:absolute;top:0;right:0;padding:0 3px">✕</button>` : '') + '</div>').join('');
}
$('#admin').onchange = renderCatalog;
$('#catalog').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.dc) { db.catalog = db.catalog.filter(c => c.id !== b.dataset.dc); save(); renderCatalog(); return; }
  shape = b.dataset.k ? { kind: b.dataset.k } : { custom: db.catalog.find(c => c.id === b.dataset.c) };
  tool = 'shape'; renderTools();
};
$('#upload').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const r = sanitizeSvg(await file.text());
    db.catalog.push({ id: uid(), name: file.name.replace(/\.svg$/i, ''), ...r }); save(); renderCatalog();
  } catch (err) { alert(err.message); }
  e.target.value = '';
};

/* options panel */
const sizeIn = $('#size');
function applyOptions(patch) {
  const f = sel && findItem(sel); if (!f) return;
  checkpoint(); patch(f.it); commit();
}
sizeIn.oninput = () => { $('#sizeV').textContent = sizeIn.value; applyOptions(it => { if (it.type === 'text') it.size = +sizeIn.value * 4; else it.sw = +sizeIn.value; if (it.type === 'path' && it.opacity < 1) it.sw = +sizeIn.value * 3; }); };
$('#fill').oninput = e => applyOptions(it => { it.fill = e.target.value; });
$('#stroke').oninput = e => applyOptions(it => { it.stroke = e.target.value; });
$('#radius').oninput = e => applyOptions(it => { if (it.type === 'poly') it.radius = +e.target.value; });
$('#textVal').oninput = e => applyOptions(it => { if (it.type === 'text') it.text = e.target.value; });
$('#delSel').onclick = deleteSel;
function deleteSel() {
  const f = sel && findItem(sel); if (!f) return;
  checkpoint(); const a = curItems(f.l); a.splice(a.findIndex(i => i.id === sel), 1); sel = null; commit();
}
$('#undo').onclick = undo;
function undo() {
  const s = history.pop(); if (!s) return;
  const o = JSON.parse(s); Object.assign(proj, { layers: o.layers, frames: o.frames, bg: o.bg }); cur = Math.min(o.cur, proj.frames.length - 1);
  if (!proj.layers.some(l => l.id === layerId)) layerId = proj.layers[0].id;
  commit();
}
addEventListener('keydown', e => {
  if (!proj || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
});
$('#exportSvg').onclick = () => {
  const blob = new Blob([exportSvg(proj)], { type: 'image/svg+xml' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = (proj.name.replace(/[^\w\- ]+/g, '') || 'art') + '.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* ---------- pointer interaction ---------- */
function pt(e) {
  const p = stage.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(stage.getScreenCTM().inverse()); return [q.x, q.y];
}
const base = () => ({ id: uid(), fill: $('#fill').value, stroke: $('#stroke').value, sw: +sizeIn.value });
function pick(e) { const el = e.target.closest && e.target.closest('[data-id]'); return el ? el.dataset.id : null; }
function select(id) {
  sel = id; const f = id && findItem(id);
  if (f) { layerId = f.l.id; const it = f.it; if (it.type === 'poly') $('#radius').value = it.radius || 0; }
}
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function moveItem(it, dx, dy) {
  if (it.pts) it.pts = it.pts.map(p => [p[0] + dx, p[1] + dy]);
  else if ('cx' in it) { it.cx += dx; it.cy += dy; } else { it.x += dx; it.y += dy; }
}
function eraseAt(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY), id = el && el.closest && el.closest('#stage [data-id]');
  const f = id && findItem(id.dataset.id);
  if (f) { const a = curItems(f.l); a.splice(a.findIndex(i => i.id === f.it.id), 1); render(); }
}

stage.addEventListener('pointerdown', e => {
  if (!proj || timer) return;
  const p = pt(e), L = activeLayer();
  const hid = e.target.dataset && e.target.dataset.h;
  stage.setPointerCapture(e.pointerId);
  if (hid !== undefined && hid !== null && tool === 'node') { checkpoint(); drag = { kind: 'handle', h: hid }; return; }
  const hit = pick(e);
  switch (tool) {
    case 'select': case 'node': {
      if (hit && tool === 'node' && e.shiftKey && sel === hit) {
        const it = findItem(hit).it;
        if (it.pts) {
          checkpoint();
          const n = it.pts.length, segs = it.closed ? n : n - 1; let best = 0, bd = 1e9;
          for (let i = 0; i < segs; i++) { const d = distSeg(p, it.pts[i], it.pts[(i + 1) % n]); if (d < bd) { bd = d; best = i; } }
          it.pts.splice(best + 1, 0, p); commit(); drag = null; return;
        }
      }
      select(hit);
      if (hit) { checkpoint(); drag = { kind: 'move', last: p }; }
      render(); break;
    }
    case 'pencil': case 'marker': {
      checkpoint(); if (!L.visible) { L.visible = true; }
      const it = { ...base(), type: 'path', pts: [p, p], opacity: tool === 'marker' ? .6 : 1 };
      if (tool === 'marker') it.sw = it.sw * 3;
      curItems().push(it); drag = { kind: 'draw', it }; render(); break;
    }
    case 'eraser': checkpoint(); drag = { kind: 'erase' }; eraseAt(e); break;
    case 'bucket': {
      checkpoint();
      if (hit) { const it = findItem(hit).it; if (it.type === 'path') it.stroke = $('#fill').value; else it.fill = $('#fill').value; }
      else proj.bg = $('#fill').value;
      commit(); break;
    }
    case 'text': {
      checkpoint();
      const it = { ...base(), type: 'text', x: p[0], y: p[1], text: $('#textVal').value || 'Text', size: +sizeIn.value * 4 + 12, sw: 0 };
      curItems().push(it); select(it.id); commit(); break;
    }
    case 'shape': {
      checkpoint();
      drag = { kind: 'shape', start: p, it: null }; break;
    }
  }
});
stage.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = pt(e);
  if (drag.kind === 'move') {
    const f = findItem(sel); if (!f) return;
    moveItem(f.it, p[0] - drag.last[0], p[1] - drag.last[1]); drag.last = p; render();
  } else if (drag.kind === 'draw') { drag.it.pts.push(p); render(); }
  else if (drag.kind === 'erase') eraseAt(e);
  else if (drag.kind === 'handle') {
    const f = findItem(sel); if (!f) return; const it = f.it, h = drag.h;
    if (h === 'rx') it.rx = Math.abs(p[0] - it.cx); else if (h === 'ry') it.ry = Math.abs(p[1] - it.cy);
    else if (h === 'br') { it.w = Math.max(1, p[0] - it.x); it.h = Math.max(1, p[1] - it.y); }
    else if (h === 'fs') it.size = Math.max(4, it.size * Math.max(.2, (p[0] - it.x) / (bbox(it).width || 1)));
    else it.pts[+h] = p;
    render();
  } else if (drag.kind === 'shape') {
    const s = drag.start, x = Math.min(s[0], p[0]), y = Math.min(s[1], p[1]), w = Math.abs(p[0] - s[0]), h = Math.abs(p[1] - s[1]);
    const L = activeLayer(), arr = curItems(L);
    if (drag.it) arr.splice(arr.indexOf(drag.it), 1);
    if (w < 2 && h < 2) { drag.it = null; render(); return; }
    let it;
    if (shape.custom) it = { ...base(), type: 'svg', x, y, w, h, vb: shape.custom.vb, markup: shape.custom.markup };
    else if (shape.kind === 'ellipse') it = { ...base(), type: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
    else if (shape.kind === 'line') it = { ...base(), type: 'poly', pts: [s, p], closed: false, radius: 0 };
    else it = { ...base(), type: 'poly', pts: shapePts(shape.kind, x, y, w, h), closed: true, radius: +$('#radius').value };
    arr.push(it); drag.it = it; render();
  }
});
const endDrag = () => {
  if (!drag) return;
  if (drag.kind === 'shape') { if (drag.it) select(drag.it.id); else history.pop(); }
  drag = null; commit();
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

renderHome();
