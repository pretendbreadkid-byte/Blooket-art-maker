// Editor state, undo history and saving.
import { clone, clamp, sample, setProps, isPages, objectsOn, flattenLayers } from './model.js';
import { BASIC_SHAPES } from './shapes.js';
import { exportSVG, rasterize } from './render.js';
import { saveDoc, saveThumb } from './store.js';

const HISTORY_LIMIT = 60;

export const S = {
  doc: null,
  frame: 0,
  tool: 'select',
  sel: new Set(),
  nodeSel: new Set(),
  selKey: null,
  zoom: 1, panX: 0, panY: 0, fitted: true,
  fill: '#6c3bf5',
  fillGradient: null,
  stroke: '#1f1b3a',
  nodeKind: 'pointed',
  shapeOutline: 0,
  sizes: { pencil: 4, marker: 22, eraser: 28, line: 6 },
  shape: BASIC_SHAPES[0],
  catalog: [],
  font: { fontFamily: 'Arial', fontSize: 64, bold: false, italic: false, shadow: false },
  playing: false,
  onion: false,
  clipboard: null,
  thumb: null,
  line: null,
  lineSnap: null,
  vertexSpot: null,
  blooksOpen: false,
};

// Set by the editor: redraw the canvas, the handles, the panels, the save badge.
export const hooks = { stage() {}, overlay() {}, panels() {}, timeline() {}, saved() {}, committed() {} };

let undoStack = [], redoStack = [], lastSnapshot = null, saveTimer = null, savedSnapshot = null;

export function openDoc(doc, thumb) {
  flattenLayers(doc);
  S.doc = doc;
  S.thumb = thumb;
  S.frame = 0;
  S.sel.clear();
  S.nodeSel.clear();
  S.selKey = null;
  S.playing = false;
  S.line = null;
  S.lineSnap = null;
  undoStack = [];
  redoStack = [];
  lastSnapshot = JSON.stringify(doc);
  savedSnapshot = lastSnapshot;
}

export const refresh = () => { hooks.stage(); hooks.overlay(); hooks.panels(); hooks.timeline(); };
export const liveRefresh = () => { hooks.stage(); hooks.overlay(); };

export const activeLayer = () => S.doc.layers.find((l) => l.id === S.doc.activeLayerId) || S.doc.layers[0];
export const allObjects = () => S.doc.layers.flatMap((l) => l.objects);
export const findObj = (id) => allObjects().find((o) => o.id === id);
export const layerOf = (id) => S.doc.layers.find((l) => l.objects.some((o) => o.id === id));
export const selected = () => [...S.sel].map(findObj).filter(Boolean);
export const visibleObjects = () => objectsOn(S.doc, activeLayer(), S.frame);
// Puts new art on top of the stack. In a page animation it goes on the page showing now.
export function addObject(layer, obj) {
  if (isPages(S.doc)) obj.page = S.doc.pages[S.frame].id;
  layer.objects.push(obj);
}
export const groupOf = (obj) => (obj.group ? allObjects().filter((o) => o.group === obj.group).map((o) => o.id) : [obj.id]);
export const posed = (o) => sample(o, S.frame);
export const edit = (o, patch) => setProps(S.doc, o, S.frame, patch);

// A paint is a colour string or a gradient { from, to, angle }.
export const paintPatch = (paint) => (typeof paint === 'string'
  ? { fill: paint, gradient: null }
  : { fill: paint.from, gradient: paint });
export const fillPatch = () => ({ fill: S.fill, gradient: S.fillGradient });
export function setToolFill(paint) {
  const { fill, gradient } = paintPatch(paint);
  S.fill = fill;
  S.fillGradient = gradient;
}

export function select(ids) {
  S.sel = new Set(ids);
  S.nodeSel.clear();
  const first = ids[0] && layerOf(ids[0]);
  if (first) S.doc.activeLayerId = first.id;
}

function scheduleSave() {
  hooks.saved('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}

export async function persist() {
  clearTimeout(saveTimer);
  const doc = S.doc;
  if (!doc) return;
  // Just looking at a project must not make it the newest copy on the account.
  const snapshot = JSON.stringify(doc);
  if (snapshot === savedSnapshot) { hooks.saved('saved'); return; }
  savedSnapshot = snapshot;
  const copy = clone(doc);
  await saveDoc(copy, S.thumb);
  if (S.doc === doc) hooks.saved('saved');
  const scale = 320 / Math.max(doc.width, doc.height);
  try {
    const svg = exportSVG(doc, { frame: 0 });
    const canvas = await rasterize(svg, Math.max(1, Math.round(doc.width * scale)), Math.max(1, Math.round(doc.height * scale)));
    S.thumb = canvas.toDataURL('image/png');
    await saveThumb(copy, S.thumb);
  } catch {
    // A missing thumbnail is not worth interrupting anyone for.
  }
}

// Call once after each finished action: it records an undo step and saves.
export function commit() {
  const snapshot = JSON.stringify(S.doc);
  if (snapshot === lastSnapshot) { refresh(); return; }
  undoStack.push(lastSnapshot);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  lastSnapshot = snapshot;
  scheduleSave();
  refresh();
  hooks.committed();
}

function restore(snapshot) {
  S.doc = JSON.parse(snapshot);
  lastSnapshot = snapshot;
  S.frame = clamp(S.frame, 0, S.doc.frames - 1);
  S.sel = new Set([...S.sel].filter(findObj));
  S.nodeSel.clear();
  S.selKey = null;
  scheduleSave();
  refresh();
}

export function undo() {
  if (undoStack.length) { redoStack.push(lastSnapshot); restore(undoStack.pop()); }
}

export function redo() {
  if (redoStack.length) { undoStack.push(lastSnapshot); restore(redoStack.pop()); }
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
