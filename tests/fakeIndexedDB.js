// Just enough of the IndexedDB API surface for idb.js: open/upgrade,
// a single keyPath object store, and get/put/delete/getAll/clear.

class FakeRequest {
  constructor() {
    this.onsuccess = null;
    this.onerror = null;
    this.result = undefined;
    this.error = null;
  }
  _succeed(result) {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.({ target: this }));
  }
  _fail(error) {
    this.error = error;
    queueMicrotask(() => this.onerror?.({ target: this }));
  }
}

class FakeObjectStore {
  constructor(map, keyPath) {
    this.map = map;
    this.keyPath = keyPath;
  }
  get(key) {
    const req = new FakeRequest();
    req._succeed(this.map.get(key));
    return req;
  }
  put(value) {
    const req = new FakeRequest();
    this.map.set(value[this.keyPath], value);
    req._succeed(value[this.keyPath]);
    return req;
  }
  delete(key) {
    const req = new FakeRequest();
    this.map.delete(key);
    req._succeed(undefined);
    return req;
  }
  getAll() {
    const req = new FakeRequest();
    req._succeed(Array.from(this.map.values()));
    return req;
  }
  clear() {
    const req = new FakeRequest();
    this.map.clear();
    req._succeed(undefined);
    return req;
  }
}

class FakeTransaction {
  constructor(store) {
    this.store = store;
    this.oncomplete = null;
    this.onerror = null;
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore() {
    return this.store;
  }
}

class FakeDB {
  constructor() {
    this.data = new Map();
    this.objectStoreNames = { contains: () => true };
  }
  createObjectStore(name, { keyPath }) {
    this.keyPath = keyPath;
    return new FakeObjectStore(this.data, keyPath);
  }
  transaction() {
    return new FakeTransaction(new FakeObjectStore(this.data, this.keyPath || 'id'));
  }
}

export function installFakeIndexedDB() {
  const db = new FakeDB();
  globalThis.indexedDB = {
    open() {
      const req = new FakeRequest();
      queueMicrotask(() => {
        req.result = db;
        db.createObjectStore('noteBodies', { keyPath: 'id' });
        req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
  return db;
}
