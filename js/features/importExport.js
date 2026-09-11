import { getState, replaceAllData, addRecord } from '../core/store.js';
import { getTestsData, saveTestsData } from '../core/storage.js';
import { validateFullData, COLLECTION_NAMES } from '../core/schema.js';
import { runMigrations } from '../core/migrations.js';
import { safeJSONParse, uuid, todayDateString } from '../core/utils.js';
import { getAllNoteBodies, putNoteBody, getNoteBody } from '../core/idb.js';

/**
 * Builds the exportable JSON payload: full state plus each note's actual
 * body content inlined (so the backup is portable and self-contained,
 * not dependent on this device's IndexedDB).
 */
export async function buildExportPayload() {
  const state = getState();
  const bodies = await getAllNoteBodies().catch(() => []);
  const bodyMap = new Map(bodies.map((b) => [b.id, b.content]));

  return {
    ...state,
    tests: getTestsData(),
    notes: state.notes.map((note) => ({
      ...note,
      content: bodyMap.get(note.id) ?? '',
    })),
  };
}
/** Triggers a browser download of the current data as a JSON backup file. */
export async function exportData() {
  const payload = await buildExportPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const filename = `study-orbit-backup-${todayDateString()}.json`;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return { ok: true, filename, counts: countRecords(payload) };
}

function countRecords(data) {
  const counts = {};
  COLLECTION_NAMES.forEach((name) => {
    counts[name] = Array.isArray(data[name]) ? data[name].length : 0;
  });
  return counts;
}

/**
 * Parses and validates an uploaded backup file WITHOUT touching the store.
 * Use this to show an import preview before the user confirms merge/replace.
 * Returns { ok, data, counts, errors, migrated }
 */
export async function parseImportFile(file) {
  const text = await file.text();
  const parsed = safeJSONParse(text);
  if (!parsed.ok) {
    return { ok: false, data: null, counts: {}, errors: [`Invalid JSON: ${parsed.error}`], migrated: false };
  }

  const { data: migratedData, migrated } = runMigrations(parsed.value);
  const check = validateFullData(migratedData);

  return {
    ok: check.valid,
    data: check.valid ? migratedData : null,
    counts: countRecords(migratedData),
    errors: check.errors.map((e) => `${e.path}: ${e.message}`),
    migrated,
  };
}

/**
 * Applies a previously-validated import.
 * mode 'replace': wholesale overwrite of local data with the imported file.
 * mode 'merge': imported records are appended; any id collision gets a new id
 *   so nothing already on this device is silently overwritten.
 * Returns { ok, errors, importedCounts }
 */
 

export async function applyImport(importedData, mode = 'merge') {
  const errors = [];
  const importedCounts = {};

  // ------------------------------------------------------------
  // Validate mode
  // ------------------------------------------------------------
  if (mode !== 'merge' && mode !== 'replace') {
    return {
      ok: false,
      errors: [`Unknown import mode: ${mode}`],
      importedCounts: {},
    };
  }

  // ============================================================
  // REPLACE MODE
  // ============================================================
  if (mode === 'replace') {
    // ----------------------------------------------------------
    // Main app data
    // ----------------------------------------------------------
    // Move note bodies into IndexedDB, stripping inlined content
    // from the data that is stored in the main store.
    for (const note of importedData.notes) {
      await putNoteBody(note.id, note.content ?? '');
    }

    const stateShaped = {
      ...importedData,
      notes: importedData.notes.map(({ content, ...meta }) => meta),
    };

    // `tests` is intentionally NOT passed to replaceAllData()
    // because studyos:tests is managed separately.
    delete stateShaped.tests;

    const outcome = replaceAllData(stateShaped);

    if (!outcome.ok) {
      return {
        ok: false,
        errors: outcome.errors ?? [],
        importedCounts: {},
      };
    }

    // ----------------------------------------------------------
    // Tests
    // ----------------------------------------------------------
    // Replace means:
    // - tests exists in backup -> restore it
    // - tests missing from backup -> make it blank
    const tests = Array.isArray(importedData.tests)
      ? importedData.tests
      : [];

    const testsSave = saveTestsData(tests);

    if (!testsSave.ok) {
      return {
        ok: false,
        errors: [testsSave.error],
        importedCounts: countRecords(importedData),
      };
    }

    return {
      ok: true,
      errors: [],
      importedCounts: countRecords(importedData),
    };
  }

  // ============================================================
  // MERGE MODE
  // ============================================================

  const existing = getState();

  // ------------------------------------------------------------
  // Main collections
  // ------------------------------------------------------------
  for (const collectionName of [
    'subjects',
    'studySessions',
    'todos',
    'sleepRecords',
    'musicTracks',
  ]) {
    const existingIds = new Set(
      existing[collectionName].map((r) => r.id)
    );

    let added = 0;

    for (const record of importedData[collectionName]) {
      const remapped = existingIds.has(record.id)
        ? { ...record, id: uuid() }
        : record;

      const outcome = addRecord(collectionName, remapped);

      if (outcome.ok) {
        added += 1;

        // Prevent another record in the same import from receiving
        // the same original ID without being remapped.
        existingIds.add(remapped.id);
      } else {
        errors.push(...outcome.errors);
      }
    }

    importedCounts[collectionName] = added;
  }

  // ------------------------------------------------------------
  // Notes
  // ------------------------------------------------------------
  // Notes are special because their body lives in IndexedDB.
  const existingNoteIds = new Set(
    existing.notes.map((n) => n.id)
  );

  let notesAdded = 0;

  for (const note of importedData.notes) {
    const { content, ...meta } = note;

    const remapped = existingNoteIds.has(meta.id)
      ? { ...meta, id: uuid() }
      : meta;

    const outcome = addRecord('notes', remapped);

    if (outcome.ok) {
      await putNoteBody(remapped.id, content ?? '');

      existingNoteIds.add(remapped.id);
      notesAdded += 1;
    } else {
      errors.push(...outcome.errors);
    }
  }

  importedCounts.notes = notesAdded;

  // ------------------------------------------------------------
  // Tests
  // ------------------------------------------------------------
  // Merge means:
  // - tests exists in backup -> append them to existing tests
  // - tests missing from backup -> leave existing tests untouched
  //
  // Since tests are stored independently in localStorage, we read
  // them directly instead of putting them into the main store.
  if (Array.isArray(importedData.tests)) {
    const existingTests = getTestsData();

    // Make sure we have an array even if the other HTML file has
    // somehow stored an unexpected value.
    const safeExistingTests = Array.isArray(existingTests)
      ? existingTests
      : [];

    const existingTestIds = new Set(
      safeExistingTests
        .filter((test) => test && typeof test === 'object')
        .map((test) => test.id)
        .filter(Boolean)
    );

    const testsToAdd = [];

    for (const test of importedData.tests) {
      if (!test || typeof test !== 'object') {
        errors.push('Invalid test record in import.');
        continue;
      }

      let remapped = test;

      if (test.id && existingTestIds.has(test.id)) {
        remapped = {
          ...test,
          id: uuid(),
        };
      }

      if (remapped.id) {
        existingTestIds.add(remapped.id);
      }

      testsToAdd.push(remapped);
    }

    const mergedTests = [
      ...safeExistingTests,
      ...testsToAdd,
    ];

    const testsSave = saveTestsData(mergedTests);

    if (!testsSave.ok) {
      errors.push(testsSave.error);
      importedCounts.tests = 0;
    } else {
      importedCounts.tests = testsToAdd.length;
    }
  } else {
    // No tests property in backup.
    // In MERGE mode, existing tests remain untouched.
    importedCounts.tests = 0;
  }

  return {
    ok: errors.length === 0,
    errors,
    importedCounts,
  };
}

export { getNoteBody };
