import { addRecord, updateRecord, deleteRecord, listRecords, getRecord } from '../core/store.js';
import { nowISO, todayDateString, dateStringDaysAgo, isDateOnOrAfter } from '../core/utils.js';
import { getSubject } from './subjects.js';
import { STUDY_TYPES } from '../core/schema.js';

export { STUDY_TYPES };

/** At most one session may be running/paused at a time — this is that invariant's single source of truth. */
export function getActiveSession() {
  const active = listRecords('studySessions', (s) => s.status === 'running' || s.status === 'paused');
  return active.length > 0 ? active[0] : null;
}

export function startSession({ subjectId, studyType, goalNote = '', sessionNote = '' }) {
  if (getActiveSession()) {
    return { ok: false, record: null, errors: ['A session is already in progress. Stop or reset it before starting a new one.'] };
  }
  if (!subjectId) return { ok: false, record: null, errors: ['Choose a subject to start.'] };
  if (!STUDY_TYPES.includes(studyType)) return { ok: false, record: null, errors: ['Choose a study type to start.'] };

  return addRecord('studySessions', {
    subjectId,
    studyType,
    startTime: nowISO(),
    endTime: null,
    pausedIntervals: [],
    duration: 0,
    goalNote,
    sessionNote,
    date: todayDateString(),
    status: 'running',
  });
}

export function pauseSession(id) {
  const session = getRecord('studySessions', id);
  if (!session || session.status !== 'running') {
    return { ok: false, record: null, errors: ['Session is not running.'] };
  }
  const pausedIntervals = [...session.pausedIntervals, { start: nowISO() }];
  return updateRecord('studySessions', id, { pausedIntervals, status: 'paused' });
}

export function resumeSession(id) {
  const session = getRecord('studySessions', id);
  if (!session || session.status !== 'paused') {
    return { ok: false, record: null, errors: ['Session is not paused.'] };
  }
  const pausedIntervals = closeOpenInterval(session.pausedIntervals, nowISO());
  return updateRecord('studySessions', id, { pausedIntervals, status: 'running' });
}

function closeOpenInterval(pausedIntervals, atISO) {
  if (pausedIntervals.length === 0) return pausedIntervals;
  const lastIndex = pausedIntervals.length - 1;
  if (pausedIntervals[lastIndex].end) return pausedIntervals; // already closed
  return pausedIntervals.map((interval, i) => (i === lastIndex ? { ...interval, end: atISO } : interval));
}

/**
 * The one function everything else depends on for correctness: elapsed time
 * is ALWAYS derived from startTime + pausedIntervals, never from a running
 * counter. This is what survives page refresh and setInterval drift.
 */
export function computeElapsedSeconds(session, atISO = nowISO()) {
  const start = new Date(session.startTime).getTime();
  const at = new Date(atISO).getTime();
  const pausedMs = session.pausedIntervals.reduce((sum, interval) => {
    const intervalStart = new Date(interval.start).getTime();
    const intervalEnd = interval.end ? new Date(interval.end).getTime() : at; // still paused right now
    return sum + Math.max(0, intervalEnd - intervalStart);
  }, 0);
  return Math.floor(Math.max(0, at - start - pausedMs) / 1000);
}

export function stopSession(id) {
  const session = getRecord('studySessions', id);
  if (!session || session.status === 'completed') {
    return { ok: false, record: null, errors: ['No active session to stop.'] };
  }

  const now = nowISO();
  const pausedIntervals = session.status === 'paused' ? closeOpenInterval(session.pausedIntervals, now) : session.pausedIntervals;
  const duration = computeElapsedSeconds({ ...session, pausedIntervals }, now);

  return updateRecord('studySessions', id, { endTime: now, duration, status: 'completed', pausedIntervals });
}

/** Discards an in-progress session entirely (the timer's "Reset"). Nothing is saved. */
export function discardActiveSession(id) {
  return deleteRecord('studySessions', id);
}

/**
 * Real, data-driven summary copy for the post-session modal. Every branch
 * is a query against actual stored sessions — nothing here is random or
 * hardcoded, per the project's "no fake analytics" requirement.
 */
export function buildSessionInsight(completedSession) {
  const subject = getSubject(completedSession.subjectId);
  const subjectName = subject ? subject.name : 'this subject';
  const typeLabel = completedSession.studyType.toLowerCase();

  const allForSubject = listRecords('studySessions', (s) => s.subjectId === completedSession.subjectId && s.status === 'completed');
  if (allForSubject.length === 1) {
    return `First logged ${typeLabel} session for ${subjectName}. A start is on the board.`;
  }

  const weekCutoff = dateStringDaysAgo(6);
  const sameComboThisWeek = listRecords('studySessions', (s) =>
    s.subjectId === completedSession.subjectId &&
    s.studyType === completedSession.studyType &&
    s.status === 'completed' &&
    isDateOnOrAfter(s.date, weekCutoff)
  );

  const isLongestThisWeek = sameComboThisWeek.length > 1 && sameComboThisWeek.every((s) => s.duration <= completedSession.duration);
  if (isLongestThisWeek) {
    return `That was your longest ${subjectName} ${typeLabel} session this week.`;
  }

  const count = sameComboThisWeek.length;
  return `Session saved. ${count} ${typeLabel} session${count === 1 ? '' : 's'} logged for ${subjectName} this week.`;
}
