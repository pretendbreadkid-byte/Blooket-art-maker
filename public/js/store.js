// Saves folders and projects in this browser. Lists read only the small "meta"
// records, so a project with big images does not slow the home screen down.
const DB_NAME = 'blook-maker';

let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      for (const name of ['folders', 'meta', 'docs']) open.result.createObjectStore(name, { keyPath: 'id' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const tx = (await db()).transaction(stores, mode);
  const result = fn(tx);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const metaOf = (doc, thumb) => ({
  id: doc.id, name: doc.name, folderId: doc.folderId, animated: doc.animated,
  width: doc.width, height: doc.height, updatedAt: doc.updatedAt, thumb,
});

export const listFolders = () => run(['folders'], 'readonly', (tx) => tx.objectStore('folders').getAll());
export const listProjects = () => run(['meta'], 'readonly', (tx) => tx.objectStore('meta').getAll());
export const getDoc = (id) => run(['docs'], 'readonly', (tx) => tx.objectStore('docs').get(id));
export const getMeta = (id) => run(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(id));

export const saveFolder = (folder) => run(['folders'], 'readwrite', (tx) => { tx.objectStore('folders').put(folder); });

export const saveDoc = (doc, thumb = null) => run(['docs', 'meta'], 'readwrite', (tx) => {
  tx.objectStore('docs').put(doc);
  tx.objectStore('meta').put(metaOf(doc, thumb));
});

export const saveThumb = (doc, thumb) => run(['meta'], 'readwrite', (tx) => {
  tx.objectStore('meta').put(metaOf(doc, thumb));
});

export const deleteProject = (id) => run(['docs', 'meta'], 'readwrite', (tx) => {
  tx.objectStore('docs').delete(id);
  tx.objectStore('meta').delete(id);
});

// Projects in a deleted folder move out to "All projects". They are not deleted.
export async function deleteFolder(id) {
  const projects = (await listProjects()).filter((p) => p.folderId === id);
  await Promise.all(projects.map(async (meta) => {
    const doc = await getDoc(meta.id);
    doc.folderId = null;
    await saveDoc(doc, meta.thumb);
  }));
  await run(['folders'], 'readwrite', (tx) => { tx.objectStore('folders').delete(id); });
}
