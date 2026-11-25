/** IndexedDB 持久化：领域对象分表存储，设置走 kv 键值表 */
const DB_NAME = 'lane-oil-sim';
const DB_VERSION = 1;

export const STORES = {
  patterns: 'patterns',
  lanes: 'lanes',
  balls: 'balls',
  styles: 'styles',
  players: 'players',
  matches: 'matches',
  kv: 'kv',
} as const;

export type StoreName = keyof typeof STORES;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === 'kv' ? 'key' : 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORES[store], mode);
        const req = fn(t.objectStore(STORES[store]));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export interface RepoEntity {
  id: string;
}

export const repo = {
  async getAll<T extends RepoEntity>(store: StoreName): Promise<T[]> {
    return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  },
  async get<T extends RepoEntity>(store: StoreName, id: string): Promise<T | undefined> {
    return tx<T | undefined>(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
  },
  async put<T extends RepoEntity>(store: StoreName, entity: T): Promise<T> {
    return tx(store, 'readwrite', (s) => s.put(entity)).then(() => entity);
  },
  async bulkPut<T extends RepoEntity>(store: StoreName, entities: T[]): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORES[store], 'readwrite');
      const s = t.objectStore(STORES[store]);
      entities.forEach((e) => s.put(e));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async remove(store: StoreName, id: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.delete(id));
  },
  async clear(store: StoreName): Promise<void> {
    await tx(store, 'readwrite', (s) => s.clear());
  },
};

/** kv 表读写（设置等单例对象） */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(STORES.kv, 'readonly');
    const req = t.objectStore(STORES.kv).get(key);
    req.onsuccess = () => resolve((req.result as { value: T } | undefined)?.value);
    req.onerror = () => reject(req.error);
  });
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORES.kv, 'readwrite');
    t.objectStore(STORES.kv).put({ key, value });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
