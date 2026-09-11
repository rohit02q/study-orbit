import { listSleepRecords } from '../features/sleep.js';
import { dateStringDaysAgo, addDaysToDateString, isDateOnOrAfter } from '../core/utils.js';
import { standardDeviation } from './stats.js';

export function toDecimalHour(isoString) {
  const d = new Date(isoString);
  return d.getHours() + d.getMinutes() / 60;
}

/** Bedtimes just after midnight (e.g. 00:15) are numerically far from evening bedtimes
 * (e.g. 23:30) even though they're close in real sleep terms. Shifting anything
 * before noon by +24h clusters them on one continuous scale for variance math. */
export function normalizeEveningHour(hour) {
  return hour < 12 ? hour + 24 : hour;
}

/** Trailing N-night duration series (oldest first). Nights with no record are null, not 0 — a gap, not zero sleep. */
export function getSleepDurationSeries(days, now = new Date()) {
  const records = listSleepRecords();
  const start = dateStringDaysAgo(days - 1, now);
  const byDate = new Map(records.map((r) => [r.date, r.durationMinutes]));

  return Array.from({ length: days }, (_, i) => {
    const date = addDaysToDateString(start, i);
    const label = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { date, label, minutes: byDate.has(date) ? byDate.get(date) : null };
  });
}

/** Trailing N-night bedtime/wake series as decimal hours, for the schedule chart. Wake is pushed past 24 when it crosses midnight, so the bar renders across the night correctly. */
export function getSleepScheduleSeries(days, now = new Date()) {
  const records = listSleepRecords();
  const start = dateStringDaysAgo(days - 1, now);
  const byDate = new Map(records.map((r) => [r.date, r]));

  return Array.from({ length: days }, (_, i) => {
    const date = addDaysToDateString(start, i);
    const label = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const record = byDate.get(date);
    if (!record) return { date, label, bedtimeHour: null, wakeHour: null };

    const bedtimeHour = toDecimalHour(record.sleepTime);
    let wakeHour = toDecimalHour(record.wakeTime);
    if (wakeHour <= bedtimeHour) wakeHour += 24;
    return { date, label, bedtimeHour, wakeHour };
  });
}

/**
 * Standard deviation of bedtime and wake time (in minutes) over the last
 * `days` nights — the actual "calculate standard deviation or time
 * variation" the brief asks for. Returns hasEnoughData:false below 3 nights,
 * since variance from 1-2 points isn't meaningful.
 */
export function getBedtimeWakeConsistency(days = 7, now = new Date()) {
  const records = listSleepRecords();
  const start = dateStringDaysAgo(days - 1, now);
  const recent = records.filter((r) => isDateOnOrAfter(r.date, start));
  if (recent.length < 3) return { hasEnoughData: false };

  const bedtimeHours = recent.map((r) => normalizeEveningHour(toDecimalHour(r.sleepTime)));
  const wakeHours = recent.map((r) => toDecimalHour(r.wakeTime));

  return {
    hasEnoughData: true,
    bedtimeStdDevMinutes: Math.round(standardDeviation(bedtimeHours) * 60),
    wakeStdDevMinutes: Math.round(standardDeviation(wakeHours) * 60),
    nightCount: recent.length,
  };
}
