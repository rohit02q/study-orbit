import { uuid, nowISO, isPlainObject, isNonEmptyString, isISODateTime, isDateString } from './utils.js';

export const CURRENT_SCHEMA_VERSION = 1;

export const STUDY_TYPES = ['Theory', 'Practice', 'PYQ', 'Test', 'Revision', 'Lecture', 'Other'];
export const SESSION_STATUSES = ['running', 'paused', 'completed'];
export const TODO_PRIORITIES = ['High', 'Medium', 'Low'];
export const TODO_CATEGORIES = ['Study', 'Revision', 'Practice', 'Test', 'Personal'];
export const MUSIC_PLAYLISTS = ['Deep Focus', 'Lo-fi', 'Classical', 'Ambient'];

// ---------- Defaults ----------

export function createDefaultData() {
  const timestamp = nowISO();
  return {
    meta: {
      version: CURRENT_SCHEMA_VERSION,
      createdAt: timestamp,
      lastUpdated: timestamp,
      deviceId: uuid(),
    },
    settings: {
      theme: 'dark',
      displayName: '',
      dailyGoalMinutes: 240,
      weeklyGoalMinutes: 1500,
      timerDefaults: { autoStartBreaks: false, soundOnComplete: true },
      demoDataActive: false,
    },
    subjects: [],
    studySessions: [],
    todos: [],
    notes: [],
    sleepRecords: [],
    musicTracks: [],
  };
}

// ---------- Validation helpers ----------
// Every validator returns { valid: boolean, errors: string[] }

function result(errors) {
  return { valid: errors.length === 0, errors };
}

export function validateSubject(subject) {
  const errors = [];
  if (!isPlainObject(subject)) return result(['subject must be an object']);
  if (!isNonEmptyString(subject.id)) errors.push('subject.id is required');
  if (!isNonEmptyString(subject.name)) errors.push('subject.name is required');
  if (!isNonEmptyString(subject.color)) errors.push('subject.color is required');
  if (typeof subject.archived !== 'boolean') errors.push('subject.archived must be boolean');
  if (!isISODateTime(subject.createdAt)) errors.push('subject.createdAt must be an ISO datetime');
  return result(errors);
}

export function validateStudySession(session) {
  const errors = [];
  if (!isPlainObject(session)) return result(['session must be an object']);
  if (!isNonEmptyString(session.id)) errors.push('session.id is required');
  if (!isNonEmptyString(session.subjectId)) errors.push('session.subjectId is required');
  if (!STUDY_TYPES.includes(session.studyType)) errors.push(`session.studyType must be one of ${STUDY_TYPES.join(', ')}`);
  if (!isISODateTime(session.startTime)) errors.push('session.startTime must be an ISO datetime');
  if (session.endTime !== null && !isISODateTime(session.endTime)) errors.push('session.endTime must be an ISO datetime or null');
  if (!Array.isArray(session.pausedIntervals)) errors.push('session.pausedIntervals must be an array');
  if (typeof session.duration !== 'number' || session.duration < 0) errors.push('session.duration must be a non-negative number');
  if (!isDateString(session.date)) errors.push('session.date must be a YYYY-MM-DD string');
  if (!SESSION_STATUSES.includes(session.status)) errors.push(`session.status must be one of ${SESSION_STATUSES.join(', ')}`);
  return result(errors);
}

export function validateTodo(todo) {
  const errors = [];
  if (!isPlainObject(todo)) return result(['todo must be an object']);
  if (!isNonEmptyString(todo.id)) errors.push('todo.id is required');
  if (!isNonEmptyString(todo.title)) errors.push('todo.title is required');
  if (!TODO_PRIORITIES.includes(todo.priority)) errors.push(`todo.priority must be one of ${TODO_PRIORITIES.join(', ')}`);
  if (!TODO_CATEGORIES.includes(todo.category)) errors.push(`todo.category must be one of ${TODO_CATEGORIES.join(', ')}`);
  if (typeof todo.completed !== 'boolean') errors.push('todo.completed must be boolean');
  if (!isISODateTime(todo.createdAt)) errors.push('todo.createdAt must be an ISO datetime');
  if (todo.completedAt !== null && !isISODateTime(todo.completedAt)) errors.push('todo.completedAt must be an ISO datetime or null');
  if (todo.dueDate !== null && !isDateString(todo.dueDate)) errors.push('todo.dueDate must be a YYYY-MM-DD string or null');
  return result(errors);
}

/** Notes are validated at the metadata level; body content lives in IndexedDB. */
export function validateNoteMeta(note) {
  const errors = [];
  if (!isPlainObject(note)) return result(['note must be an object']);
  if (!isNonEmptyString(note.id)) errors.push('note.id is required');
  if (!isNonEmptyString(note.title)) errors.push('note.title is required');
  if (typeof note.pinned !== 'boolean') errors.push('note.pinned must be boolean');
  if (!isISODateTime(note.createdAt)) errors.push('note.createdAt must be an ISO datetime');
  if (!isISODateTime(note.updatedAt)) errors.push('note.updatedAt must be an ISO datetime');
  if (typeof note.wordCount !== 'number' || note.wordCount < 0) errors.push('note.wordCount must be a non-negative number');
  return result(errors);
}

export function validateSleepRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) return result(['sleepRecord must be an object']);
  if (!isNonEmptyString(record.id)) errors.push('sleepRecord.id is required');
  if (!isDateString(record.date)) errors.push('sleepRecord.date must be a YYYY-MM-DD string');
  if (!isISODateTime(record.sleepTime)) errors.push('sleepRecord.sleepTime must be an ISO datetime');
  if (!isISODateTime(record.wakeTime)) errors.push('sleepRecord.wakeTime must be an ISO datetime');
  if (typeof record.durationMinutes !== 'number' || record.durationMinutes <= 0) {
    errors.push('sleepRecord.durationMinutes must be a positive number');
  }
  return result(errors);
}

export function validateTrack(track) {
  const errors = [];
  if (!isPlainObject(track)) return result(['track must be an object']);
  if (!isNonEmptyString(track.id)) errors.push('track.id is required');
  if (!MUSIC_PLAYLISTS.includes(track.playlist)) errors.push(`track.playlist must be one of ${MUSIC_PLAYLISTS.join(', ')}`);
  if (!isNonEmptyString(track.title)) errors.push('track.title is required');
  if (!isNonEmptyString(track.youtubeUrl)) errors.push('track.youtubeUrl is required');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(track.videoId || '')) errors.push('track.videoId must be a valid 11-character YouTube video id');
  if (!isISODateTime(track.createdAt)) errors.push('track.createdAt must be an ISO datetime');
  return result(errors);
}

export function validateSettings(settings) {
  const errors = [];
  if (!isPlainObject(settings)) return result(['settings must be an object']);
  if (typeof settings.dailyGoalMinutes !== 'number' || settings.dailyGoalMinutes < 0) {
    errors.push('settings.dailyGoalMinutes must be a non-negative number');
  }
  if (typeof settings.weeklyGoalMinutes !== 'number' || settings.weeklyGoalMinutes < 0) {
    errors.push('settings.weeklyGoalMinutes must be a non-negative number');
  }
  if (!isPlainObject(settings.timerDefaults)) errors.push('settings.timerDefaults must be an object');
  if (settings.displayName !== undefined && typeof settings.displayName !== 'string') {
    errors.push('settings.displayName must be a string');
  }
  return result(errors);
}

const COLLECTION_VALIDATORS = {
  subjects: validateSubject,
  studySessions: validateStudySession,
  todos: validateTodo,
  notes: validateNoteMeta,
  sleepRecords: validateSleepRecord,
  musicTracks: validateTrack,
};

export const COLLECTION_NAMES = Object.keys(COLLECTION_VALIDATORS);

export function getValidatorFor(collectionName) {
  return COLLECTION_VALIDATORS[collectionName];
}

/**
 * Validates the whole root data object: correct top-level shape plus every
 * record in every collection. Used before persisting and before accepting
 * an imported backup file.
 * Returns { valid, errors: [{ path, message }], counts: { [collection]: number } }
 */
export function validateFullData(data) {
  const errors = [];
  const counts = {};

  if (!isPlainObject(data)) {
    return { valid: false, errors: [{ path: 'root', message: 'data must be an object' }], counts };
  }

  if (!isPlainObject(data.meta)) {
    errors.push({ path: 'meta', message: 'meta is required' });
  } else {
    if (typeof data.meta.version !== 'number') errors.push({ path: 'meta.version', message: 'meta.version must be a number' });
    if (!isISODateTime(data.meta.createdAt)) errors.push({ path: 'meta.createdAt', message: 'must be an ISO datetime' });
    if (!isISODateTime(data.meta.lastUpdated)) errors.push({ path: 'meta.lastUpdated', message: 'must be an ISO datetime' });
  }

  const settingsCheck = validateSettings(data.settings);
  if (!settingsCheck.valid) settingsCheck.errors.forEach((message) => errors.push({ path: 'settings', message }));

  for (const collectionName of COLLECTION_NAMES) {
    const records = data[collectionName];
    if (!Array.isArray(records)) {
      errors.push({ path: collectionName, message: `${collectionName} must be an array` });
      continue;
    }
    counts[collectionName] = records.length;
    const validator = COLLECTION_VALIDATORS[collectionName];
    records.forEach((record, index) => {
      const check = validator(record);
      if (!check.valid) {
        check.errors.forEach((message) => errors.push({ path: `${collectionName}[${index}]`, message }));
      }
    });
  }

  // Referential integrity: sessions/todos referencing a subjectId should point at a real subject.
  if (Array.isArray(data.subjects) && Array.isArray(data.studySessions)) {
    const subjectIds = new Set(data.subjects.map((s) => s?.id));
    data.studySessions.forEach((session, index) => {
      if (session?.subjectId && !subjectIds.has(session.subjectId)) {
        errors.push({ path: `studySessions[${index}].subjectId`, message: 'references a subject that does not exist' });
      }
    });
  }

  return { valid: errors.length === 0, errors, counts };
}
