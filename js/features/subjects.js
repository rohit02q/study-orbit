import { addRecord, updateRecord, deleteRecord, listRecords, getRecord } from '../core/store.js';
import { todayDateString, dateStringDaysAgo, isDateOnOrAfter, currentMonthString, monthOf } from '../core/utils.js';

// A deliberately small, distinct palette — not a color wheel. Keeps subject
// cards visually calm even with a dozen subjects on screen at once.
export const SUBJECT_COLOR_PALETTE = [
  '#F0A857', // ember
  '#63D2C4', // signal
  '#5B8DEF', // focus blue
  '#8B7FD6', // violet
  '#D9C548', // warning yellow
  '#4CAF7D', // green
  '#E0729E', // pink
  '#E8615F', // coral
];

export function listSubjects({ includeArchived = false } = {}) {
  const subjects = listRecords('subjects');
  const filtered = includeArchived ? subjects : subjects.filter((s) => !s.archived);
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Creates a subject. Returns { ok, record, errors }.
 * `name` is trimmed; duplicate active names are rejected so subjects stay
 * a meaningful grouping key rather than accumulating near-duplicates.
 */
export function createSubject({ name, color }) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    return { ok: false, record: null, errors: ['Subject name is required.'] };
  }
  const duplicate = listRecords('subjects').find(
    (s) => !s.archived && s.name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicate) {
    return { ok: false, record: null, errors: [`A subject named "${trimmedName}" already exists.`] };
  }

  return addRecord('subjects', {
    name: trimmedName,
    color: color || SUBJECT_COLOR_PALETTE[0],
    archived: false,
  });
}

export function editSubject(id, { name, color }) {
  const patch = {};
  if (name !== undefined) {
    const trimmedName = name.trim();
    if (!trimmedName) return { ok: false, record: null, errors: ['Subject name is required.'] };
    patch.name = trimmedName;
  }
  if (color !== undefined) patch.color = color;
  return updateRecord('subjects', id, patch);
}

export function archiveSubject(id, archived = true) {
  return updateRecord('subjects', id, { archived });
}

/** A subject with existing sessions can't be deleted outright (would break referential integrity). */
export function subjectHasSessions(id) {
  return listRecords('studySessions', (s) => s.subjectId === id).length > 0;
}

/** Returns { ok, errors } — refuses to delete a subject that has study sessions. */
export function deleteSubject(id) {
  if (subjectHasSessions(id)) {
    return { ok: false, errors: ['This subject has study sessions on record and can\u2019t be deleted \u2014 archive it instead.'] };
  }
  return deleteRecord('subjects', id);
}

/**
 * Real stats computed from actual completed sessions — all zero until the
 * Timer phase starts producing session records, at which point this
 * function needs no changes to start reporting real numbers.
 */
export function getSubjectStats(subjectId) {
  const sessions = listRecords('studySessions', (s) => s.subjectId === subjectId && s.status === 'completed');
  const today = todayDateString();
  const weekCutoff = dateStringDaysAgo(6); // last 7 days inclusive of today
  const month = currentMonthString();

  const totalSeconds = sessions.reduce((sum, s) => sum + s.duration, 0);
  const todaySeconds = sessions.filter((s) => s.date === today).reduce((sum, s) => sum + s.duration, 0);
  const weekSeconds = sessions
    .filter((s) => isDateOnOrAfter(s.date, weekCutoff))
    .reduce((sum, s) => sum + s.duration, 0);
  const monthSeconds = sessions.filter((s) => monthOf(s.date) === month).reduce((sum, s) => sum + s.duration, 0);

  const sessionCount = sessions.length;
  const avgDurationSeconds = sessionCount > 0 ? Math.round(totalSeconds / sessionCount) : 0;

  return { totalSeconds, todaySeconds, weekSeconds, monthSeconds, sessionCount, avgDurationSeconds };
}

export function getSubject(id) {
  return getRecord('subjects', id);
}
