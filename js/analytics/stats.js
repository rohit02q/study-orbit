import { listRecords, getSettings } from '../core/store.js';
import { getSubject } from '../features/subjects.js';
import {
  todayDateString,
  dateStringDaysAgo,
  addDaysToDateString,
  isDateOnOrAfter,
  isDateInRange,
  getCalendarWeekStart,
  monthOf,
  currentMonthString,
} from '../core/utils.js';

export function getCompletedSessions() {
  return listRecords('studySessions', (s) => s.status === 'completed');
}

/** Shared math utilities — used by both study and sleep analytics. */
export function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function sumDuration(sessions) {
  return sessions.reduce((sum, s) => sum + s.duration, 0);
}

/** Returns the {key, seconds} with the highest total duration for the given field, or null. */
function topByDuration(sessions, key) {
  const totals = new Map();
  sessions.forEach((s) => totals.set(s[key], (totals.get(s[key]) || 0) + s.duration));
  let top = null;
  let topSeconds = -1;
  totals.forEach((seconds, k) => {
    if (seconds > topSeconds) {
      topSeconds = seconds;
      top = k;
    }
  });
  return top !== null ? { key: top, seconds: topSeconds } : null;
}

/**
 * Current + longest streaks, where a "study day" is any date with at least
 * one completed session. Current streak counts backward from today, but
 * doesn't break just because today has no session yet (today is still
 * "pending" until the day ends) — it only breaks once a full day is missed.
 */
export function computeStreaks(completedSessions, now = new Date()) {
  const studiedDays = new Set(completedSessions.map((s) => s.date));
  if (studiedDays.size === 0) return { current: 0, longest: 0 };

  const sortedDays = Array.from(studiedDays).sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDays.length; i += 1) {
    const prevMs = new Date(`${sortedDays[i - 1]}T00:00:00`).getTime();
    const curMs = new Date(`${sortedDays[i]}T00:00:00`).getTime();
    const diffDays = Math.round((curMs - prevMs) / 86_400_000);
    run = diffDays === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const today = todayDateString(now);
  let cursor = studiedDays.has(today) ? today : addDaysToDateString(today, -1);
  let current = 0;
  while (studiedDays.has(cursor)) {
    current += 1;
    cursor = addDaysToDateString(cursor, -1);
  }

  return { current, longest };
}

function buildTimeline(todaySessions, activeSession, today) {
  const entries = [...todaySessions];
  if (activeSession && activeSession.date === today) entries.push(activeSession);
  return entries.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
}

function buildWeeklyBreakdown(weekSessions, weekStartDateStr) {
  const byDate = new Map();
  weekSessions.forEach((s) => byDate.set(s.date, (byDate.get(s.date) || 0) + s.duration));

  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysToDateString(weekStartDateStr, i);
    const label = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
    return { date, label, seconds: byDate.get(date) || 0 };
  });
}

function buildSubjectDistribution(completedSessions) {
  const totals = new Map();
  completedSessions.forEach((s) => totals.set(s.subjectId, (totals.get(s.subjectId) || 0) + s.duration));

  const grandTotal = sumDuration(completedSessions);
  const rows = Array.from(totals.entries())
    .map(([subjectId, seconds]) => {
      const subject = getSubject(subjectId);
      return {
        subjectId,
        name: subject?.name || 'Deleted subject',
        color: subject?.color || '#5B6273',
        seconds,
        percent: grandTotal > 0 ? Math.round((seconds / grandTotal) * 100) : 0,
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  return rows;
}

function buildStudyTypeDistribution(completedSessions) {
  const totals = new Map();
  completedSessions.forEach((s) => totals.set(s.studyType, (totals.get(s.studyType) || 0) + s.duration));
  const grandTotal = sumDuration(completedSessions);

  return Array.from(totals.entries())
    .map(([type, seconds]) => ({ type, seconds, percent: grandTotal > 0 ? Math.round((seconds / grandTotal) * 100) : 0 }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** All-time subject distribution. */
export function getSubjectDistribution() {
  return buildSubjectDistribution(getCompletedSessions());
}

/** All-time study-type distribution (Theory/Practice/PYQ/etc). */
export function getStudyTypeDistribution() {
  return buildStudyTypeDistribution(getCompletedSessions());
}

/** Subject distribution restricted to a date range — e.g. so it can follow the Analytics page's range selector. */
export function getSubjectDistributionInRange(startDate, endDate) {
  return buildSubjectDistribution(getCompletedSessions().filter((s) => isDateInRange(s.date, startDate, endDate)));
}

/** Study-type distribution restricted to a date range. */
export function getStudyTypeDistributionInRange(startDate, endDate) {
  return buildStudyTypeDistribution(getCompletedSessions().filter((s) => isDateInRange(s.date, startDate, endDate)));
}


/** Trailing N-day daily series (oldest first), for the Analytics line chart. */
export function getDailyStudySeries(days, now = new Date()) {
  const completed = getCompletedSessions();
  const start = dateStringDaysAgo(days - 1, now);
  const byDate = new Map();
  completed.forEach((s) => {
    if (isDateOnOrAfter(s.date, start)) byDate.set(s.date, (byDate.get(s.date) || 0) + s.duration);
  });

  return Array.from({ length: days }, (_, i) => {
    const date = addDaysToDateString(start, i);
    const label =
      days <= 14
        ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })
        : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { date, label, seconds: byDate.get(date) || 0 };
  });
}

/** Month-to-date daily series, from the 1st of the current month through today. */
export function getMonthToDateSeries(now = new Date()) {
  const monthStart = `${currentMonthString(now)}-01`;
  const todayStr = todayDateString(now);
  const completed = getCompletedSessions();
  const byDate = new Map();
  completed.forEach((s) => {
    if (monthOf(s.date) === currentMonthString(now)) byDate.set(s.date, (byDate.get(s.date) || 0) + s.duration);
  });

  const daysSoFar = Math.round((new Date(`${todayStr}T00:00:00`) - new Date(`${monthStart}T00:00:00`)) / 86_400_000) + 1;
  return Array.from({ length: Math.max(1, daysSoFar) }, (_, i) => {
    const date = addDaysToDateString(monthStart, i);
    return { date, label: String(new Date(`${date}T00:00:00`).getDate()), seconds: byDate.get(date) || 0 };
  });
}

/** Today's completed sessions bucketed by the hour they started in. */
export function getTodayHourlySeries(now = new Date()) {
  const today = todayDateString(now);
  const todaysSessions = getCompletedSessions().filter((s) => s.date === today);
  const buckets = new Array(24).fill(0);
  todaysSessions.forEach((s) => {
    const hour = new Date(s.startTime).getHours();
    buckets[hour] += s.duration;
  });
  return buckets.map((seconds, hour) => ({ date: today, label: `${hour}:00`, seconds }));
}

/**
 * Single entry point the Dashboard (and later pages) call. Everything in
 * the returned object is computed from real stored sessions at call time —
 * nothing here is cached or precomputed, so it can never drift stale.
 */
export function getDashboardSnapshot(now = new Date()) {
  const completed = getCompletedSessions();
  const today = todayDateString(now);
  // Monday-Sunday calendar week — resets every Monday, not a trailing 7-day window.
  const weekStart = getCalendarWeekStart(now);
  const weekEnd = addDaysToDateString(weekStart, 6);
  const month = currentMonthString(now);
  const settings = getSettings();

  const todaySessions = completed.filter((s) => s.date === today);
  const weekSessions = completed.filter((s) => isDateInRange(s.date, weekStart, weekEnd));
  const monthSessions = completed.filter((s) => monthOf(s.date) === month);

  const todaySeconds = sumDuration(todaySessions);
  const weekSeconds = sumDuration(weekSessions);
  const monthSeconds = sumDuration(monthSessions);

  const streak = computeStreaks(completed, now);
  const dailyGoalSeconds = (settings.dailyGoalMinutes || 0) * 60;
  const dailyGoalPercent = dailyGoalSeconds > 0 ? Math.round((todaySeconds / dailyGoalSeconds) * 100) : 0;

  const activeSession = listRecords('studySessions', (s) => s.status === 'running' || s.status === 'paused')[0] || null;
  const mostStudiedSubjectToday = topByDuration(todaySessions, 'subjectId');
  const mostProductiveTypeToday = topByDuration(todaySessions, 'studyType');
  const longestSessionToday = todaySessions.reduce((max, s) => (s.duration > (max?.duration || 0) ? s : max), null);

  const weeklyBreakdown = buildWeeklyBreakdown(weekSessions, weekStart);
  // Divide by days elapsed so far this week (Mon=1 ... today), not a flat 7 —
  // otherwise the average reads artificially low early in the week, before
  // Friday/Saturday/Sunday have even happened yet.
  const elapsedDaysThisWeek = Math.min(7, Math.round((new Date(`${today}T00:00:00`) - new Date(`${weekStart}T00:00:00`)) / 86_400_000) + 1);
  const weeklyAverageSeconds = Math.round(weekSeconds / elapsedDaysThisWeek);
  const bestDay = weeklyBreakdown.reduce((best, d) => (d.seconds > best.seconds ? d : best), weeklyBreakdown[0]);
  const weakestDay = weeklyBreakdown.reduce((worst, d) => (d.seconds < worst.seconds ? d : worst), weeklyBreakdown[0]);

  return {
    hasAnyData: completed.length > 0,
    todaySeconds,
    weekSeconds,
    monthSeconds,
    streak,
    dailyGoalMinutes: settings.dailyGoalMinutes,
    dailyGoalPercent,
    today: {
      sessionCount: todaySessions.length + (activeSession && activeSession.date === today ? 1 : 0),
      mostStudiedSubject: mostStudiedSubjectToday ? { ...mostStudiedSubjectToday, subject: getSubject(mostStudiedSubjectToday.key) } : null,
      mostProductiveType: mostProductiveTypeToday,
      longestSessionSeconds: longestSessionToday?.duration || 0,
      timeline: buildTimeline(todaySessions, activeSession, today),
    },
    weekly: {
      weekStart,
      weekEnd,
      breakdown: weeklyBreakdown,
      averageSeconds: weeklyAverageSeconds,
      bestDay,
      weakestDay,
    },
    // Calendar-week, not all-time — resets every Monday rather than accumulating forever,
    // so it reflects what's actually been studied this week, not historical totals.
    subjectDistribution: buildSubjectDistribution(weekSessions),
  };
}
