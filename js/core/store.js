import { loadData, savePart, saveAllParts, clearAllStorage } from './storage.js';
import { getValidatorFor, COLLECTION_NAMES, createDefaultData } from './schema.js';
import { uuid, nowISO, deepClone } from './utils.js';
import { emit } from './events.js';
import { clearAllNoteBodies } from './idb.js';

let state = null;

/**
 * Boots the store from persisted storage (or seeds defaults). Call once at app startup.
 * Returns the load outcome (not the data itself) — use getState() for the data.
 */
export function initStore() {
  const { data, isNew, restoredFromBackup, migrated, warnings } = loadData();
  state = data;
  warnings.forEach((w) => console.warn('[studyos:storage]', w));
  const outcome = { isNew, restoredFromBackup, migrated, warnings };
  emit('store:ready', outcome);
  return outcome;
}

/** Returns a deep clone so callers can never mutate internal state directly. */
export function getState() {
  if (!state) throw new Error('Store not initialized — call initStore() first.');
  return deepClone(state);
}

export function getSettings() {
  return deepClone(state.settings);
}

/**
 * Saves ONE section (a collection, or 'settings') to its own key, plus meta
 * (its lastUpdated timestamp changes on every mutation). This is why notes
 * and sessions and settings live under separate localStorage keys — adding
 * a todo only rewrites the todos key and meta, nothing else.
 */
function persistPart(partName) {
  state.meta.lastUpdated = nowISO();
  const metaOutcome = savePart('meta', state.meta);
  const partOutcome = savePart(partName, state[partName]);
  const outcome = metaOutcome.ok && partOutcome.ok ? { ok: true } : !partOutcome.ok ? partOutcome : metaOutcome;
  if (!outcome.ok) {
    emit('store:error', outcome);
    console.error('[studyos:storage] save failed:', outcome);
  }
  return outcome;
}

function assertCollection(collectionName) {
  if (!COLLECTION_NAMES.includes(collectionName)) {
    throw new Error(`Unknown collection: ${collectionName}`);
  }
}

// ---------- Generic CRUD ----------

export function listRecords(collectionName, filterFn) {
  assertCollection(collectionName);
  const records = deepClone(state[collectionName]);
  return filterFn ? records.filter(filterFn) : records;
}

export function getRecord(collectionName, id) {
  assertCollection(collectionName);
  const found = state[collectionName].find((r) => r.id === id);
  return found ? deepClone(found) : null;
}

/**
 * Adds a record. `partial` need not include id/createdAt — sensible
 * defaults are filled in before validation.
 * Returns { ok, record, errors }
 */
export function addRecord(collectionName, partial) {
  assertCollection(collectionName);
  const validate = getValidatorFor(collectionName);
  const timestamp = nowISO();

  const record = {
    id: uuid(),
    createdAt: timestamp,
    ...partial,
  };

  const check = validate(record);
  if (!check.valid) {
    return { ok: false, record: null, errors: check.errors };
  }

  state[collectionName].push(record);
  const saveOutcome = persistPart(collectionName);
  if (!saveOutcome.ok) {
    state[collectionName].pop(); // roll back in-memory change if persistence failed
    return { ok: false, record: null, errors: [saveOutcome.error] };
  }

  emit('store:changed', { collection: collectionName, type: 'add', id: record.id });
  return { ok: true, record: deepClone(record), errors: [] };
}

/**
 * Merges `patch` into the existing record and re-validates the result.
 * Returns { ok, record, errors }
 */
export function updateRecord(collectionName, id, patch) {
  assertCollection(collectionName);
  const validate = getValidatorFor(collectionName);
  const index = state[collectionName].findIndex((r) => r.id === id);
  if (index === -1) {
    return { ok: false, record: null, errors: [`${collectionName} record ${id} not found`] };
  }

  const previous = state[collectionName][index];
  const updated = { ...previous, ...patch, id: previous.id }; // id is immutable
  const check = validate(updated);
  if (!check.valid) {
    return { ok: false, record: null, errors: check.errors };
  }

  state[collectionName][index] = updated;
  const saveOutcome = persistPart(collectionName);
  if (!saveOutcome.ok) {
    state[collectionName][index] = previous; // roll back
    return { ok: false, record: null, errors: [saveOutcome.error] };
  }

  emit('store:changed', { collection: collectionName, type: 'update', id });
  return { ok: true, record: deepClone(updated), errors: [] };
}

/** Returns { ok, errors } */
export function deleteRecord(collectionName, id) {
  assertCollection(collectionName);
  const index = state[collectionName].findIndex((r) => r.id === id);
  if (index === -1) {
    return { ok: false, errors: [`${collectionName} record ${id} not found`] };
  }

  const [removed] = state[collectionName].splice(index, 1);
  const saveOutcome = persistPart(collectionName);
  if (!saveOutcome.ok) {
    state[collectionName].splice(index, 0, removed); // roll back
    return { ok: false, errors: [saveOutcome.error] };
  }

  emit('store:changed', { collection: collectionName, type: 'delete', id });
  return { ok: true, errors: [] };
}

/** Replaces an entire collection wholesale (used by import). Returns { ok, errors } */
export function replaceCollection(collectionName, records) {
  assertCollection(collectionName);
  const validate = getValidatorFor(collectionName);
  const errors = [];
  records.forEach((r, i) => {
    const check = validate(r);
    if (!check.valid) check.errors.forEach((m) => errors.push(`${collectionName}[${i}]: ${m}`));
  });
  if (errors.length) return { ok: false, errors };

  const previous = state[collectionName];
  state[collectionName] = deepClone(records);
  const saveOutcome = persistPart(collectionName);
  if (!saveOutcome.ok) {
    state[collectionName] = previous;
    return { ok: false, errors: [saveOutcome.error] };
  }

  emit('store:changed', { collection: collectionName, type: 'replace' });
  return { ok: true, errors: [] };
}

export function updateSettings(patch) {
  const previous = state.settings;
  state.settings = { ...previous, ...patch };
  const saveOutcome = persistPart('settings');
  if (!saveOutcome.ok) {
    state.settings = previous;
    return { ok: false, errors: [saveOutcome.error] };
  }
  emit('store:changed', { collection: 'settings', type: 'update' });
  return { ok: true, errors: [] };
}

/** Wholesale replace of everything (used by "Replace" import mode). Writes every key at once. */
export function replaceAllData(newData) {
  const previous = state;
  state = deepClone(newData);
  state.meta.lastUpdated = nowISO();
  const saveOutcome = saveAllParts(state);
  if (!saveOutcome.ok) {
    state = previous;
    return { ok: false, errors: [saveOutcome.error] };
  }
  emit('store:changed', { collection: 'all', type: 'replace' });
  return { ok: true, errors: [] };
}

/** Clears everything: localStorage, in-memory state, and note bodies in IndexedDB. */
export async function clearAllData() {
  const storageOutcome = clearAllStorage();
  try {
    await clearAllNoteBodies();
  } catch {
    /* IndexedDB may be unavailable; localStorage clear is the important part */
  }
  state = createDefaultData();
  saveAllParts(state);
  emit('store:changed', { collection: 'all', type: 'clear' });
  return storageOutcome;
}
