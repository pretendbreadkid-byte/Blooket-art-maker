// Saves folders and projects. Each account gets its own database in this
// browser. Guests get plain memory, so their art is gone when the page closes.
// Lists read only the small "meta" records, so big images do not slow them down.
const LEGACY_DB = 'blook-maker';
const STORES = ['folders', 'meta', 'docs'];

let dbPromise = null;
let memory = null;

// Set by sync.js, which sends changes on to the account.
export const changes = { doc() {}, removed() {}, folders() {} };

function openDb(name) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      for (const store of STORES) open.result.createObjectStore(store, { keyPath: 'id' });
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

// Art made before accounts existed moves into the first account on this browser.
async function adoptLegacy(db) {
  const known = await indexedDB.databases?.();
  if (!known?.some((d) => d.name === LEGACY_DB)) return;
  const old = await openDb(LEGACY_DB);
  const read = old.transaction(STORES, 'readonly');
  const rows = STORES.map((s) => read.objectStore(s).getAll());
  await done(read);
  const write = db.transaction(STORES, 'readwrite');
  STORES.forEach((s, i) => rows[i].result.forEach((row) => write.objectStore(s).put(row)));
  await done(write);
  old.close();
  indexedDB.deleteDatabase(LEGACY_DB);
}

export async function useAccount(username) {
  memory = null;
  const name = `blook-maker-${username.toLowerCase()}`;
  dbPromise = openDb(name);
  await adoptLegacy(await dbPromise).catch(() => {});
}

export function useGuest() {
  dbPromise = null;
  memory = { folders: new Map(), meta: new Map(), docs: new Map() };
}

async function all(store) {
  if (memory) return [...memory[store].values()];
  const tx = (await dbPromise).transaction([store], 'readonly');
  const req = tx.objectStore(store).getAll();
  await done(tx);
  return req.result;
}

async function one(store, id) {
  if (memory) return memory[store].get(id);
  const tx = (await dbPromise).transaction([store], 'readonly');
  const req = tx.objectStore(store).get(id);
  await done(tx);
  return req.result;
}

// changes: [[store, row]] to save, or [[store, id, 'delete']] to remove.
async function write(changes) {
  if (memory) {
    for (const [store, row, del] of changes) {
      if (del) memory[store].delete(row);
      else memory[store].set(row.id, structuredClone(row));
    }
    return;
  }
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
export async function saveFolder(folder) {
  await write([['folders', folder]]);
  changes.folders();
}

export async function saveDoc(doc, thumb = null) {
  doc.updatedAt = Date.now();
  await write([['docs', doc], ['meta', metaOf(doc, thumb)]]);
  changes.doc(doc.id);
}

export const saveThumb = (doc, thumb) => write([['meta', metaOf(doc, thumb)]]);

export async function deleteProject(id) {
  await removeLocal(id);
  changes.removed(id);
}

// These two apply what came from the account, so nothing is sent back.
export const keepRemote = (doc, thumb) => write([['docs', doc], ['meta', metaOf(doc, thumb)]]);
export const removeLocal = (id) => write([['docs', id, 'delete'], ['meta', id, 'delete']]);
export const replaceFolders = async (folders) => {
  const old = await listFolders();
  await write([...old.map((f) => ['folders', f.id, 'delete']), ...folders.map((f) => ['folders', f])]);
};

// Projects in a deleted folder move out to "All projects". They are not deleted.
export async function deleteFolder(id) {
  const projects = (await listProjects()).filter((p) => p.folderId === id);
  await Promise.all(projects.map(async (meta) => {
    const doc = await getDoc(meta.id);
    doc.folderId = null;
    await saveDoc(doc, meta.thumb);
  }));
  await write([['folders', id, 'delete']]);
  changes.folders();
}
