// Keeps the art in this browser and the art on the account the same. The
// browser saves first, so drawing never waits on the network, and anything that
// could not be sent goes up next time. Where two copies differ, the newest wins.
import {
  changes, getDoc, getMeta, keepRemote, listFolders, listProjects, removeLocal, replaceFolders,
} from './store.js';
import { session, call } from './session.js';
import { toast } from './ui.js';

const UPLOAD_WAIT_MS = 4000;
const RETRY_WAIT_MS = 30000;

const uploads = new Set();
const deletes = new Set();
let foldersWaiting = false;
let timer = 0;
let sending = null;
let syncing = null;
let reachedAccount = true;

// The editor listens to this for its save badge.
export const syncStatus = {
  changed() {},
  label: () => (reachedAccount && !uploads.size ? 'Saved to your account' : (reachedAccount ? 'Saved' : 'Saved on this device')),
};

const foldersKey = () => `blook-folders-at-${session.user.name.toLowerCase()}`;

function foldersAt() {
  try { return +localStorage.getItem(foldersKey()) || 0; } catch { return 0; }
}

function setFoldersAt(at) {
  try { localStorage.setItem(foldersKey(), at); } catch { /* It just syncs again next time. */ }
}

function schedule(wait = UPLOAD_WAIT_MS) {
  clearTimeout(timer);
  timer = setTimeout(flushUploads, wait);
}

changes.doc = (id) => { if (session.user) { uploads.add(id); schedule(); } };
changes.removed = (id) => { if (session.user) { uploads.delete(id); deletes.add(id); schedule(); } };
changes.folders = () => {
  if (!session.user) return;
  setFoldersAt(Date.now());
  foldersWaiting = true;
  schedule();
};

async function uploadProject(id) {
  const doc = await getDoc(id);
  if (!doc) return;
  const meta = await getMeta(id);
  await call('PUT', `/api/art/${id}`, { doc, thumb: meta?.thumb || null });
}

const REFUSED = new Set([400, 409, 410, 413]);

async function send() {
  for (const id of [...uploads]) {
    try {
      await uploadProject(id);
      uploads.delete(id);
    } catch (error) {
      if (!REFUSED.has(error.status)) throw error;
      // A retry would be refused too. The next sync settles which copy stays.
      uploads.delete(id);
      if (error.status === 413) toast('That project is too big to save to your account. It is saved on this device.', 'warn');
    }
  }
  for (const id of [...deletes]) {
    await call('DELETE', `/api/art/${id}`);
    deletes.delete(id);
  }
  if (foldersWaiting) {
    await call('PUT', '/api/art/folders', { folders: await listFolders(), at: foldersAt() });
    foldersWaiting = false;
  }
}

export function flushUploads() {
  clearTimeout(timer);
  if (!session.user) return Promise.resolve();
  sending ??= send()
    .then(() => { reachedAccount = true; })
    .catch(() => { reachedAccount = false; schedule(RETRY_WAIT_MS); })
    .finally(() => { sending = null; syncStatus.changed(); });
  return sending;
}

export function resetSync() {
  clearTimeout(timer);
  uploads.clear();
  deletes.clear();
  foldersWaiting = false;
  reachedAccount = true;
}

async function settle() {
  await flushUploads();
  const remote = await call('GET', '/api/art');
  const local = new Map((await listProjects()).map((p) => [p.id, p]));
  let changed = false;

  for (const [id, at] of Object.entries(remote.deleted)) {
    if (local.has(id) && local.get(id).updatedAt <= at) {
      await removeLocal(id);
      local.delete(id);
      changed = true;
    }
  }
  for (const [id, at] of Object.entries(remote.projects)) {
    if (local.get(id)?.updatedAt >= at) continue;
    const { doc, thumb } = await call('GET', `/api/art/${id}`);
    await keepRemote(doc, thumb);
    changed = true;
  }
  // Art made before accounts saved, or while offline, goes up from here.
  for (const [id, meta] of local) {
    const gone = remote.deleted[id] >= meta.updatedAt;
    if (!gone && !(remote.projects[id] >= meta.updatedAt)) uploads.add(id);
  }

  const here = foldersAt();
  if (remote.foldersAt > here) {
    await replaceFolders(remote.folders);
    setFoldersAt(remote.foldersAt);
    changed = true;
  } else if (here > remote.foldersAt || (!remote.foldersAt && (await listFolders()).length)) {
    if (!here) setFoldersAt(Date.now());
    foldersWaiting = true;
  }
  if (uploads.size || foldersWaiting) schedule(0);
  return changed;
}

// Returns true if anything here changed, so the screen can redraw.
export function syncArt() {
  if (!session.user) return Promise.resolve(false);
  syncing ??= settle()
    .catch(() => { reachedAccount = false; return false; })
    .finally(() => { syncing = null; });
  return syncing;
}

addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUploads(); });
