// Saves folders, projects and uploaded pictures in this browser (IndexedDB).
// Lists read only the small "meta" records, so big images do not slow them down.
const DB_NAME = 'blook-berry';
const DB_VERSION = 2;
const STORES = ['folders', 'meta', 'docs', 'uploads'];
const MERGED_KEY = 'bb-merged-old-art';

let dbPromise = null;

function openDb(name, version = DB_VERSION) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, version);
    open.onupgradeneeded = () => {
      for (const store of STORES) {
        if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store, { keyPath: 'id' });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

// Art from before: the old one-database days and the old per-account copies in
// this browser all move into the one database. The newest copy of each project wins.
async function mergeOldArt(db) {
  try { if (localStorage.getItem(MERGED_KEY)) return; } catch { /* check anyway */ }
  const known = (await indexedDB.databases?.()) || [];
  const old = known.map((d) => d.name).filter((n) => n === 'blook-maker' || /^blook-maker-/.test(n));
  for (const name of old) {
    const from = await openDb(name, undefined).catch(() => null);
    if (!from) continue;
    const have = STORES.filter((s) => from.objectStoreNames.contains(s));
    if (have.length) {
      const read = from.transaction(have, 'readonly');
      const rows = have.map((s) => read.objectStore(s).getAll());
      await done(read);
      const current = db.transaction(['meta'], 'readonly');
      const metas = current.objectStore('meta').getAll();
      await done(current);
      const newest = new Map(metas.result.map((m) => [m.id, m.updatedAt || 0]));
      const write = db.transaction(have, 'readwrite');
      have.forEach((s, i) => rows[i].result.forEach((row) => {
        if ((s === 'docs' || s === 'meta') && (newest.get(row.id) || 0) > (row.updatedAt || 0)) return;
        write.objectStore(s).put(row);
      }));
      await done(write);
    }
    from.close();
  }
  try { localStorage.setItem(MERGED_KEY, '1'); } catch { /* it merges again next time, harmlessly */ }
}

export async function useLocal() {
  dbPromise = openDb(DB_NAME);
  await mergeOldArt(await dbPromise).catch(() => {});
}

async function all(store) {
  const tx = (await dbPromise).transaction([store], 'readonly');
  const req = tx.objectStore(store).getAll();
  await done(tx);
  return req.result;
}

async function one(store, id) {
  const tx = (await dbPromise).transaction([store], 'readonly');
  const req = tx.objectStore(store).get(id);
  await done(tx);
  return req.result;
}

// changes: [[store, row]] to save, or [[store, id, 'delete']] to remove.
async function write(changes) {
  const tx = (await dbPromise).transaction([...new Set(changes.map((c) => c[0]))], 'readwrite');
  for (const [store, row, del] of changes) {
    if (del) tx.objectStore(store).delete(row);
    else tx.objectStore(store).put(row);
  }
  await done(tx);
}

const metaOf = (doc, thumb) => ({
  id: doc.id, name: doc.name, folderId: doc.folderId, animated: doc.animated,
  width: doc.width, height: doc.height, updatedAt: doc.updatedAt, thumb, template: doc.template, pack: !!doc.pack,
});

export const listFolders = () => all('folders');
export const listProjects = () => all('meta');
export const getDoc = (id) => one('docs', id);
export const getMeta = (id) => one('meta', id);
export const saveFolder = (folder) => write([['folders', folder]]);

export async function saveDoc(doc, thumb = null) {
  doc.updatedAt = Date.now();
  await write([['docs', doc], ['meta', metaOf(doc, thumb)]]);
}

export const saveThumb = (doc, thumb) => write([['meta', metaOf(doc, thumb)]]);
export const deleteProject = (id) => write([['docs', id, 'delete'], ['meta', id, 'delete']]);

// Projects in a deleted folder move out to "All projects". They are not deleted.
export async function deleteFolder(id) {
  const projects = (await listProjects()).filter((p) => p.folderId === id);
  await Promise.all(projects.map(async (meta) => {
    const doc = await getDoc(meta.id);
    doc.folderId = null;
    await saveDoc(doc, meta.thumb);
  }));
  await write([['folders', id, 'delete']]);
}

/* ---------- Uploaded pictures ---------- */

export const listUploads = async () => (await all('uploads')).sort((a, b) => (b.at || 0) - (a.at || 0));
export const saveUpload = (item) => write([['uploads', { at: Date.now(), ...item }]]);
export const deleteUpload = (id) => write([['uploads', id, 'delete']]);

/* ---------- Backups ---------- */

// Everything in one file, to keep somewhere safe or move to another browser.
export async function backupAll() {
  const [folders, meta, docs, uploads] = await Promise.all(STORES.map(all));
  return { app: 'blook-berry', version: 1, at: Date.now(), folders, meta, docs, uploads };
}

// Adds a backup's art. Projects already here are kept unless the backup's copy is newer.
export async function restoreBackup(data) {
  if (data?.app !== 'blook-berry' || !Array.isArray(data.docs)) throw new Error('That is not a Blook Berry backup file.');
  const newest = new Map((await listProjects()).map((m) => [m.id, m.updatedAt || 0]));
  const fresh = (row) => row?.id && (newest.get(row.id) || 0) <= (row.updatedAt || 0);
  const rows = [
    ...(data.folders || []).filter((r) => r?.id).map((r) => ['folders', r]),
    ...(data.docs || []).filter(fresh).map((r) => ['docs', r]),
    ...(data.meta || []).filter(fresh).map((r) => ['meta', r]),
    ...(data.uploads || []).filter((r) => r?.id && r.href).map((r) => ['uploads', r]),
  ];
  if (rows.length) await write(rows);
  return (data.docs || []).filter(fresh).length;
}
