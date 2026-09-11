import { addRecord, deleteRecord, listRecords } from '../core/store.js';
import { dateStringDaysAgo, isDateOnOrAfter, monthOf, currentMonthString } from '../core/utils.js';

/**
 * Logs a night's sleep. sleepClock/wakeClock are "HH:MM" strings on the given
 * date. If wake time is at or before sleep time on that same calendar date,
 * the wake is treated as happening the next day (the normal overnight case:
 * sleep 11:30 PM -> wake 6:30 AM = 7 hours). If wake is after sleep on the
 * same date, it's treated as a same-day nap and no day is added.
 */
export function logSleep({ date, sleepClock, wakeClock }) {
  if (!date || !sleepClock || !wakeClock) {
    return { ok: false, record: null, errors: ['Date, sleep time, and wake time are all required.'] };
  }

  const sleepDateTime = new Date(`${date}T${sleepClock}:00`);
  const wakeDateTime = new Date(`${date}T${wakeClock}:00`);
  if (Number.isNaN(sleepDateTime.getTime()) || Number.isNaN(wakeDateTime.getTime())) {
    return { ok: false, record: null, errors: ['Invalid date or time.'] };
  }

  if (wakeDateTime <= sleepDateTime) {
    wakeDateTime.setDate(wakeDateTime.getDate() + 1);
  }

  const durationMinutes = Math.round((wakeDateTime - sleepDateTime) / 60000);
  if (durationMinutes <= 0) {
    return { ok: false, record: null, errors: ['Wake time must be after sleep time.'] };
  }
  if (durationMinutes > 16 * 60) {
    return { ok: false, record: null, errors: ['That\u2019s over 16 hours \u2014 double check the times.'] };
  }

  return addRecord('sleepRecords', {
    date,
    sleepTime: sleepDateTime.toISOString(),
    wakeTime: wakeDateTime.toISOString(),
    durationMinutes,
  });
}

export function deleteSleepRecord(id) {
  return deleteRecord('sleepRecords', id);
}

export function listSleepRecords() {
  return listRecords('sleepRecords').sort((a, b) => b.date.localeCompare(a.date));
}

/** Real averages computed from stored records — {hasData: false} when there's nothing logged yet. */
export function getSleepStats(now = new Date()) {
  const records = listSleepRecords();
  if (records.length === 0) return { hasData: false };

  const lastNight = records[0];
  const avgAllMinutes = Math.round(records.reduce((sum, r) => sum + r.durationMinutes, 0) / records.length);

  const weekStart = dateStringDaysAgo(6, now);
  const weekRecords = records.filter((r) => isDateOnOrAfter(r.date, weekStart));
  const weekAvgMinutes = weekRecords.length > 0 ? Math.round(weekRecords.reduce((sum, r) => sum + r.durationMinutes, 0) / weekRecords.length) : 0;

  const month = currentMonthString(now);
  const monthRecords = records.filter((r) => monthOf(r.date) === month);
  const monthAvgMinutes = monthRecords.length > 0 ? Math.round(monthRecords.reduce((sum, r) => sum + r.durationMinutes, 0) / monthRecords.length) : 0;

  return {
    hasData: true,
    lastNightMinutes: lastNight.durationMinutes,
    lastNightDate: lastNight.date,
    avgAllMinutes,
    weekAvgMinutes,
    monthAvgMinutes,
    recordCount: records.length,
  };
}
