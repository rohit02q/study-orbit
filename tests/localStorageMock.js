// A faithful-enough localStorage mock: string-only values, quota simulation,
// and the same "throws on write, leaves previous value intact" behavior
// real browsers exhibit — which storage.js's backup safety depends on.
export class LocalStorageMock {
  constructor(quotaBytes = Infinity) {
    this.store = new Map();
    this.quotaBytes = quotaBytes;
  }

  get length() {
    return this.store.size;
  }

  key(index) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  setItem(key, value) {
    const strValue = String(value);
    const currentSize = this._totalBytes() - (this.store.has(key) ? this.store.get(key).length : 0);
    if (currentSize + strValue.length > this.quotaBytes) {
      const err = new Error('Quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.store.set(key, strValue);
  }

  removeItem(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  _totalBytes() {
    let total = 0;
    for (const v of this.store.values()) total += v.length;
    return total;
  }

  // Object.keys(localStorage) is used by clearAllStorage()
  static installGlobal(instance) {
    globalThis.localStorage = new Proxy(instance, {
      ownKeys(target) {
        return Array.from(target.store.keys());
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
      },
      get(target, prop) {
        if (prop in target || typeof target[prop] === 'function') {
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return target.store.get(prop);
      },
    });
  }
}
