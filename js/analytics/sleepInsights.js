import { listSleepRecords } from '../features/sleep.js';
import { getCompletedSessions, average, standardDeviation } from './stats.js';
import { getBedtimeWakeConsistency } from './sleepStats.js';
import { dateStringDaysAgo, addDaysToDateString, isDateOnOrAfter, isDateInRange, formatDuration } from '../core/utils.js';

const SEVERITY_RANK = { critical: 0, warning: 1, good: 2, excellent: 2, neutral: 3 };

function ruleDurationSummary(now) {
  const weekStart = dateStringDaysAgo(6, now);
  const weekRecords = listSleepRecords().filter((r) => isDateOnOrAfter(r.date, weekStart));
  if (weekRecords.length < 3) return null;

  const avgMinutes = Math.round(average(weekRecords.map((r) => r.durationMinutes)));
  const severity = avgMinutes < 360 ? 'warning' : avgMinutes < 420 ? 'neutral' : 'good';
  return { id: 'sleep-duration-summary', category: 'sleep', severity, text: `Your average sleep duration this week is ${formatDuration(avgMinutes * 60)}.` };
}

function ruleTrend(now) {
  const records = listSleepRecords();
  const thisWeekStart = dateStringDaysAgo(6, now);
  const prevWeekEnd = addDaysToDateString(thisWeekStart, -1);
  const prevWeekStart = addDaysToDateString(prevWeekEnd, -6);

  const thisWeek = records.filter((r) => isDateOnOrAfter(r.date, thisWeekStart));
  const prevWeek = records.filter((r) => isDateInRange(r.date, prevWeekStart, prevWeekEnd));
  if (thisWeek.length < 2 || prevWeek.length < 2) return null;

  const diffMinutes = Math.round(average(thisWeek.map((r) => r.durationMinutes)) - average(prevWeek.map((r) => r.durationMinutes)));
  if (Math.abs(diffMinutes) < 10) return null;

  const direction = diffMinutes > 0 ? 'increased' : 'decreased';
  return {
    id: 'sleep-trend', category: 'sleep', severity: diffMinutes > 0 ? 'good' : 'warning',
    text: `Your average sleep ${direction} by ${Math.abs(diffMinutes)} minutes compared to last week.`,
  };
}

function ruleConsistencyTrend(now) {
  const records = listSleepRecords();
  const thisWeekStart = dateStringDaysAgo(6, now);
  const prevWeekEnd = addDaysToDateString(thisWeekStart, -1);
  const prevWeekStart = addDaysToDateString(prevWeekEnd, -6);

  const thisWeek = records.filter((r) => isDateOnOrAfter(r.date, thisWeekStart));
  const prevWeek = records.filter((r) => isDateInRange(r.date, prevWeekStart, prevWeekEnd));
  if (thisWeek.length < 3 || prevWeek.length < 3) return null;

  const stdThis = standardDeviation(thisWeek.map((r) => r.durationMinutes));
  const stdPrev = standardDeviation(prevWeek.map((r) => r.durationMinutes));
  if (stdPrev === 0) return null;

  const changePct = Math.round(((stdThis - stdPrev) / stdPrev) * 100);
  if (Math.abs(changePct) < 15) return null;

  if (changePct < 0) return { id: 'sleep-consistency-improving', category: 'sleep', severity: 'good', text: 'Your sleep schedule is becoming more consistent.' };
  return { id: 'sleep-consistency-worsening', category: 'sleep', severity: 'warning', text: 'Your sleep schedule is becoming less consistent.' };
}

function ruleBedtimeWarning(now) {
  const consistency = getBedtimeWakeConsistency(7, now);
  if (!consistency.hasEnoughData) return null;
  if (consistency.bedtimeStdDevMinutes > 60) {
    return {
      id: 'bedtime-warning', category: 'sleep', severity: 'warning',
      text: 'Your bedtime varies significantly across the week, which indicates an inconsistent sleep schedule.',
    };
  }
  return null;
}

/**
 * Pairs each night's sleep with the FOLLOWING calendar day's study time
 * (the day the person is awake using that night's rest), splits into
 * "7+ hours" vs "under 7 hours" groups, and compares average study time
 * between them. Requires a real sample in both groups before speaking.
 */
function ruleSleepStudyCorrelation() {
  const sleepRecords = listSleepRecords();
  if (sleepRecords.length < 10) return null;

  const studyByDate = new Map();
  getCompletedSessions().forEach((s) => studyByDate.set(s.date, (studyByDate.get(s.date) || 0) + s.duration));

  const paired = sleepRecords
    .map((r) => {
      const wakeDay = addDaysToDateString(r.date, 1);
      return { durationMinutes: r.durationMinutes, studySeconds: studyByDate.get(wakeDay) || 0, hasStudyDay: studyByDate.has(wakeDay) };
    })
    .filter((p) => p.hasStudyDay);

  if (paired.length < 8) return null;

  const highSleep = paired.filter((p) => p.durationMinutes >= 420);
  const lowSleep = paired.filter((p) => p.durationMinutes < 420);
  if (highSleep.length < 3 || lowSleep.length < 3) return null;

  const avgHigh = average(highSleep.map((p) => p.studySeconds));
  const avgLow = average(lowSleep.map((p) => p.studySeconds));
  if (avgLow === 0) return null;

  const pctDiff = Math.round(((avgHigh - avgLow) / avgLow) * 100);
  if (Math.abs(pctDiff) < 10) return null;

  const direction = pctDiff > 0 ? 'higher' : 'lower';
  return {
    id: 'sleep-study-correlation', category: 'correlation', severity: pctDiff > 0 ? 'good' : 'neutral',
    text: `On days after sleeping 7+ hours, your average study time was ${Math.abs(pctDiff)}% ${direction} than after shorter nights.`,
  };
}

const RULES = [ruleDurationSummary, ruleTrend, ruleConsistencyTrend, ruleBedtimeWarning, ruleSleepStudyCorrelation];

export function generateSleepInsights(now = new Date()) {
  return RULES.map((rule) => rule(now))
    .filter(Boolean)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
