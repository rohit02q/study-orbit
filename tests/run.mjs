import { LocalStorageMock } from './localStorageMock.js';
import { installFakeIndexedDB } from './fakeIndexedDB.js';
import { describe, test, run, assert, assertEqual, summary } from './harness.js';

// ---- Install browser-API polyfills before importing any app module ----
LocalStorageMock.installGlobal(new LocalStorageMock());
installFakeIndexedDB();

const utils = await import('../js/core/utils.js');
const schema = await import('../js/core/schema.js');
const migrations = await import('../js/core/migrations.js');
const storage = await import('../js/core/storage.js');

console.log('\n▶ utils.js\n');
describe('utils', () => {
  test('uuid() produces distinct values', () => {
    const a = utils.uuid();
    const b = utils.uuid();
    assert(a !== b, 'two calls returned the same id');
    assert(/^[0-9a-f-]{36}$/i.test(a), `id "${a}" does not look like a UUID`);
  });

  test('todayDateString() formats as YYYY-MM-DD', () => {
    const d = new Date(2026, 8, 1); // Sept 1 2026, local
    assertEqual(utils.todayDateString(d), '2026-09-01');
  });

  test('safeJSONParse handles valid and invalid input', () => {
    const good = utils.safeJSONParse('{"a":1}');
    assert(good.ok && good.value.a === 1);
    const bad = utils.safeJSONParse('{not json');
    assert(!bad.ok && bad.error);
  });

  test('deepClone produces an independent copy', () => {
    const original = { a: { b: 1 } };
    const clone = utils.deepClone(original);
    clone.a.b = 2;
    assertEqual(original.a.b, 1);
  });
});

console.log('\n▶ schema.js\n');
describe('schema', () => {
  test('createDefaultData produces a structurally valid document', () => {
    const data = schema.createDefaultData();
    const check = schema.validateFullData(data);
    assert(check.valid, `default data failed validation: ${JSON.stringify(check.errors)}`);
  });

  test('validateSubject rejects missing fields', () => {
    const check = schema.validateSubject({ id: 'x' });
    assert(!check.valid);
    assert(check.errors.some((e) => e.includes('name')));
  });

  test('validateStudySession enforces enum values', () => {
    const base = {
      id: 's1', subjectId: 'sub1', studyType: 'NotARealType',
      startTime: new Date().toISOString(), endTime: null,
      pausedIntervals: [], duration: 0, date: '2026-09-01', status: 'running',
    };
    const check = schema.validateStudySession(base);
    assert(!check.valid);
    assert(check.errors.some((e) => e.includes('studyType')));
  });

  test('validateStudySession accepts a well-formed running session', () => {
    const session = {
      id: 's1', subjectId: 'sub1', studyType: 'Practice',
      startTime: new Date().toISOString(), endTime: null,
      pausedIntervals: [], duration: 0, date: '2026-09-01', status: 'running',
    };
    assert(schema.validateStudySession(session).valid);
  });

  test('validateFullData catches a session pointing at a nonexistent subject', () => {
    const data = schema.createDefaultData();
    data.studySessions.push({
      id: 's1', subjectId: 'ghost-subject', studyType: 'Practice',
      startTime: new Date().toISOString(), endTime: null,
      pausedIntervals: [], duration: 0, date: '2026-09-01', status: 'running',
    });
    const check = schema.validateFullData(data);
    assert(!check.valid);
    assert(check.errors.some((e) => e.message.includes('does not exist')));
  });

  test('validateSleepRecord rejects a non-positive duration', () => {
    const check = schema.validateSleepRecord({
      id: 'r1', date: '2026-09-01',
      sleepTime: new Date().toISOString(), wakeTime: new Date().toISOString(),
      durationMinutes: 0,
    });
    assert(!check.valid);
  });
});

console.log('\n▶ migrations.js\n');
describe('migrations', () => {
  test('legacy data with no meta.version is treated as version 0 and upgraded', () => {
    const legacy = {
      subjects: [{ id: 'sub1', name: 'Physics', color: '#fff', createdAt: new Date().toISOString() }],
      studySessions: [{
        id: 's1', subjectId: 'sub1', studyType: 'Theory',
        startTime: new Date().toISOString(), endTime: new Date().toISOString(),
        date: '2026-09-01',
      }],
      todos: [{ id: 't1', title: 'Read ch.3', priority: 'High', category: 'Study', completed: true, createdAt: new Date().toISOString() }],
      notes: [{ id: 'n1', title: 'Notes', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    };

    const { data, migrated, fromVersion, toVersion } = migrations.runMigrations(legacy);
    assert(migrated, 'expected migration to run');
    assertEqual(fromVersion, 0);
    assertEqual(toVersion, schema.CURRENT_SCHEMA_VERSION);

    const check = schema.validateFullData(data);
    assert(check.valid, `migrated data still invalid: ${JSON.stringify(check.errors)}`);
    assertEqual(data.studySessions[0].status, 'completed', 'session with endTime should migrate to completed');
    assertEqual(data.subjects[0].archived, false);
  });

  test('data already at current version passes through unchanged', () => {
    const current = schema.createDefaultData();
    const { migrated, toVersion } = migrations.runMigrations(current);
    assert(!migrated);
    assertEqual(toVersion, schema.CURRENT_SCHEMA_VERSION);
  });
});

console.log('\n▶ storage.js — per-section keys, corruption recovery, backups, legacy migration\n');
describe('storage', () => {
  test('loadData returns fresh defaults when nothing is stored', () => {
    globalThis.localStorage.clear();
    const { data, isNew } = storage.loadData();
    assert(isNew);
    assert(schema.validateFullData(data).valid);
  });

  test('each section is written under its own distinct localStorage key, not one combined blob', () => {
    globalThis.localStorage.clear();
    const data = schema.createDefaultData();
    data.subjects.push({ id: 'sub1', name: 'Chemistry', color: '#abc', archived: false, createdAt: new Date().toISOString() });
    const saveOutcome = storage.saveAllParts(data);
    assert(saveOutcome.ok, JSON.stringify(saveOutcome));

    assert(globalThis.localStorage.getItem('studyos:subjects') !== null, 'subjects should have their own key');
    assert(globalThis.localStorage.getItem('studyos:studySessions') !== null, 'sessions should have their own key');
    assert(globalThis.localStorage.getItem('studyos:notes') !== null, 'notes should have their own key');
    assert(globalThis.localStorage.getItem('studyos:sleepRecords') !== null, 'sleep records should have their own key');
    assert(globalThis.localStorage.getItem('studyos:settings') !== null, 'settings should have their own key');
    assert(globalThis.localStorage.getItem('studyos:data') === null, 'the old combined key should not be used');

    const subjectsOnly = JSON.parse(globalThis.localStorage.getItem('studyos:subjects'));
    assertEqual(subjectsOnly[0].name, 'Chemistry', 'the subjects key should contain only subjects, not the whole dataset');
  });

  test('savePart on one section leaves every other section\u2019s key untouched', () => {
    globalThis.localStorage.clear();
    const data = schema.createDefaultData();
    storage.saveAllParts(data);
    const notesKeyBefore = globalThis.localStorage.getItem('studyos:notes');

    storage.savePart('subjects', [{ id: 'sub1', name: 'Physics', color: '#fff', archived: false, createdAt: new Date().toISOString() }]);

    assertEqual(globalThis.localStorage.getItem('studyos:notes'), notesKeyBefore, 'writing subjects must not touch the notes key');
  });

  test('saveAllParts then loadData round-trips correctly', () => {
    globalThis.localStorage.clear();
    const data = schema.createDefaultData();
    data.subjects.push({ id: 'sub1', name: 'Biology', color: '#abc', archived: false, createdAt: new Date().toISOString() });
    storage.saveAllParts(data);

    const { data: reloaded, isNew } = storage.loadData();
    assert(!isNew);
    assertEqual(reloaded.subjects[0].name, 'Biology');
  });

  test('saveAllParts rejects structurally invalid data without touching any key', () => {
    globalThis.localStorage.clear();
    const good = schema.createDefaultData();
    storage.saveAllParts(good);
    const before = globalThis.localStorage.getItem('studyos:subjects');

    const bad = schema.createDefaultData();
    bad.subjects.push({ id: 'sub1' }); // missing required fields
    const outcome = storage.saveAllParts(bad);
    assert(!outcome.ok);
    assertEqual(outcome.error, 'validation_failed');

    const after = globalThis.localStorage.getItem('studyos:subjects');
    assertEqual(before, after, 'invalid save must not overwrite existing good data');
  });

  test('corruption in ONE section falls back to that section\u2019s backup without affecting other sections', () => {
    globalThis.localStorage.clear();
    const data = schema.createDefaultData();
    data.subjects.push({ id: 'sub1', name: 'Physics v1', color: '#111', archived: false, createdAt: new Date().toISOString() });
    storage.saveAllParts(data);
    // Save subjects again so its backup key holds "Physics v1" and its primary key holds "Physics v2".
    storage.savePart('subjects', [{ id: 'sub1', name: 'Physics v2', color: '#222', archived: false, createdAt: new Date().toISOString() }]);

    // Corrupt only the subjects key — notes/sessions/etc. are untouched.
    globalThis.localStorage.setItem('studyos:subjects', '{not valid json');

    const { data: reloaded, restoredFromBackup, warnings } = storage.loadData();
    assert(restoredFromBackup, 'expected recovery from the subjects backup');
    assertEqual(reloaded.subjects[0].name, 'Physics v1', 'should recover the backup, not the corrupted latest write');
    assert(warnings.some((w) => w.includes('subjects')));
  });

  test('corruption in one section does not force a fallback of unrelated sections', () => {
    globalThis.localStorage.clear();
    const data = schema.createDefaultData();
    data.subjects.push({ id: 'sub1', name: 'Physics', color: '#111', archived: false, createdAt: new Date().toISOString() });
    storage.saveAllParts(data);
    // Corrupt subjects with no backup available (first-ever write, so no backup key exists yet).
    globalThis.localStorage.setItem('studyos:subjects', 'not json at all');

    const { data: reloaded } = storage.loadData();
    assertEqual(reloaded.subjects.length, 0, 'subjects falls back to empty/default');
    assertEqual(reloaded.settings.dailyGoalMinutes, data.settings.dailyGoalMinutes, 'settings should be unaffected by the subjects corruption');
  });

  test('quota exceeded writing one section leaves other sections and its own previous value intact', () => {
    globalThis.localStorage.clear();
    const smallQuota = new LocalStorageMock(2000);
    LocalStorageMock.installGlobal(smallQuota);

    const data = schema.createDefaultData();
    const firstOutcome = storage.saveAllParts(data);
    assert(firstOutcome.ok, 'initial small write should succeed');

    const bloatedSubjects = [];
    for (let i = 0; i < 50; i += 1) {
      bloatedSubjects.push({ id: `sub-${i}`, name: `Subject ${i}`, color: '#123456', archived: false, createdAt: new Date().toISOString() });
    }
    const secondOutcome = storage.savePart('subjects', bloatedSubjects);
    assert(!secondOutcome.ok);
    assertEqual(secondOutcome.error, 'quota_exceeded');

    const { data: reloaded } = storage.loadData();
    assertEqual(reloaded.subjects.length, 0, 'the subjects key must still hold its previous (empty) value after the failed write');

    LocalStorageMock.installGlobal(new LocalStorageMock());
  });

  test('a pre-refactor single-blob dataset is migrated into per-section keys on load', () => {
    globalThis.localStorage.clear();
    const legacyBlob = schema.createDefaultData();
    legacyBlob.subjects.push({ id: 'sub1', name: 'Legacy Subject', color: '#fff', archived: false, createdAt: new Date().toISOString() });
    legacyBlob.settings.dailyGoalMinutes = 180;
    globalThis.localStorage.setItem('studyos:data', JSON.stringify(legacyBlob));

    const { data, warnings } = storage.loadData();
    assertEqual(data.subjects[0].name, 'Legacy Subject');
    assertEqual(data.settings.dailyGoalMinutes, 180);
    assert(globalThis.localStorage.getItem('studyos:subjects') !== null, 'subjects should now have their own key');
    assert(globalThis.localStorage.getItem('studyos:data') === null, 'the legacy combined key should be removed after migration');
    assert(warnings.some((w) => w.toLowerCase().includes('upgraded storage format')));
  });
});

console.log('\n▶ store.js — CRUD, validation-on-write, rollback\n');
describe('store', () => {
  let store;

  test('module loads and initStore seeds a fresh store', async () => {
    globalThis.localStorage.clear();
    store = await import('../js/core/store.js');
    const outcome = store.initStore();
    assert(outcome.isNew);
  });

  test('addRecord creates a valid subject and persists it', () => {
    const outcome = store.addRecord('subjects', { name: 'Math', color: '#F0A857', archived: false });
    assert(outcome.ok, JSON.stringify(outcome.errors));
    assert(outcome.record.id);
    assertEqual(store.listRecords('subjects').length, 1);
  });

  test('addRecord rejects an invalid record and does not persist it', () => {
    const before = store.listRecords('subjects').length;
    const outcome = store.addRecord('subjects', { color: '#fff', archived: false }); // missing name
    assert(!outcome.ok);
    assertEqual(store.listRecords('subjects').length, before);
  });

  test('updateRecord merges a patch and re-validates', () => {
    const subject = store.addRecord('subjects', { name: 'History', color: '#63D2C4', archived: false }).record;
    const outcome = store.updateRecord('subjects', subject.id, { name: 'World History' });
    assert(outcome.ok);
    assertEqual(store.getRecord('subjects', subject.id).name, 'World History');
  });

  test('updateRecord rejects a patch that would make the record invalid', () => {
    const subject = store.addRecord('subjects', { name: 'Art', color: '#fff', archived: false }).record;
    const outcome = store.updateRecord('subjects', subject.id, { name: '' });
    assert(!outcome.ok);
    assertEqual(store.getRecord('subjects', subject.id).name, 'Art', 'record must be unchanged after a rejected update');
  });

  test('deleteRecord removes the record', () => {
    const subject = store.addRecord('subjects', { name: 'Temp', color: '#fff', archived: false }).record;
    const outcome = store.deleteRecord('subjects', subject.id);
    assert(outcome.ok);
    assertEqual(store.getRecord('subjects', subject.id), null);
  });

  test('deleteRecord on a missing id fails cleanly', () => {
    const outcome = store.deleteRecord('subjects', 'does-not-exist');
    assert(!outcome.ok);
  });

  test('a full study session can be added end-to-end', () => {
    const subject = store.addRecord('subjects', { name: 'Physics', color: '#F0A857', archived: false }).record;
    const outcome = store.addRecord('studySessions', {
      subjectId: subject.id,
      studyType: 'Practice',
      startTime: new Date().toISOString(),
      endTime: null,
      pausedIntervals: [],
      duration: 0,
      date: utils.todayDateString(),
      status: 'running',
    });
    assert(outcome.ok, JSON.stringify(outcome.errors));
  });

  test('getState returns a clone, not a live reference', () => {
    const state = store.getState();
    state.subjects.push({ id: 'hacked' });
    const stateAgain = store.getState();
    assert(!stateAgain.subjects.some((s) => s.id === 'hacked'), 'mutating getState() output leaked into the store');
  });
});

console.log('\n▶ features/importExport.js — export payload & import validation\n');
describe('importExport', () => {
  let importExport;

  test('module loads', async () => {
    importExport = await import('../js/features/importExport.js');
  });

  test('buildExportPayload includes every collection and settings', async () => {
    const payload = await importExport.buildExportPayload();
    assert(Array.isArray(payload.subjects));
    assert(Array.isArray(payload.studySessions));
    assert(Array.isArray(payload.notes));
    assert(payload.settings);
    assert(payload.meta);
  });

  test('parseImportFile accepts a valid backup file', async () => {
    const goodData = schema.createDefaultData();
    goodData.subjects.push({ id: 'sub-import', name: 'Imported Subject', color: '#fff', archived: false, createdAt: new Date().toISOString() });
    const fakeFile = { text: async () => JSON.stringify(goodData) };
    const result = await importExport.parseImportFile(fakeFile);
    assert(result.ok, JSON.stringify(result.errors));
    assertEqual(result.counts.subjects, 1);
  });

  test('parseImportFile rejects malformed JSON', async () => {
    const fakeFile = { text: async () => '{ this is not json' };
    const result = await importExport.parseImportFile(fakeFile);
    assert(!result.ok);
    assert(result.errors[0].includes('Invalid JSON'));
  });

  test('parseImportFile migrates a legacy (unversioned) file and reports it', async () => {
    const legacy = {
      subjects: [{ id: 'sub1', name: 'Physics', color: '#fff', createdAt: new Date().toISOString() }],
      studySessions: [],
      todos: [],
      notes: [],
      sleepRecords: [],
    };
    const fakeFile = { text: async () => JSON.stringify(legacy) };
    const result = await importExport.parseImportFile(fakeFile);
    assert(result.ok, JSON.stringify(result.errors));
    assert(result.migrated);
  });

  test('applyImport in merge mode remaps colliding ids instead of overwriting', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    const existingSubject = store.addRecord('subjects', { name: 'Existing', color: '#fff', archived: false }).record;

    const incoming = schema.createDefaultData();
    incoming.subjects.push({ ...existingSubject, name: 'Colliding Import' }); // same id, different name
    incoming.subjects.push({ id: 'sub-new', name: 'Brand New', color: '#000', archived: false, createdAt: new Date().toISOString() });

    const result = await importExport.applyImport(incoming, 'merge');
    assert(result.ok, JSON.stringify(result.errors));

    const allSubjects = store.listRecords('subjects');
    assertEqual(allSubjects.length, 3, 'expected original + 2 imported (one remapped) = 3');
    assert(allSubjects.some((s) => s.id === existingSubject.id && s.name === 'Existing'), 'original record must be untouched');
    assert(allSubjects.some((s) => s.name === 'Colliding Import' && s.id !== existingSubject.id), 'colliding import must get a new id');
  });

  test('applyImport in replace mode wholesale-overwrites local data', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    store.addRecord('subjects', { name: 'Will be replaced', color: '#fff', archived: false });

    const replacement = schema.createDefaultData();
    replacement.subjects.push({ id: 'only-one', name: 'Only Subject', color: '#000', archived: false, createdAt: new Date().toISOString() });
    replacement.notes.push({ id: 'note1', title: 'A note', pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), wordCount: 2, content: 'hello world' });

    const result = await importExport.applyImport(replacement, 'replace');
    assert(result.ok, JSON.stringify(result.errors));

    const allSubjects = store.listRecords('subjects');
    assertEqual(allSubjects.length, 1);
    assertEqual(allSubjects[0].name, 'Only Subject');
  });
});

console.log('\n▶ features/subjects.js — CRUD, duplicate names, stats, delete guard\n');
describe('subjects', () => {
  let subjectsFeature;
  let store;

  test('module loads with a clean store', async () => {
    globalThis.localStorage.clear();
    store = await import('../js/core/store.js');
    store.initStore();
    subjectsFeature = await import('../js/features/subjects.js');
  });

  test('createSubject trims name and applies a default color', () => {
    const outcome = subjectsFeature.createSubject({ name: '  Physics  ' });
    assert(outcome.ok, JSON.stringify(outcome.errors));
    assertEqual(outcome.record.name, 'Physics');
    assert(subjectsFeature.SUBJECT_COLOR_PALETTE.includes(outcome.record.color));
  });

  test('createSubject rejects an empty name', () => {
    const outcome = subjectsFeature.createSubject({ name: '   ' });
    assert(!outcome.ok);
  });

  test('createSubject rejects a case-insensitive duplicate of an active subject', () => {
    subjectsFeature.createSubject({ name: 'Chemistry' });
    const outcome = subjectsFeature.createSubject({ name: 'chemistry' });
    assert(!outcome.ok);
    assert(outcome.errors[0].includes('already exists'));
  });

  test('archiving a subject removes it from the default (active) listing', () => {
    const created = subjectsFeature.createSubject({ name: 'Temporary Subject' }).record;
    subjectsFeature.archiveSubject(created.id, true);
    const active = subjectsFeature.listSubjects();
    const all = subjectsFeature.listSubjects({ includeArchived: true });
    assert(!active.some((s) => s.id === created.id), 'archived subject should not appear in active list');
    assert(all.some((s) => s.id === created.id), 'archived subject should still appear when includeArchived is true');
  });

  test('archiving frees up the name for a new subject (only active names collide)', () => {
    const outcome = subjectsFeature.createSubject({ name: 'Temporary Subject' });
    assert(outcome.ok, 'archived subjects should not block reuse of their name');
  });

  test('getSubjectStats on a subject with zero sessions returns all zeros', () => {
    const subject = subjectsFeature.createSubject({ name: 'Untouched Subject' }).record;
    const stats = subjectsFeature.getSubjectStats(subject.id);
    assertEqual(stats, {
      totalSeconds: 0, todaySeconds: 0, weekSeconds: 0, monthSeconds: 0,
      sessionCount: 0, avgDurationSeconds: 0,
    });
  });

  test('getSubjectStats correctly sums real completed sessions and ignores incomplete ones', () => {
    const subject = subjectsFeature.createSubject({ name: 'Biology' }).record;
    const today = utils.todayDateString();

    store.addRecord('studySessions', {
      subjectId: subject.id, studyType: 'Practice',
      startTime: new Date().toISOString(), endTime: new Date().toISOString(),
      pausedIntervals: [], duration: 1800, date: today, status: 'completed',
    });
    store.addRecord('studySessions', {
      subjectId: subject.id, studyType: 'Theory',
      startTime: new Date().toISOString(), endTime: new Date().toISOString(),
      pausedIntervals: [], duration: 3600, date: today, status: 'completed',
    });
    // A still-running session must not count toward totals yet.
    store.addRecord('studySessions', {
      subjectId: subject.id, studyType: 'Revision',
      startTime: new Date().toISOString(), endTime: null,
      pausedIntervals: [], duration: 0, date: today, status: 'running',
    });

    const stats = subjectsFeature.getSubjectStats(subject.id);
    assertEqual(stats.sessionCount, 2);
    assertEqual(stats.totalSeconds, 5400);
    assertEqual(stats.todaySeconds, 5400);
    assertEqual(stats.avgDurationSeconds, 2700);
  });

  test('deleteSubject refuses to delete a subject with sessions on record', () => {
    const subject = subjectsFeature.createSubject({ name: 'Has Sessions' }).record;
    store.addRecord('studySessions', {
      subjectId: subject.id, studyType: 'Practice',
      startTime: new Date().toISOString(), endTime: new Date().toISOString(),
      pausedIntervals: [], duration: 600, date: utils.todayDateString(), status: 'completed',
    });
    const outcome = subjectsFeature.deleteSubject(subject.id);
    assert(!outcome.ok);
    assert(subjectsFeature.getSubject(subject.id) !== null, 'subject must still exist after refused delete');
  });

  test('deleteSubject succeeds for a subject with no sessions', () => {
    const subject = subjectsFeature.createSubject({ name: 'No Sessions' }).record;
    const outcome = subjectsFeature.deleteSubject(subject.id);
    assert(outcome.ok);
    assertEqual(subjectsFeature.getSubject(subject.id), null);
  });
});

console.log('\n▶ features/timer.js — timestamp-based elapsed time, pause/resume, recovery\n');
describe('timer', () => {
  let timerFeature;
  let store;
  let subjectId;

  test('module loads with a clean store and one subject', async () => {
    globalThis.localStorage.clear();
    store = await import('../js/core/store.js');
    store.initStore();
    const subjectsFeature = await import('../js/features/subjects.js');
    timerFeature = await import('../js/features/timer.js');
    subjectId = subjectsFeature.createSubject({ name: 'Math' }).record.id;
  });

  test('startSession creates a running session with zero paused time', () => {
    const outcome = timerFeature.startSession({ subjectId, studyType: 'Practice' });
    assert(outcome.ok, JSON.stringify(outcome.errors));
    assertEqual(outcome.record.status, 'running');
    assertEqual(outcome.record.pausedIntervals.length, 0);
  });

  test('startSession refuses a second session while one is active', () => {
    const outcome = timerFeature.startSession({ subjectId, studyType: 'Theory' });
    assert(!outcome.ok);
    assert(outcome.errors[0].includes('already in progress'));
  });

  test('computeElapsedSeconds matches real wall-clock time for a running session', () => {
    const active = timerFeature.getActiveSession();
    const startMs = new Date(active.startTime).getTime();
    const laterISO = new Date(startMs + 45_000).toISOString(); // 45s later
    assertEqual(timerFeature.computeElapsedSeconds(active, laterISO), 45);
  });

  test('pausing freezes elapsed time — time passing while paused does not count', () => {
    const active = timerFeature.getActiveSession();
    const startMs = new Date(active.startTime).getTime();

    // Simulate: run 10s, pause, "wait" 100s in real time, still paused.
    const pauseAtISO = new Date(startMs + 10_000).toISOString();
    const fakeNow = () => pauseAtISO;
    // pauseSession uses nowISO() internally (real clock) — instead we verify
    // the pure math directly using a hand-built paused-session fixture,
    // since the module's nowISO() can't be time-traveled from outside.
    const fixture = {
      startTime: active.startTime,
      pausedIntervals: [{ start: pauseAtISO }], // still open (currently paused)
    };
    const checkAtISO = new Date(startMs + 110_000).toISOString(); // 100s after pausing
    assertEqual(timerFeature.computeElapsedSeconds(fixture, checkAtISO), 10, 'elapsed should freeze at 10s while paused');
  });

  test('pauseSession persists status and an open interval; resumeSession closes it', () => {
    const active = timerFeature.getActiveSession();
    const pauseOutcome = timerFeature.pauseSession(active.id);
    assert(pauseOutcome.ok);
    assertEqual(pauseOutcome.record.status, 'paused');
    assertEqual(pauseOutcome.record.pausedIntervals.length, 1);
    assert(!pauseOutcome.record.pausedIntervals[0].end, 'interval should still be open while paused');

    const resumeOutcome = timerFeature.resumeSession(active.id);
    assert(resumeOutcome.ok);
    assertEqual(resumeOutcome.record.status, 'running');
    assert(resumeOutcome.record.pausedIntervals[0].end, 'interval should be closed after resuming');
  });

  test('pauseSession refuses to pause an already-paused session', () => {
    const active = timerFeature.getActiveSession();
    timerFeature.pauseSession(active.id);
    const secondPause = timerFeature.pauseSession(active.id);
    assert(!secondPause.ok);
  });

  test('stopSession while paused closes the open interval and excludes paused time from duration', () => {
    // Fresh session for a clean fixture-based check.
    timerFeature.discardActiveSession(timerFeature.getActiveSession().id);
    const started = timerFeature.startSession({ subjectId, studyType: 'Revision' }).record;
    timerFeature.pauseSession(started.id);

    const stopped = timerFeature.stopSession(started.id);
    assert(stopped.ok);
    assertEqual(stopped.record.status, 'completed');
    assert(stopped.record.pausedIntervals.every((i) => i.end), 'no interval should be left open after stop');
    assertEqual(stopped.record.endTime !== null, true);
  });

  test('stopSession refuses when there is no active session', () => {
    const outcome = timerFeature.stopSession('nonexistent-id');
    assert(!outcome.ok);
  });

  test('discardActiveSession removes the record entirely (nothing saved)', () => {
    const started = timerFeature.startSession({ subjectId, studyType: 'Test' }).record;
    const outcome = timerFeature.discardActiveSession(started.id);
    assert(outcome.ok);
    assertEqual(timerFeature.getActiveSession(), null);
    assertEqual(store.getRecord('studySessions', started.id), null);
  });

  test('buildSessionInsight reports a first-session message for a subject\u2019s very first completed session', async () => {
    const subjectsFeature2Id = (await import('../js/features/subjects.js')).createSubject({ name: 'Brand New Subject' }).record.id;
    const started = timerFeature.startSession({ subjectId: subjectsFeature2Id, studyType: 'Theory' }).record;
    const stopped = timerFeature.stopSession(started.id).record;
    const insight = timerFeature.buildSessionInsight(stopped);
    assert(insight.toLowerCase().includes('first'), `expected a first-session message, got: "${insight}"`);
  });

  test('a session recovered "after reload" (only startTime known) computes correctly from timestamps alone', () => {
    // Simulates the refresh-recovery guarantee: a session object loaded
    // fresh from storage (no in-memory tick state) still yields correct
    // elapsed time purely from startTime + pausedIntervals.
    const rehydratedSession = {
      startTime: new Date(Date.now() - 90_000).toISOString(), // "started" 90s ago
      pausedIntervals: [],
    };
    const elapsed = timerFeature.computeElapsedSeconds(rehydratedSession);
    assert(elapsed >= 89 && elapsed <= 91, `expected ~90s, got ${elapsed}s`);
  });
});

console.log('\n▶ analytics/stats.js — streaks, dashboard snapshot arithmetic\n');
describe('stats', () => {
  let stats;
  let store;
  let subjectsFeature;
  const FIXED_NOW = new Date('2026-09-10T12:00:00');

  function addCompletedSession({ subjectId, studyType = 'Practice', date, duration }) {
    return store.addRecord('studySessions', {
      subjectId, studyType,
      startTime: `${date}T09:00:00.000Z`, endTime: `${date}T10:00:00.000Z`,
      pausedIntervals: [], duration, date, status: 'completed',
    });
  }

  test('module loads with a clean store', async () => {
    globalThis.localStorage.clear();
    store = await import('../js/core/store.js');
    store.initStore();
    subjectsFeature = await import('../js/features/subjects.js');
    stats = await import('../js/analytics/stats.js');
  });

  test('computeStreaks returns zeros with no sessions', () => {
    assertEqual(stats.computeStreaks([], FIXED_NOW), { current: 0, longest: 0 });
  });

  test('computeStreaks counts a run of consecutive days ending today', () => {
    const sessions = [
      { date: utils.dateStringDaysAgo(2, FIXED_NOW) },
      { date: utils.dateStringDaysAgo(1, FIXED_NOW) },
      { date: utils.dateStringDaysAgo(0, FIXED_NOW) },
    ];
    assertEqual(stats.computeStreaks(sessions, FIXED_NOW), { current: 3, longest: 3 });
  });

  test('computeStreaks still counts yesterday\u2019s streak even if today has no session yet', () => {
    const sessions = [
      { date: utils.dateStringDaysAgo(2, FIXED_NOW) },
      { date: utils.dateStringDaysAgo(1, FIXED_NOW) },
      // nothing for "today"
    ];
    const result = stats.computeStreaks(sessions, FIXED_NOW);
    assertEqual(result.current, 2, 'today being pending should not zero out an active streak');
  });

  test('computeStreaks distinguishes a broken current streak from a longer historical one', () => {
    const sessions = [
      { date: utils.dateStringDaysAgo(10, FIXED_NOW) },
      { date: utils.dateStringDaysAgo(9, FIXED_NOW) },
      { date: utils.dateStringDaysAgo(8, FIXED_NOW) }, // a 3-day run, long ago
      { date: utils.dateStringDaysAgo(0, FIXED_NOW) }, // isolated day = today
    ];
    const result = stats.computeStreaks(sessions, FIXED_NOW);
    assertEqual(result.longest, 3);
    assertEqual(result.current, 1);
  });

  test('getDashboardSnapshot reports hasAnyData=false on an empty store', () => {
    globalThis.localStorage.clear();
    store.initStore();
    const snapshot = stats.getDashboardSnapshot(FIXED_NOW);
    assertEqual(snapshot.hasAnyData, false);
  });

  test('getDashboardSnapshot sums today/week/month correctly and keeps them mutually consistent', () => {
    globalThis.localStorage.clear();
    store.initStore();
    const subject = subjectsFeature.createSubject({ name: 'Physics' }).record;

    const today = utils.todayDateString(FIXED_NOW);
    const twoDaysAgo = utils.dateStringDaysAgo(2, FIXED_NOW);
    const lastMonthDate = '2026-07-15'; // outside both week and current month window

    addCompletedSession({ subjectId: subject.id, date: today, duration: 1800 });
    addCompletedSession({ subjectId: subject.id, date: twoDaysAgo, duration: 3600 });
    addCompletedSession({ subjectId: subject.id, date: lastMonthDate, duration: 7200 });

    const snapshot = stats.getDashboardSnapshot(FIXED_NOW);
    assertEqual(snapshot.hasAnyData, true);
    assertEqual(snapshot.todaySeconds, 1800);
    assertEqual(snapshot.weekSeconds, 1800 + 3600, 'week total should include today + the 2-days-ago session');
    assert(snapshot.monthSeconds >= 1800 + 3600, 'month total should include everything within September');
    assert(snapshot.monthSeconds < 1800 + 3600 + 7200, 'month total should exclude the July session');
  });

  test('getDashboardSnapshot daily goal percent reflects settings.dailyGoalMinutes', () => {
    globalThis.localStorage.clear();
    store.initStore();
    store.updateSettings({ dailyGoalMinutes: 60 }); // 3600s goal
    const subject = subjectsFeature.createSubject({ name: 'Chemistry' }).record;
    addCompletedSession({ subjectId: subject.id, date: utils.todayDateString(FIXED_NOW), duration: 1800 });

    const snapshot = stats.getDashboardSnapshot(FIXED_NOW);
    assertEqual(snapshot.dailyGoalPercent, 50);
  });

  test('getDashboardSnapshot weekly breakdown is a Monday-Sunday calendar week (7 days, Monday first) and includes today', () => {
    globalThis.localStorage.clear();
    store.initStore();
    const snapshot = stats.getDashboardSnapshot(FIXED_NOW);
    assertEqual(snapshot.weekly.breakdown.length, 7);
    assertEqual(snapshot.weekly.breakdown[0].label, 'Mon', 'the week must start on Monday, not a trailing 7-day window');
    assertEqual(snapshot.weekly.breakdown[6].label, 'Sun');
    assert(
      snapshot.weekly.breakdown.some((d) => d.date === utils.todayDateString(FIXED_NOW)),
      'today (a Thursday in this fixture) must fall somewhere within the Mon-Sun week, not necessarily last'
    );
  });

  test('getDashboardSnapshot weekly window resets at the Monday boundary — a session from last week is excluded even though it is within 7 days', () => {
    globalThis.localStorage.clear();
    store.initStore();
    const subject = subjectsFeature.createSubject({ name: 'Boundary Subject' }).record;
    // FIXED_NOW is Thursday 2026-09-10; the prior Sunday (2026-09-06) is only 4 days
    // before it — well within a trailing-7-day window, but in the PREVIOUS calendar week.
    addCompletedSession({ subjectId: subject.id, date: '2026-09-06', duration: 5000 });
    addCompletedSession({ subjectId: subject.id, date: utils.todayDateString(FIXED_NOW), duration: 1000 });

    const snapshot = stats.getDashboardSnapshot(FIXED_NOW);
    assertEqual(snapshot.weekSeconds, 1000, 'last Sunday\u2019s session belongs to the previous calendar week and must not count');
  });

  test('getDashboardSnapshot subject distribution percentages sum to ~100', () => {
    globalThis.localStorage.clear();
    store.initStore();
    const s1 = subjectsFeature.createSubject({ name: 'Alpha' }).record;
    const s2 = subjectsFeature.createSubject({ name: 'Beta' }).record;
    const today = utils.todayDateString(FIXED_NOW);
    addCompletedSession({ subjectId: s1.id, date: today, duration: 3000 });
    addCompletedSession({ subjectId: s2.id, date: today, duration: 1000 });

    const snapshot = stats.getDashboardSnapshot(FIXED_NOW);
    const totalPercent = snapshot.subjectDistribution.reduce((sum, r) => sum + r.percent, 0);
    assert(totalPercent >= 99 && totalPercent <= 101, `expected ~100%, got ${totalPercent}%`);
    assertEqual(snapshot.subjectDistribution[0].name, 'Alpha', 'higher-duration subject should sort first');
  });

  test('getDashboardSnapshot most-studied-subject and longest-session reflect actual today data', () => {
    globalThis.localStorage.clear();
    store.initStore();
    const s1 = subjectsFeature.createSubject({ name: 'Focus Subject' }).record;
    const today = utils.todayDateString(FIXED_NOW);
    addCompletedSession({ subjectId: s1.id, studyType: 'Theory', date: today, duration: 600 });
    addCompletedSession({ subjectId: s1.id, studyType: 'Practice', date: today, duration: 2400 });

    const snapshot = stats.getDashboardSnapshot(FIXED_NOW);
    assertEqual(snapshot.today.mostStudiedSubject.subject.name, 'Focus Subject');
    assertEqual(snapshot.today.mostProductiveType.key, 'Practice');
    assertEqual(snapshot.today.longestSessionSeconds, 2400);
    assertEqual(snapshot.today.sessionCount, 2);
  });
});

console.log('\n▶ analytics/insights.js — Smart Insights rule engine\n');
describe('insights', () => {
  let insights;
  let store;
  let subjectsFeature;
  const FIXED_NOW = new Date('2026-09-10T12:00:00'); // a Thursday

  function addSession({ subjectId, studyType = 'Practice', date, duration }) {
    return store.addRecord('studySessions', {
      subjectId, studyType,
      startTime: `${date}T09:00:00.000Z`, endTime: `${date}T10:00:00.000Z`,
      pausedIntervals: [], duration, date, status: 'completed',
    });
  }

  async function freshStore() {
    globalThis.localStorage.clear();
    store = await import('../js/core/store.js');
    store.initStore();
    subjectsFeature = await import('../js/features/subjects.js');
  }

  test('module loads', async () => {
    await freshStore();
    insights = await import('../js/analytics/insights.js');
  });

  test('generateInsights returns nothing on an empty store', async () => {
    await freshStore();
    assertEqual(insights.generateInsights(FIXED_NOW), []);
  });

  test('flags low consistency when this week has far fewer studied days than last week', async () => {
    await freshStore();
    const subject = subjectsFeature.createSubject({ name: 'Physics' }).record;
    // Previous week: 4 distinct studied days.
    [8, 9, 10, 11].forEach((daysAgo) => addSession({ subjectId: subject.id, date: utils.dateStringDaysAgo(daysAgo, FIXED_NOW), duration: 1800 }));
    // This week: only 1 studied day.
    addSession({ subjectId: subject.id, date: utils.dateStringDaysAgo(1, FIXED_NOW), duration: 1200 });

    const result = insights.generateInsights(FIXED_NOW);
    const low = result.find((i) => i.id === 'consistency-low');
    assert(low, `expected a consistency-low insight, got: ${JSON.stringify(result.map((r) => r.id))}`);
    assertEqual(low.severity, 'warning');
  });

  test('recognizes a 3-day streak as "longest yet" when it equals the historical longest', async () => {
    await freshStore();
    const subject = subjectsFeature.createSubject({ name: 'Math' }).record;
    [2, 1, 0].forEach((daysAgo) => addSession({ subjectId: subject.id, date: utils.dateStringDaysAgo(daysAgo, FIXED_NOW), duration: 900 }));

    const result = insights.generateInsights(FIXED_NOW);
    const streak = result.find((i) => i.id === 'streak-best');
    assert(streak, `expected streak-best, got: ${JSON.stringify(result.map((r) => r.id))}`);
    assertEqual(streak.severity, 'excellent');
  });

  test('flags subject dominance only when one subject has >=50% of total time and >=2 subjects exist', async () => {
    await freshStore();
    const dominant = subjectsFeature.createSubject({ name: 'Dominant Subject' }).record;
    const minor = subjectsFeature.createSubject({ name: 'Minor Subject' }).record;
    const today = utils.todayDateString(FIXED_NOW);
    addSession({ subjectId: dominant.id, date: today, duration: 8000 });
    addSession({ subjectId: minor.id, date: today, duration: 2000 });

    const result = insights.generateInsights(FIXED_NOW);
    const dominance = result.find((i) => i.id === 'subject-dominance');
    assert(dominance, `expected subject-dominance, got: ${JSON.stringify(result.map((r) => r.id))}`);
    assert(dominance.text.includes('Dominant Subject'));
  });

  test('does not flag dominance with only a single subject (nothing to compare against)', async () => {
    await freshStore();
    const only = subjectsFeature.createSubject({ name: 'Only Subject' }).record;
    addSession({ subjectId: only.id, date: utils.todayDateString(FIXED_NOW), duration: 5000 });
    const result = insights.generateInsights(FIXED_NOW);
    assert(!result.some((i) => i.id === 'subject-dominance'));
  });

  test('flags a subject not studied in the last 5 days, but not a subject with zero history', async () => {
    await freshStore();
    const neglected = subjectsFeature.createSubject({ name: 'Neglected Subject' }).record;
    const active = subjectsFeature.createSubject({ name: 'Active Subject' }).record;
    subjectsFeature.createSubject({ name: 'Never Studied Subject' }); // should never be flagged as "neglected"

    addSession({ subjectId: neglected.id, date: utils.dateStringDaysAgo(10, FIXED_NOW), duration: 1200 });
    addSession({ subjectId: active.id, date: utils.todayDateString(FIXED_NOW), duration: 1200 });

    const result = insights.generateInsights(FIXED_NOW);
    const neglectedInsight = result.find((i) => i.text.includes('Neglected Subject'));
    assert(neglectedInsight, `expected a neglected-subject insight, got: ${JSON.stringify(result.map((r) => r.text))}`);
    assert(!result.some((i) => i.text.includes('Never Studied Subject')), 'a subject with zero sessions should never be called "neglected"');
  });

  test('flags a heavy theory/light practice imbalance', async () => {
    await freshStore();
    const subject = subjectsFeature.createSubject({ name: 'Balance Subject' }).record;
    const today = utils.todayDateString(FIXED_NOW);
    addSession({ subjectId: subject.id, studyType: 'Theory', date: today, duration: 7000 });
    addSession({ subjectId: subject.id, studyType: 'Lecture', date: today, duration: 1000 });
    addSession({ subjectId: subject.id, studyType: 'Practice', date: today, duration: 1000 });
    addSession({ subjectId: subject.id, studyType: 'Revision', date: today, duration: 1000 });

    const result = insights.generateInsights(FIXED_NOW);
    const balance = result.find((i) => i.id === 'theory-heavy');
    assert(balance, `expected theory-heavy, got: ${JSON.stringify(result.map((r) => r.id))}`);
  });

  test('flags no recent tests when a test exists historically but not in the last 14 days', async () => {
    await freshStore();
    const subject = subjectsFeature.createSubject({ name: 'Test Subject' }).record;
    addSession({ subjectId: subject.id, studyType: 'Test', date: utils.dateStringDaysAgo(20, FIXED_NOW), duration: 1800 });
    addSession({ subjectId: subject.id, studyType: 'Practice', date: utils.todayDateString(FIXED_NOW), duration: 1800 });
    addSession({ subjectId: subject.id, studyType: 'Theory', date: utils.dateStringDaysAgo(1, FIXED_NOW), duration: 1800 });
    addSession({ subjectId: subject.id, studyType: 'Revision', date: utils.dateStringDaysAgo(2, FIXED_NOW), duration: 1800 });

    const result = insights.generateInsights(FIXED_NOW);
    const testInsight = result.find((i) => i.id === 'no-recent-tests');
    assert(testInsight, `expected no-recent-tests, got: ${JSON.stringify(result.map((r) => r.id))}`);
  });

  test('session quality trend requires at least 2 sessions in both weeks before comparing', async () => {
    await freshStore();
    const subject = subjectsFeature.createSubject({ name: 'Quality Subject' }).record;
    // Only 1 session last week — trend must not fire on a sample of 1.
    addSession({ subjectId: subject.id, date: utils.dateStringDaysAgo(9, FIXED_NOW), duration: 600 });
    addSession({ subjectId: subject.id, date: utils.todayDateString(FIXED_NOW), duration: 3600 });
    addSession({ subjectId: subject.id, date: utils.dateStringDaysAgo(1, FIXED_NOW), duration: 3600 });

    const result = insights.generateInsights(FIXED_NOW);
    assert(!result.some((i) => i.id === 'session-quality-trend'), 'should not compute a trend from a single-session baseline week');
  });

  test('insights are sorted with warnings before neutral/encouraging ones', async () => {
    await freshStore();
    const s1 = subjectsFeature.createSubject({ name: 'A' }).record;
    const s2 = subjectsFeature.createSubject({ name: 'B' }).record;
    const today = utils.todayDateString(FIXED_NOW);
    // Dominance (neutral) + neglect (warning) both present at once.
    addSession({ subjectId: s1.id, date: today, duration: 9000 });
    addSession({ subjectId: s2.id, date: utils.dateStringDaysAgo(10, FIXED_NOW), duration: 1000 });

    const result = insights.generateInsights(FIXED_NOW);
    const warningIndex = result.findIndex((i) => i.severity === 'warning');
    const neutralIndex = result.findIndex((i) => i.severity === 'neutral');
    if (warningIndex !== -1 && neutralIndex !== -1) {
      assert(warningIndex < neutralIndex, 'warnings should be sorted ahead of neutral insights');
    }
  });
});

console.log('\n▶ analytics/stats.js (Phase 6 additions) — distributions & series\n');
describe('stats-phase6', () => {
  let stats2;
  let store2;
  let subjectsFeature2;
  const FIXED_NOW = new Date('2026-09-10T12:00:00');

  test('module loads', async () => {
    globalThis.localStorage.clear();
    store2 = await import('../js/core/store.js');
    store2.initStore();
    subjectsFeature2 = await import('../js/features/subjects.js');
    stats2 = await import('../js/analytics/stats.js');
  });

  test('getStudyTypeDistribution groups by type and percentages sum to 100', () => {
    const subject = subjectsFeature2.createSubject({ name: 'X' }).record;
    const today = utils.todayDateString(FIXED_NOW);
    store2.addRecord('studySessions', { subjectId: subject.id, studyType: 'Theory', startTime: `${today}T09:00:00.000Z`, endTime: `${today}T10:00:00.000Z`, pausedIntervals: [], duration: 3000, date: today, status: 'completed' });
    store2.addRecord('studySessions', { subjectId: subject.id, studyType: 'Practice', startTime: `${today}T09:00:00.000Z`, endTime: `${today}T10:00:00.000Z`, pausedIntervals: [], duration: 1000, date: today, status: 'completed' });

    const dist = stats2.getStudyTypeDistribution();
    const total = dist.reduce((sum, d) => sum + d.percent, 0);
    assert(total >= 99 && total <= 101);
    assertEqual(dist[0].type, 'Theory', 'higher-duration type should sort first');
  });

  test('getDailyStudySeries(7) returns exactly 7 entries ending today', () => {
    const series = stats2.getDailyStudySeries(7, FIXED_NOW);
    assertEqual(series.length, 7);
    assertEqual(series[6].date, utils.todayDateString(FIXED_NOW));
  });

  test('getTodayHourlySeries returns 24 hourly buckets', () => {
    const series = stats2.getTodayHourlySeries(FIXED_NOW);
    assertEqual(series.length, 24);
  });
});

console.log('\n▶ features/todos.js — CRUD, filters, overdue, completion stats\n');
describe('todos', () => {
  let todosFeature;
  let store;
  const FIXED_NOW = new Date('2026-09-10T12:00:00');

  test('module loads with a clean store', async () => {
    globalThis.localStorage.clear();
    store = await import('../js/core/store.js');
    store.initStore();
    todosFeature = await import('../js/features/todos.js');
  });

  test('createTodo requires a non-empty title', () => {
    const outcome = todosFeature.createTodo({ title: '   ', category: 'Study', priority: 'Medium' });
    assert(!outcome.ok);
  });

  test('createTodo succeeds with defaults for optional fields', () => {
    const outcome = todosFeature.createTodo({ title: 'Read chapter 3', category: 'Study', priority: 'High' });
    assert(outcome.ok, JSON.stringify(outcome.errors));
    assertEqual(outcome.record.completed, false);
    assertEqual(outcome.record.dueDate, null);
  });

  test('toggleTodoComplete stamps completedAt when completing, clears it when undone', () => {
    const todo = todosFeature.createTodo({ title: 'Practice set 1', category: 'Practice', priority: 'Medium' }).record;
    const completed = todosFeature.toggleTodoComplete(todo.id);
    assert(completed.ok);
    assert(completed.record.completed);
    assert(completed.record.completedAt !== null);

    const undone = todosFeature.toggleTodoComplete(todo.id);
    assert(undone.ok);
    assertEqual(undone.record.completed, false);
    assertEqual(undone.record.completedAt, null);
  });

  test('isOverdue is true only for an incomplete task with a past due date', () => {
    const today = utils.todayDateString(FIXED_NOW);
    const yesterday = utils.dateStringDaysAgo(1, FIXED_NOW);
    const overdueTodo = { completed: false, dueDate: yesterday };
    const futureTodo = { completed: false, dueDate: utils.dateStringDaysAgo(-1, FIXED_NOW) };
    const completedPastDue = { completed: true, dueDate: yesterday };
    assertEqual(todosFeature.isOverdue(overdueTodo, today), true);
    assertEqual(todosFeature.isOverdue(futureTodo, today), false);
    assertEqual(todosFeature.isOverdue(completedPastDue, today), false, 'a completed task is never overdue');
  });

  test('listTodos("today") only returns incomplete tasks due today', () => {
    globalThis.localStorage.clear();
    store.initStore();
    // listTodos() always compares against the real current date (correct for
    // production use), so the fixture must use the real "today" too, not FIXED_NOW.
    const today = utils.todayDateString();
    const tomorrow = utils.dateStringDaysAgo(-1);
    todosFeature.createTodo({ title: 'Due today', category: 'Study', priority: 'High', dueDate: today });
    todosFeature.createTodo({ title: 'Due tomorrow', category: 'Study', priority: 'High', dueDate: tomorrow });
    todosFeature.createTodo({ title: 'No due date', category: 'Study', priority: 'Low' });

    const todayList = todosFeature.listTodos('today');
    assertEqual(todayList.length, 1);
    assertEqual(todayList[0].title, 'Due today');
  });

  test('listTodos sorts incomplete tasks by priority, with completed tasks pushed to the end', () => {
    globalThis.localStorage.clear();
    store.initStore();
    todosFeature.createTodo({ title: 'Low priority', category: 'Study', priority: 'Low' });
    const high = todosFeature.createTodo({ title: 'High priority', category: 'Study', priority: 'High' }).record;
    todosFeature.createTodo({ title: 'Medium priority', category: 'Study', priority: 'Medium' });
    todosFeature.toggleTodoComplete(high.id); // completed High should still sort after incomplete Low

    const all = todosFeature.listTodos('all');
    assertEqual(all[0].title, 'Medium priority');
    assertEqual(all[1].title, 'Low priority');
    assertEqual(all[2].title, 'High priority');
    assertEqual(all[2].completed, true);
  });

  test('getTodoStats computes real completion rate and overdue count', () => {
    globalThis.localStorage.clear();
    store.initStore();
    const t1 = todosFeature.createTodo({ title: 'A', category: 'Study', priority: 'Low' }).record;
    todosFeature.createTodo({ title: 'B', category: 'Study', priority: 'Low' });
    todosFeature.createTodo({ title: 'Overdue', category: 'Study', priority: 'Low', dueDate: utils.dateStringDaysAgo(1, FIXED_NOW) });
    todosFeature.toggleTodoComplete(t1.id);

    const stats = todosFeature.getTodoStats(FIXED_NOW);
    assertEqual(stats.total, 3);
    assertEqual(stats.completedCount, 1);
    assertEqual(stats.completionRate, 33);
    assertEqual(stats.overdueCount, 1);
  });
});

console.log('\n▶ features/notes.js — CRUD with IndexedDB-backed content\n');
describe('notes', () => {
  let notesFeature;

  test('module loads with a clean store', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    notesFeature = await import('../js/features/notes.js');
  });

  test('createNote stores metadata in the store and content in IndexedDB', async () => {
    const outcome = await notesFeature.createNote({ title: 'My First Note', content: 'hello world' });
    assert(outcome.ok, JSON.stringify(outcome.errors));
    assertEqual(outcome.record.wordCount, 2);

    const content = await notesFeature.getNoteContent(outcome.record.id);
    assertEqual(content, 'hello world');
  });

  test('updateNoteContent updates title, wordCount, and the IndexedDB body together', async () => {
    const note = (await notesFeature.createNote({ title: 'Draft', content: 'one two three' })).record;
    const outcome = await notesFeature.updateNoteContent(note.id, { title: 'Final', content: 'one two three four five' });
    assert(outcome.ok);
    assertEqual(outcome.record.title, 'Final');
    assertEqual(outcome.record.wordCount, 5);

    const content = await notesFeature.getNoteContent(note.id);
    assertEqual(content, 'one two three four five');
  });

  test('togglePinned flips the pinned flag', async () => {
    const note = (await notesFeature.createNote({ title: 'Pin me', content: '' })).record;
    const outcome = notesFeature.togglePinned(note.id);
    assert(outcome.ok);
    assertEqual(outcome.record.pinned, true);
  });

  test('listNotesMeta sorts pinned notes first, then by most recently updated', async () => {
    // Isolate from other notes created earlier in this describe block (e.g. "Pin me"),
    // which would otherwise legitimately outrank this test's fixtures.
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();

    const a = (await notesFeature.createNote({ title: 'Older', content: '' })).record;
    const b = (await notesFeature.createNote({ title: 'Newer', content: '' })).record;
    // Force explicit, unambiguous timestamps instead of relying on wall-clock
    // gaps between two fast async calls, which can tie at millisecond resolution.
    store.updateRecord('notes', a.id, { updatedAt: '2026-01-01T00:00:00.000Z' });
    store.updateRecord('notes', b.id, { updatedAt: '2026-06-01T00:00:00.000Z' });
    notesFeature.togglePinned(a.id); // pin the older one — it should still sort first; togglePinned doesn't touch updatedAt

    const list = notesFeature.listNotesMeta({});
    assertEqual(list[0].id, a.id, 'pinned note should sort before unpinned, even if older');
  });

  test('listNotesMeta search matches title case-insensitively', async () => {
    await notesFeature.createNote({ title: 'Organic Chemistry Reactions', content: '' });
    const results = notesFeature.listNotesMeta({ search: 'chemistry' });
    assert(results.some((n) => n.title === 'Organic Chemistry Reactions'));
  });

  test('deleteNote removes both the metadata and the IndexedDB body', async () => {
    const note = (await notesFeature.createNote({ title: 'Temp', content: 'temp content' })).record;
    const outcome = await notesFeature.deleteNote(note.id);
    assert(outcome.ok);
    assertEqual(notesFeature.getNoteMeta(note.id), null);
    const content = await notesFeature.getNoteContent(note.id);
    assertEqual(content, '', 'content should be gone after delete');
  });
});

console.log('\n▶ features/sleep.js — overnight duration math, validation, stats\n');
describe('sleep', () => {
  let sleepFeature;
  const FIXED_NOW = new Date('2026-09-10T12:00:00');

  test('module loads with a clean store', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    sleepFeature = await import('../js/features/sleep.js');
  });

  test('overnight sleep (11:30 PM -> 6:30 AM) computes exactly 7 hours', () => {
    const outcome = sleepFeature.logSleep({ date: '2026-09-01', sleepClock: '23:30', wakeClock: '06:30' });
    assert(outcome.ok, JSON.stringify(outcome.errors));
    assertEqual(outcome.record.durationMinutes, 420);
  });

  test('a same-day nap (2:00 PM -> 3:30 PM) computes 90 minutes without adding a day', () => {
    const outcome = sleepFeature.logSleep({ date: '2026-09-02', sleepClock: '14:00', wakeClock: '15:30' });
    assert(outcome.ok, JSON.stringify(outcome.errors));
    assertEqual(outcome.record.durationMinutes, 90);
  });

  test('identical sleep/wake times are rejected (would compute as a full 24h day, over the sanity cap)', () => {
    const outcome = sleepFeature.logSleep({ date: '2026-09-03', sleepClock: '23:00', wakeClock: '23:00' });
    assert(!outcome.ok);
  });

  test('missing fields are rejected', () => {
    const outcome = sleepFeature.logSleep({ date: '2026-09-03', sleepClock: '', wakeClock: '07:00' });
    assert(!outcome.ok);
  });

  test('getSleepStats computes last night, weekly average, and monthly average from real records', () => {
    globalThis.localStorage.clear();
    sleepFeature = sleepFeature; // module state is fine to reuse; store needs reset
    return (async () => {
      const store = await import('../js/core/store.js');
      store.initStore();
      const sleep2 = await import('../js/features/sleep.js');

      sleep2.logSleep({ date: utils.dateStringDaysAgo(2, FIXED_NOW), sleepClock: '23:00', wakeClock: '07:00' }); // 8h
      sleep2.logSleep({ date: utils.dateStringDaysAgo(1, FIXED_NOW), sleepClock: '23:00', wakeClock: '06:00' }); // 7h
      sleep2.logSleep({ date: utils.dateStringDaysAgo(0, FIXED_NOW), sleepClock: '23:00', wakeClock: '06:30' }); // 7.5h (last night)

      const stats = sleep2.getSleepStats(FIXED_NOW);
      assert(stats.hasData);
      assertEqual(stats.lastNightMinutes, 450);
      assertEqual(stats.recordCount, 3);
      assert(stats.weekAvgMinutes > 0);
    })();
  });

  test('getSleepStats reports hasData=false with no records', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    const sleep2 = await import('../js/features/sleep.js');
    assertEqual(sleep2.getSleepStats(FIXED_NOW), { hasData: false });
  });
});

console.log('\n▶ analytics/sleepStats.js — decimal-hour math, series, bedtime/wake stddev\n');
describe('sleepStats', () => {
  let sleepStats;
  let sleepFeature;
  const FIXED_NOW = new Date('2026-09-10T12:00:00');

  test('module loads with a clean store', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    sleepFeature = await import('../js/features/sleep.js');
    sleepStats = await import('../js/analytics/sleepStats.js');
  });

  test('normalizeEveningHour shifts post-midnight hours by +24, leaves evening hours unchanged', () => {
    assertEqual(sleepStats.normalizeEveningHour(0.5), 24.5);
    assertEqual(sleepStats.normalizeEveningHour(11.9), 35.9);
    assertEqual(sleepStats.normalizeEveningHour(23.5), 23.5);
    assertEqual(sleepStats.normalizeEveningHour(12), 12);
  });

  test('getSleepDurationSeries returns null (not zero) for nights with no record', () => {
    const series = sleepStats.getSleepDurationSeries(7, FIXED_NOW);
    assertEqual(series.length, 7);
    assert(series.every((s) => s.minutes === null), 'no records exist yet, so every night should be a gap, not 0');
  });

  test('getSleepDurationSeries reflects a logged night at the correct date', () => {
    const today = utils.todayDateString(FIXED_NOW);
    sleepFeature.logSleep({ date: today, sleepClock: '23:00', wakeClock: '07:00' }); // 8h = 480min
    const series = sleepStats.getSleepDurationSeries(7, FIXED_NOW);
    const todayEntry = series.find((s) => s.date === today);
    assertEqual(todayEntry.minutes, 480);
  });

  test('getSleepScheduleSeries pushes wake time past 24 when it crosses midnight', () => {
    const series = sleepStats.getSleepScheduleSeries(7, FIXED_NOW);
    const todayEntry = series.find((s) => s.date === utils.todayDateString(FIXED_NOW));
    assertEqual(todayEntry.bedtimeHour, 23);
    assertEqual(todayEntry.wakeHour, 31, 'wake at 7:00 after an 11pm bedtime should read as hour 31, not 7, so it renders after the bedtime on the chart');
  });

  test('getBedtimeWakeConsistency reports hasEnoughData:false below 3 nights', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    const result = sleepStats.getBedtimeWakeConsistency(7, FIXED_NOW);
    assertEqual(result, { hasEnoughData: false });
  });

  test('getBedtimeWakeConsistency computes near-zero stddev for identical bedtimes', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    [3, 2, 1, 0].forEach((daysAgo) => {
      sleepFeature.logSleep({ date: utils.dateStringDaysAgo(daysAgo, FIXED_NOW), sleepClock: '23:00', wakeClock: '07:00' });
    });
    const result = sleepStats.getBedtimeWakeConsistency(7, FIXED_NOW);
    assert(result.hasEnoughData);
    assertEqual(result.bedtimeStdDevMinutes, 0);
  });

  test('getBedtimeWakeConsistency computes a large stddev for wildly varied bedtimes', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    sleepFeature.logSleep({ date: utils.dateStringDaysAgo(3, FIXED_NOW), sleepClock: '21:00', wakeClock: '05:00' });
    sleepFeature.logSleep({ date: utils.dateStringDaysAgo(2, FIXED_NOW), sleepClock: '00:30', wakeClock: '08:00' });
    sleepFeature.logSleep({ date: utils.dateStringDaysAgo(1, FIXED_NOW), sleepClock: '23:00', wakeClock: '07:00' });
    sleepFeature.logSleep({ date: utils.dateStringDaysAgo(0, FIXED_NOW), sleepClock: '02:00', wakeClock: '09:00' });

    const result = sleepStats.getBedtimeWakeConsistency(7, FIXED_NOW);
    assert(result.hasEnoughData);
    assert(result.bedtimeStdDevMinutes > 60, `expected a large spread, got ${result.bedtimeStdDevMinutes} minutes`);
  });
});

console.log('\n▶ analytics/sleepInsights.js — duration/trend/consistency rules + sleep\u00d7study correlation\n');
describe('sleepInsights', () => {
  let sleepFeature2;
  let sleepInsights;
  let store3;
  const FIXED_NOW = new Date('2026-09-10T12:00:00');

  async function freshStore() {
    globalThis.localStorage.clear();
    store3 = await import('../js/core/store.js');
    store3.initStore();
    sleepFeature2 = await import('../js/features/sleep.js');
    sleepInsights = await import('../js/analytics/sleepInsights.js');
  }

  test('module loads', async () => {
    await freshStore();
  });

  test('generateSleepInsights returns nothing on an empty store', async () => {
    await freshStore();
    assertEqual(sleepInsights.generateSleepInsights(FIXED_NOW), []);
  });

  test('duration summary reports "good" for a week averaging 8 hours', async () => {
    await freshStore();
    [2, 1, 0].forEach((daysAgo) => {
      sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(daysAgo, FIXED_NOW), sleepClock: '23:00', wakeClock: '07:00' }); // 8h
    });
    const result = sleepInsights.generateSleepInsights(FIXED_NOW);
    const summary = result.find((i) => i.id === 'sleep-duration-summary');
    assert(summary, `expected sleep-duration-summary, got: ${JSON.stringify(result.map((r) => r.id))}`);
    assertEqual(summary.severity, 'good');
    assert(summary.text.includes('8h'));
  });

  test('duration summary reports "warning" for a week averaging under 6 hours', async () => {
    await freshStore();
    [2, 1, 0].forEach((daysAgo) => {
      sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(daysAgo, FIXED_NOW), sleepClock: '01:00', wakeClock: '06:00' }); // 5h
    });
    const result = sleepInsights.generateSleepInsights(FIXED_NOW);
    const summary = result.find((i) => i.id === 'sleep-duration-summary');
    assertEqual(summary.severity, 'warning');
  });

  test('trend rule compares this week vs last week averages and requires >=2 nights each', async () => {
    await freshStore();
    // Last week: short nights (6h). This week: longer nights (8h) -> should report "increased".
    [10, 9].forEach((daysAgo) => sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(daysAgo, FIXED_NOW), sleepClock: '00:00', wakeClock: '06:00' }));
    [1, 0].forEach((daysAgo) => sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(daysAgo, FIXED_NOW), sleepClock: '23:00', wakeClock: '07:00' }));

    const result = sleepInsights.generateSleepInsights(FIXED_NOW);
    const trend = result.find((i) => i.id === 'sleep-trend');
    assert(trend, `expected sleep-trend, got: ${JSON.stringify(result.map((r) => r.id))}`);
    assert(trend.text.includes('increased'));
    assertEqual(trend.severity, 'good');
  });

  test('consistency rule detects sleep becoming MORE consistent (lower stddev this week than last)', async () => {
    await freshStore();
    // Last week: wildly different durations (high stddev).
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(10, FIXED_NOW), sleepClock: '22:00', wakeClock: '02:00' }); // 4h
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(9, FIXED_NOW), sleepClock: '22:00', wakeClock: '08:00' }); // 10h
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(8, FIXED_NOW), sleepClock: '22:00', wakeClock: '03:00' }); // 5h
    // This week: nearly identical durations (low stddev).
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(2, FIXED_NOW), sleepClock: '23:00', wakeClock: '07:00' }); // 8h
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(1, FIXED_NOW), sleepClock: '23:00', wakeClock: '07:05' }); // 8h5m
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(0, FIXED_NOW), sleepClock: '23:00', wakeClock: '06:55' }); // 7h55m

    const result = sleepInsights.generateSleepInsights(FIXED_NOW);
    const consistency = result.find((i) => i.id === 'sleep-consistency-improving');
    assert(consistency, `expected sleep-consistency-improving, got: ${JSON.stringify(result.map((r) => r.id))}`);
  });

  test('bedtime warning fires when bedtimes vary by more than an hour across the week', async () => {
    await freshStore();
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(3, FIXED_NOW), sleepClock: '21:00', wakeClock: '05:00' });
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(2, FIXED_NOW), sleepClock: '23:30', wakeClock: '06:00' });
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(1, FIXED_NOW), sleepClock: '01:30', wakeClock: '08:00' });
    sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(0, FIXED_NOW), sleepClock: '22:00', wakeClock: '06:00' });

    const result = sleepInsights.generateSleepInsights(FIXED_NOW);
    const warning = result.find((i) => i.id === 'bedtime-warning');
    assert(warning, `expected bedtime-warning, got: ${JSON.stringify(result.map((r) => r.id))}`);
  });

  test('bedtime warning does NOT fire for a consistent bedtime schedule', async () => {
    await freshStore();
    [3, 2, 1, 0].forEach((daysAgo) => {
      sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(daysAgo, FIXED_NOW), sleepClock: '23:00', wakeClock: '07:00' });
    });
    const result = sleepInsights.generateSleepInsights(FIXED_NOW);
    assert(!result.some((i) => i.id === 'bedtime-warning'));
  });

  test('sleep\u00d7study correlation requires at least 10 sleep records and 8 paired study days', async () => {
    await freshStore();
    // Only 5 sleep records — below the 10-record threshold.
    for (let i = 0; i < 5; i += 1) {
      sleepFeature2.logSleep({ date: utils.dateStringDaysAgo(i, FIXED_NOW), sleepClock: '23:00', wakeClock: '07:00' });
    }
    const result = sleepInsights.generateSleepInsights(FIXED_NOW);
    assert(!result.some((i) => i.id === 'sleep-study-correlation'));
  });

  test('sleep\u00d7study correlation reports higher study time following 7+ hour nights', async () => {
    await freshStore();
    const subjectsFeature3 = await import('../js/features/subjects.js');
    const subject = subjectsFeature3.createSubject({ name: 'Correlation Subject' }).record;

    // 12 nights: 6 with 8h sleep (followed by a big study day), 6 with 4h sleep (followed by a small study day).
    for (let i = 12; i >= 1; i -= 1) {
      const nightDate = utils.dateStringDaysAgo(i, FIXED_NOW);
      const wakeDay = utils.addDaysToDateString(nightDate, 1);
      const longSleep = i % 2 === 0;
      sleepFeature2.logSleep({ date: nightDate, sleepClock: longSleep ? '23:00' : '02:00', wakeClock: '07:00' }); // 8h vs 5h
      store3.addRecord('studySessions', {
        subjectId: subject.id, studyType: 'Practice',
        startTime: `${wakeDay}T09:00:00.000Z`, endTime: `${wakeDay}T10:00:00.000Z`,
        pausedIntervals: [], duration: longSleep ? 5400 : 900, date: wakeDay, status: 'completed',
      });
    }

    const result = sleepInsights.generateSleepInsights(FIXED_NOW);
    const correlation = result.find((i) => i.id === 'sleep-study-correlation');
    assert(correlation, `expected sleep-study-correlation, got: ${JSON.stringify(result.map((r) => r.id))}`);
    assert(correlation.text.includes('higher'), `expected "higher" direction, got: "${correlation.text}"`);
  });
});

console.log('\n▶ features/music.js — safe YouTube ID extraction, CRUD, playlist filtering\n');
describe('music', () => {
  let musicFeature;

  test('module loads with a clean store', async () => {
    globalThis.localStorage.clear();
    const store = await import('../js/core/store.js');
    store.initStore();
    musicFeature = await import('../js/features/music.js');
  });

  test('extractYouTubeId handles every common URL shape', () => {
    assertEqual(musicFeature.extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assertEqual(musicFeature.extractYouTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assertEqual(musicFeature.extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assertEqual(musicFeature.extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assertEqual(musicFeature.extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123'), 'dQw4w9WgXcQ', 'extra query params should be ignored');
    assertEqual(musicFeature.extractYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  });

  test('extractYouTubeId rejects non-YouTube URLs, malformed input, and short/garbage ids', () => {
    assertEqual(musicFeature.extractYouTubeId('https://vimeo.com/12345'), null);
    assertEqual(musicFeature.extractYouTubeId('not a url at all'), null);
    assertEqual(musicFeature.extractYouTubeId(''), null);
    assertEqual(musicFeature.extractYouTubeId('https://www.youtube.com/watch?v=short'), null, 'id must be exactly 11 characters');
    assertEqual(musicFeature.extractYouTubeId('https://www.youtube.com/'), null, 'no video id present');
  });

  test('getThumbnailUrl and getEmbedUrl point at the documented public YouTube endpoints, not a scraper', () => {
    const id = 'dQw4w9WgXcQ';
    assert(musicFeature.getThumbnailUrl(id).startsWith('https://img.youtube.com/vi/'));
    assert(musicFeature.getEmbedUrl(id).startsWith('https://www.youtube.com/embed/'));
  });

  test('addTrack rejects an invalid URL without creating a record', () => {
    const outcome = musicFeature.addTrack({ playlist: 'Lo-fi', title: 'Bad Link', youtubeUrl: 'not a url' });
    assert(!outcome.ok);
    assertEqual(musicFeature.listTracks().length, 0);
  });

  test('addTrack rejects a playlist outside the fixed set', () => {
    const outcome = musicFeature.addTrack({ playlist: 'Metal', title: 'X', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    assert(!outcome.ok);
  });

  test('addTrack succeeds and stores the extracted video id, not the raw URL, as videoId', () => {
    const outcome = musicFeature.addTrack({ playlist: 'Deep Focus', title: 'Rain Sounds', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ?t=10' });
    assert(outcome.ok, JSON.stringify(outcome.errors));
    assertEqual(outcome.record.videoId, 'dQw4w9WgXcQ');
  });

  test('listTracks filters by playlist correctly', () => {
    musicFeature.addTrack({ playlist: 'Classical', title: 'Piano Sonata', youtubeUrl: 'https://youtu.be/aaaaaaaaaaa' });
    musicFeature.addTrack({ playlist: 'Ambient', title: 'Ocean Waves', youtubeUrl: 'https://youtu.be/bbbbbbbbbbb' });

    assertEqual(musicFeature.listTracks('Classical').length, 1);
    assertEqual(musicFeature.listTracks('Ambient').length, 1);
    assert(musicFeature.listTracks().length >= 3, 'listTracks() with no argument should return everything');
  });

  test('deleteTrack removes the record', () => {
    const track = musicFeature.addTrack({ playlist: 'Lo-fi', title: 'Temp Track', youtubeUrl: 'https://youtu.be/ccccccccccc' }).record;
    const before = musicFeature.listTracks('Lo-fi').length;
    musicFeature.deleteTrack(track.id);
    assertEqual(musicFeature.listTracks('Lo-fi').length, before - 1);
  });
});

console.log('\n▶ migrations.js (Phase 10) — a new collection added without a version bump still defaults cleanly\n');
describe('migrations-phase10', () => {
  test('runMigrations fills in a missing musicTracks array even when no version-based migration runs', () => {
    const dataAtCurrentVersionButMissingMusicTracks = schema.createDefaultData();
    delete dataAtCurrentVersionButMissingMusicTracks.musicTracks; // simulate data saved before this field existed

    const { data, migrated } = migrations.runMigrations(dataAtCurrentVersionButMissingMusicTracks);
    assertEqual(migrated, false, 'no schema-version migration should have been needed');
    assert(Array.isArray(data.musicTracks), 'musicTracks should be defaulted to an array, not left undefined');
    assertEqual(data.musicTracks.length, 0);

    const check = schema.validateFullData(data);
    assert(check.valid, `expected valid data after normalization: ${JSON.stringify(check.errors)}`);
  });

  test('a legacy (version 0) blob missing musicTracks entirely still ends up valid after migration', () => {
    const legacy = {
      subjects: [], studySessions: [], todos: [], notes: [],
      // musicTracks and sleepRecords intentionally absent, like a pre-Phase-7/10 export
    };
    const { data } = migrations.runMigrations(legacy);
    assert(Array.isArray(data.musicTracks));
    assert(Array.isArray(data.sleepRecords));
    assert(schema.validateFullData(data).valid);
  });
});

console.log('\n▶ storage.js (Phase 10) — an existing install upgrading to a new collection\n');
describe('storage-phase10', () => {
  test('a dataset saved before musicTracks existed still loads cleanly, with musicTracks defaulting to []', () => {
    globalThis.localStorage.clear();
    const preMusicData = schema.createDefaultData();
    delete preMusicData.musicTracks;
    // Simulate an install that only ever wrote the pre-Phase-10 set of keys.
    Object.keys(preMusicData).forEach((name) => {
      globalThis.localStorage.setItem(`studyos:${name}`, JSON.stringify(preMusicData[name]));
    });

    const { data, isNew } = storage.loadData();
    assert(!isNew);
    assert(Array.isArray(data.musicTracks));
    assertEqual(data.musicTracks.length, 0);
    assert(schema.validateFullData(data).valid);
  });

  test('musicTracks gets its own dedicated localStorage key', () => {
    globalThis.localStorage.clear();
    const data = schema.createDefaultData();
    data.musicTracks.push({ id: 't1', playlist: 'Lo-fi', title: 'Test', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', createdAt: new Date().toISOString() });
    storage.saveAllParts(data);

    assert(globalThis.localStorage.getItem('studyos:musicTracks') !== null);
    const stored = JSON.parse(globalThis.localStorage.getItem('studyos:musicTracks'));
    assertEqual(stored[0].title, 'Test');
  });
});

console.log('\n▶ analytics/stats.js (fixes) — weekly-only dashboard distribution, range-scoped distributions\n');
describe('stats-fixes', () => {
  let stats3;
  let store4;
  let subjectsFeature4;
  const FIXED_NOW = new Date('2026-09-10T12:00:00');

  function addSession({ subjectId, studyType = 'Practice', date, duration }) {
    return store4.addRecord('studySessions', {
      subjectId, studyType,
      startTime: `${date}T09:00:00.000Z`, endTime: `${date}T10:00:00.000Z`,
      pausedIntervals: [], duration, date, status: 'completed',
    });
  }

  test('module loads', async () => {
    globalThis.localStorage.clear();
    store4 = await import('../js/core/store.js');
    store4.initStore();
    subjectsFeature4 = await import('../js/features/subjects.js');
    stats3 = await import('../js/analytics/stats.js');
  });

  test('dashboard subject distribution excludes a subject only studied outside the current week', () => {
    const oldSubject = subjectsFeature4.createSubject({ name: 'Old Month Subject' }).record;
    const recentSubject = subjectsFeature4.createSubject({ name: 'This Week Subject' }).record;

    addSession({ subjectId: oldSubject.id, date: '2026-07-01', duration: 10000 }); // long ago, heavy
    addSession({ subjectId: recentSubject.id, date: utils.todayDateString(FIXED_NOW), duration: 600 }); // this week, light

    const snapshot = stats3.getDashboardSnapshot(FIXED_NOW);
    const names = snapshot.subjectDistribution.map((r) => r.name);
    assert(!names.includes('Old Month Subject'), 'a subject with no sessions this week should not appear in the dashboard distribution');
    assert(names.includes('This Week Subject'));
  });

  test('getSubjectDistributionInRange and getStudyTypeDistributionInRange only include sessions within the given date bounds', () => {
    globalThis.localStorage.clear();
    store4.initStore();
    const subject = subjectsFeature4.createSubject({ name: 'Range Subject' }).record;

    addSession({ subjectId: subject.id, studyType: 'Theory', date: '2026-08-01', duration: 5000 }); // outside range
    addSession({ subjectId: subject.id, studyType: 'Practice', date: '2026-09-05', duration: 1000 }); // inside range

    const subjectDist = stats3.getSubjectDistributionInRange('2026-09-01', '2026-09-10');
    assertEqual(subjectDist[0].seconds, 1000, 'only the in-range session should count toward the total');

    const typeDist = stats3.getStudyTypeDistributionInRange('2026-09-01', '2026-09-10');
    assert(typeDist.every((t) => t.type !== 'Theory'), 'the out-of-range Theory session should not appear');
    assert(typeDist.some((t) => t.type === 'Practice'));
  });

  test('all-time getSubjectDistribution/getStudyTypeDistribution are unaffected by the new range variants', () => {
    const subjectDist = stats3.getSubjectDistribution();
    const total = subjectDist.reduce((sum, r) => sum + r.seconds, 0);
    assert(total >= 6000, 'all-time distribution should still include sessions from both dates above');
  });
});

console.log('\n▶ schema.js (fixes) — settings.displayName\n');
describe('schema-fixes', () => {
  test('createDefaultData includes an empty displayName', () => {
    const data = schema.createDefaultData();
    assertEqual(data.settings.displayName, '');
  });

  test('validateSettings accepts a string displayName and rejects a non-string one', () => {
    assert(schema.validateSettings({ dailyGoalMinutes: 1, weeklyGoalMinutes: 1, timerDefaults: {}, displayName: 'Alex' }).valid);
    const bad = schema.validateSettings({ dailyGoalMinutes: 1, weeklyGoalMinutes: 1, timerDefaults: {}, displayName: 42 });
    assert(!bad.valid);
  });
});

console.log('\n▶ analytics/dashboardInsight.js — personalized top-of-dashboard insight\n');
describe('dashboardInsight', () => {
  let dashboardInsight;
  let store5;
  let subjectsFeature5;
  let todosFeature2;
  const FIXED_NOW = new Date('2026-09-10T12:00:00');

  test('module loads with a clean store', async () => {
    globalThis.localStorage.clear();
    store5 = await import('../js/core/store.js');
    store5.initStore();
    subjectsFeature5 = await import('../js/features/subjects.js');
    todosFeature2 = await import('../js/features/todos.js');
    dashboardInsight = await import('../js/analytics/dashboardInsight.js');
  });

  test('returns null for a brand-new user with no data at all', () => {
    assertEqual(dashboardInsight.getTopDashboardInsight(FIXED_NOW), null);
  });

  test('surfaces an overdue-task warning when tasks are overdue', () => {
    todosFeature2.createTodo({ title: 'Late thing', category: 'Study', priority: 'High', dueDate: utils.dateStringDaysAgo(2, FIXED_NOW) });
    const insight = dashboardInsight.getTopDashboardInsight(FIXED_NOW);
    assert(insight, 'expected an insight');
    assertEqual(insight.id, 'overdue-tasks');
    assertEqual(insight.severity, 'warning');
  });

  test('a warning-severity candidate outranks a neutral/good one from the study insights engine', async () => {
    globalThis.localStorage.clear();
    store5.initStore();
    const subject = subjectsFeature5.createSubject({ name: 'Streak Subject' }).record;
    // Build a 3-day streak (→ a 'good'/'excellent' streak insight) AND an overdue task (→ 'warning').
    [2, 1, 0].forEach((daysAgo) => {
      store5.addRecord('studySessions', {
        subjectId: subject.id, studyType: 'Practice',
        startTime: `${utils.dateStringDaysAgo(daysAgo, FIXED_NOW)}T09:00:00.000Z`,
        endTime: `${utils.dateStringDaysAgo(daysAgo, FIXED_NOW)}T10:00:00.000Z`,
        pausedIntervals: [], duration: 1800, date: utils.dateStringDaysAgo(daysAgo, FIXED_NOW), status: 'completed',
      });
    });
    todosFeature2.createTodo({ title: 'Overdue thing', category: 'Study', priority: 'High', dueDate: utils.dateStringDaysAgo(3, FIXED_NOW) });

    const insight = dashboardInsight.getTopDashboardInsight(FIXED_NOW);
    assertEqual(insight.severity, 'warning', 'the warning should be picked over the encouraging streak message');
  });
});
await run();
summary();
