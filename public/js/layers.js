// The Layers panel: everything on the canvas, top first. Groups are folders. Each
// row can be shown or hidden, locked, renamed, and dragged to a new place in the
// stack. It shows only in projects that turned it on.
import { S, commit, refresh, select, activeLayer, findObj } from './state.js';
import { objectsOn } from './model.js';
import { esc } from './render.js';
import { canGroup, canUngroup, groupSelection, ungroupSelection } from './tools.js';
import { $, $$, html, icon, toast } from './ui.js';

const openGroups = new Set();
const TYPE_ICONS = { path: 'shapes', text: 'text', image: 'image' };

// What a group is called: its own name, or what its pieces have in common.
function groupName(id, members) {
  const named = S.doc.groupNames?.[id];
  if (named) return named;
  const first = members[0]?.name || 'Group';
  return first.replace(/\s+\d+$/, '') || 'Group';
}

const objIcon = (o) => (o.parts?.length ? 'weld' : TYPE_ICONS[o.type] || 'shapes');
// Text that was never renamed goes by its own words.
const label = (o) => (o.type === 'text' && (!o.name || o.name === 'Text') ? o.text.split('\n')[0].slice(0, 40) || 'Text' : o.name || o.type);

function row(o, inGroup) {
  return `<li class="layer-row ${S.sel.has(o.id) ? 'on' : ''} ${o.hidden ? 'is-hidden' : ''} ${inGroup ? 'in-group' : ''}" data-id="${o.id}" draggable="true">
    <button class="lr-eye" title="${o.hidden ? 'Show' : 'Hide'}" aria-label="${o.hidden ? 'Show' : 'Hide'} ${esc(o.name)}">${icon(o.hidden ? 'eyeoff' : 'eye')}</button>
    <span class="lr-icon">${icon(objIcon(o))}</span>
    <span class="lr-name" title="Double-click to rename">${esc(label(o))}</span>
    <button class="lr-lock ${o.locked ? 'locked' : ''}" title="${o.locked ? 'Unlock' : 'Lock'}" aria-label="${o.locked ? 'Unlock' : 'Lock'} ${esc(o.name)}">${icon(o.locked ? 'lock' : 'unlock')}</button>
  </li>`;
}

function groupRow(id, members) {
  const open = openGroups.has(id);
  const allOn = members.every((o) => S.sel.has(o.id));
  const hidden = members.every((o) => o.hidden), locked = members.every((o) => o.locked);
  return `<li class="layer-group" data-g="${id}">
    <div class="layer-row group-row ${allOn ? 'on' : ''} ${hidden ? 'is-hidden' : ''}" data-g="${id}" draggable="true">
      <button class="lr-eye" title="${hidden ? 'Show' : 'Hide'}" aria-label="${hidden ? 'Show' : 'Hide'} group">${icon(hidden ? 'eyeoff' : 'eye')}</button>
      <button class="lr-open ${open ? 'open' : ''}" aria-label="${open ? 'Close' : 'Open'} group" aria-expanded="${open}">${icon('chevron')}</button>
      <span class="lr-icon">${icon('folder')}</span>
      <span class="lr-name" title="Double-click to rename">${esc(groupName(id, members))}</span>
      <em class="lr-count">${members.length}</em>
      <button class="lr-lock ${locked ? 'locked' : ''}" title="${locked ? 'Unlock' : 'Lock'}" aria-label="${locked ? 'Unlock' : 'Lock'} group">${icon(locked ? 'lock' : 'unlock')}</button>
    </div>
    ${open ? `<ul>${members.map((o) => row(o, true)).join('')}</ul>` : ''}
  </li>`;
}

// The stack, top first, with each group gathered where its top piece is.
function stack() {
  const objects = [...objectsOn(S.doc, activeLayer(), S.frame)].reverse();
  const seen = new Set(), items = [];
  for (const o of objects) {
    if (!o.group) { items.push({ o }); continue; }
    if (seen.has(o.group)) continue;
    seen.add(o.group);
    items.push({ group: o.group, members: objects.filter((m) => m.group === o.group) });
  }
  return items;
}

const idsOf = (el) => {
  const g = el.dataset.g;
  return g ? activeLayer().objects.filter((o) => o.group === g).map((o) => o.id) : [el.dataset.id];
};

// Moves the dragged things just above or below the target in the stack. Dropped
// among a group's pieces (or on a group), they join it; elsewhere they leave it.
function moveTo(ids, targetEl, above) {
  const layer = activeLayer();
  const moving = layer.objects.filter((o) => ids.includes(o.id));
  const targets = idsOf(targetEl);
  if (!moving.length || targets.some((id) => ids.includes(id))) return;
  const rest = layer.objects.filter((o) => !ids.includes(o.id));
  const targetObjs = rest.filter((o) => targets.includes(o.id));
  // The list shows the top first, so "above" in the list is later in the stack.
  const at = above ? rest.indexOf(targetObjs[targetObjs.length - 1]) + 1 : rest.indexOf(targetObjs[0]);
  rest.splice(at, 0, ...moving);
  layer.objects = rest;
  const joining = targetEl.closest('.layer-group')?.dataset.g;
  moving.forEach((o) => { if (joining) o.group = joining; else delete o.group; });
  commit();
  refresh();
}

function rename(el, current, save) {
  const input = html(`<input class="lr-rename" value="${esc(current)}" maxlength="60" aria-label="Name">`);
  el.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (keep && name && name !== current) { save(name); commit(); }
    refresh();
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
}

export function drawLayers() {
  const host = $('#layers');
  if (!host || !S.doc) return;
  host.hidden = !S.doc.layersPanel;
  if (host.hidden) return;
  const items = stack();
  host.innerHTML = `<div class="panel-head"><h3>${icon('layers')}<span>Layers</span></h3>
      <span class="layer-tools">
        <button class="ib" id="lgroup" title="Group (Ctrl+G)" aria-label="Group" ${canGroup() ? '' : 'disabled'}>${icon('group')}</button>
        <button class="ib" id="lungroup" title="Ungroup (Ctrl+Shift+G)" aria-label="Ungroup" ${canUngroup() ? '' : 'disabled'}>${icon('ungroup')}</button>
        <button class="ib" id="lclose" title="Close the Layers panel (turn it back on in the Canvas panel)" aria-label="Close the Layers panel">${icon('x')}</button>
      </span></div>
    ${items.length ? `<ul class="layer-list">${items.map((it) => (it.o ? row(it.o, false) : groupRow(it.group, it.members))).join('')}</ul>`
      : '<p class="muted small">Things you add show up here.</p>'}`;
  $('#lgroup', host).onclick = groupSelection;
  $('#lungroup', host).onclick = ungroupSelection;
  $('#lclose', host).onclick = () => {
    S.doc.layersPanel = false;
    commit();
    refresh();
    toast('Layers panel closed. Turn it back on in the Canvas panel.');
  };

  $$('.layer-row', host).forEach((el) => {
    const ids = idsOf(el);
    const objs = ids.map(findObj).filter(Boolean);
    el.onclick = (e) => {
      if (e.target.closest('button, input')) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        const next = new Set(S.sel);
        const has = ids.every((id) => next.has(id));
        ids.forEach((id) => (has ? next.delete(id) : next.add(id)));
        select([...next]);
      } else {
        select(ids.filter((id) => !findObj(id)?.locked && !findObj(id)?.hidden));
      }
      refresh();
    };
    $('.lr-eye', el).onclick = () => {
      const hide = !objs.every((o) => o.hidden);
      objs.forEach((o) => { o.hidden = hide; if (hide) S.sel.delete(o.id); });
      commit();
      refresh();
    };
    $('.lr-lock', el).onclick = () => {
      const lock = !objs.every((o) => o.locked);
      objs.forEach((o) => { o.locked = lock; if (lock) S.sel.delete(o.id); });
      commit();
      refresh();
    };
    $('.lr-open', el)?.addEventListener('click', () => {
      const g = el.dataset.g;
      if (openGroups.has(g)) openGroups.delete(g); else openGroups.add(g);
      drawLayers();
    });
    $('.lr-name', el).ondblclick = (e) => {
      const g = el.dataset.g;
      if (g) rename(e.target, groupName(g, objs), (name) => { S.doc.groupNames = { ...S.doc.groupNames, [g]: name }; });
      else rename(e.target, label(objs[0]), (name) => { objs[0].name = name; });
    };
    el.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      const dragged = ids.some((id) => S.sel.has(id)) && !el.dataset.g ? [...S.sel] : ids;
      e.dataTransfer.setData('text/layers', JSON.stringify(dragged));
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/layers')) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      el.classList.toggle('drop-above', e.clientY < r.top + r.height / 2);
      el.classList.toggle('drop-below', e.clientY >= r.top + r.height / 2);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-above', 'drop-below'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const above = el.classList.contains('drop-above');
      el.classList.remove('drop-above', 'drop-below');
      try { moveTo(JSON.parse(e.dataTransfer.getData('text/layers')), el, above); } catch { /* Not ours to drop. */ }
    });
  });
}
