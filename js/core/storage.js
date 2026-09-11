import { createDefaultData, validateFullData, COLLECTION_NAMES } from './schema.js';
import { runMigrations } from './migrations.js';
import { safeJSONParse } from './utils.js';

const PREFIX = 'studyos:';
const LEGACY_KEY = 'studyos:data'; // pre-refactor single-blob format
const LEGACY_BACKUP_KEY = 'studyos:data:backup';

// One localStorage key per section — notes, sessions, todos, etc. are all
// independent now. Editing a note no longer rewrites the sessions array,
// and a corrupted key only threatens that one section, not everything.
const PART_KEYS = {
  meta: `${PREFIX}meta`,
  settings: `${PREFIX}settings`,
  ...Object.fromEntries(COLLECTION_NAMES.map((name) => [name, `${PREFIX}${name}`])),
};
const PART_NAMES = Object.keys(PART_KEYS);

function backupKeyFor(key) {
  return `${key}:backup`;
}

/** Feature-tests localStorage (unavailable in some private-browsing modes). */
export function isStorageAvailable() {
  try {
    const testKey = '__studyos_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function writePartRaw(name, value) {
  const key = PART_KEYS[name];
  const serialized = JSON.stringify(value);
  const previous = localStorage.getItem(key);
  if (previous !== null) {
    try {
      localStorage.setItem(backupKeyFor(key), previous);
    } catch {
      // Backup rotation failing is not fatal to the primary write; continue.
    }
  }
  localStorage.setItem(key, serialized); // may throw QuotaExceededError — caller handles it
}

/** Reads one part, recovering from its own backup key on corruption. Never throws. */
function readPart(name, warnings) {
  const key = PART_KEYS[name];
  const raw = localStorage.getItem(key);
  if (raw === null) return { found: false };

  const parsed = safeJSONParse(raw);
  if (parsed.ok) return { found: true, value: parsed.value };

  warnings.push(`"${name}" was corrupted (${parsed.error}); attempting backup recovery.`);
  const backupRaw = localStorage.getItem(backupKeyFor(key));
  if (backupRaw !== null) {
    const backupParsed = safeJSONParse(backupRaw);
    if (backupParsed.ok) {
      warnings.push(`Restored "${name}" from its backup.`);
      localStorage.setItem(key, backupRaw);
      return { found: true, value: backupParsed.value, restoredFromBackup: true };
    }
    warnings.push(`Backup for "${name}" was also corrupted (${backupParsed.error}).`);
  }

  try {
    localStorage.setItem(`${key}:corrupted:${Date.now()}`, raw);
  } catch {
    /* best-effort only */
  }
  return { found: false, corrupted: true };
}

/**
 * One-time upgrade: if the old single-key blob ("studyos:data") is found,
 * split it into the new per-section keys and remove the legacy key. Safe to
 * call on every load — it's a no-op once the legacy key is gone.
 */
function migrateLegacyBlobIfPresent(warnings) {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (raw === null) return;

  const parsed = safeJSONParse(raw);
  let legacyData = parsed.ok ? parsed.value : null;

  if (!legacyData) {
    const backupRaw = localStorage.getItem(LEGACY_BACKUP_KEY);
    const backupParsed = backupRaw !== null ? safeJSONParse(backupRaw) : null;
    if (backupParsed?.ok) {
      legacyData = backupParsed.value;
      warnings.push('Recovered pre-update data from its backup while upgrading the storage format.');
    }
  }

  if (!legacyData) {
    warnings.push('Old combined data format was corrupted with no usable backup; it was archived, not migrated.');
    try {
      localStorage.setItem(`${LEGACY_KEY}:corrupted:${Date.now()}`, raw);
    } catch {
      /* best-effort */
    }
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_BACKUP_KEY);
    return;
  }

  const { data: migratedData } = runMigrations(legacyData);
  const check = validateFullData(migratedData);
  if (!check.valid) {
    warnings.push('Old combined data format failed validation while upgrading; it was archived, not migrated.');
    try {
      localStorage.setItem(`${LEGACY_KEY}:corrupted:${Date.now()}`, raw);
    } catch {
      /* best-effort */
    }
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_BACKUP_KEY);
    return;
  }

  PART_NAMES.forEach((name) => writePartRaw(name, migratedData[name]));
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(LEGACY_BACKUP_KEY);
  warnings.push('Upgraded storage format: each section (subjects, sessions, notes, etc.) now lives under its own key.');
}

/**
 * Loads data from localStorage, recovering from corruption or an outdated
 * schema. Never throws — always returns something usable.
 * Returns { data, isNew, restoredFromBackup, migrated, warnings }
 */
export function loadData() {
  const warnings = [];

  if (!isStorageAvailable()) {
    warnings.push('localStorage is unavailable; using in-memory data only for this session.');
    return { data: createDefaultData(), isNew: true, restoredFromBackup: false, migrated: false, warnings };
  }

  migrateLegacyBlobIfPresent(warnings);

  const anyPartExists = PART_NAMES.some((name) => localStorage.getItem(PART_KEYS[name]) !== null);
  if (!anyPartExists) {
    return { data: createDefaultData(), isNew: true, restoredFromBackup: false, migrated: false, warnings };
  }

  const defaults = createDefaultData();
  const assembled = {};
  let restoredFromBackup = false;

  PART_NAMES.forEach((name) => {
    const result = readPart(name, warnings);
    if (result.restoredFromBackup) restoredFromBackup = true;
    assembled[name] = result.found ? result.value : defaults[name];
  });

  const { data: migratedData, migrated } = runMigrations(assembled);
  const check = validateFullData(migratedData);
  if (!check.valid) {
    warnings.push(`Loaded data failed validation after migration (${check.errors.length} issue(s)); starting fresh instead.`);
    check.errors.slice(0, 5).forEach((e) => warnings.push(`  - ${e.path}: ${e.message}`));
    return { data: createDefaultData(), isNew: true, restoredFromBackup, migrated, warnings };
  }

  // If schema migrations changed anything, persist the upgraded shape right away.
  if (migrated) {
    PART_NAMES.forEach((name) => {
      try {
        writePartRaw(name, migratedData[name]);
      } catch {
        /* best-effort — the in-memory data is still correct either way */
      }
    });
  }

  return { data: migratedData, isNew: false, restoredFromBackup, migrated, warnings };
}

const TESTS_KEY = 'studyos:tests';

export function getTestsData() {
  const raw = localStorage.getItem(TESTS_KEY);

  if (raw === null) return [];

  const parsed = safeJSONParse(raw);
  return parsed.ok ? parsed.value : [];
}

export function saveTestsData(value) {
  try {
    localStorage.setItem(TESTS_KEY, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error?.name === 'QuotaExceededError'
        ? 'quota_exceeded'
        : 'write_failed',
    };
  }
}

/**
 * Saves ONE section to its own key — the normal write path. Adding a todo
 * only rewrites the todos key; the notes/sessions/settings keys are
 * untouched. `meta` is saved alongside on every mutation since its
 * lastUpdated timestamp changes every time.
 * Returns { ok, error }
 *
 * Note: localStorage has no cross-key transactions, so writing several
 * parts back-to-back (see saveAllParts) is not atomic across keys — a
 * failure partway through can leave some keys updated and others not.
 * Per-key backups bound the damage to whichever key failed; store.js's
 * in-memory rollback on a failed save keeps memory and disk from drifting
 * apart for that one section.
 */
export function savePart(name, value) {
  if (!PART_KEYS[name]) return { ok: false, error: 'unknown_part' };
  if (!isStorageAvailable()) return { ok: false, error: 'storage_unavailable' };

  try {
    writePartRaw(name, value);
    return { ok: true, error: null };
  } catch (error) {
    const isQuota = error?.name === 'QuotaExceededError' || error?.code === 22;
    return { ok: false, error: isQuota ? 'quota_exceeded' : 'write_failed', details: error.message };
  }
}

/** Saves every section at once — used for full-data replace (import) and clearing. */
export function saveAllParts(data) {
  if (!isStorageAvailable()) return { ok: false, error: 'storage_unavailable' };
  const check = validateFullData(data);
  if (!check.valid) return { ok: false, error: 'validation_failed', details: check.errors };

  try {
    PART_NAMES.forEach((name) => writePartRaw(name, data[name]));
    return { ok: true, error: null };
  } catch (error) {
    const isQuota = error?.name === 'QuotaExceededError' || error?.code === 22;
    return { ok: false, error: isQuota ? 'quota_exceeded' : 'write_failed', details: error.message };
  }
}

/** Removes every Study Orbit key (all sections + their backups) from localStorage. Used by "Clear all data". */
export function clearAllStorage() {
  if (!isStorageAvailable()) return { ok: false, error: 'storage_unavailable' };
  Object.keys(localStorage)
    .filter((key) => key.startsWith(PREFIX))
    .forEach((key) => localStorage.removeItem(key));
  return { ok: true };
}

export { PART_KEYS, PART_NAMES };
