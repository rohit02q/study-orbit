export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowISO() {
  return new Date().toISOString();
}

/** Local (not UTC) YYYY-MM-DD, since study days are user-local-time buckets. */
export function todayDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Parses JSON without throwing. Returns { ok, value, error }. */
export function safeJSONParse(text) {
  try {
    return { ok: true, value: JSON.parse(text), error: null };
  } catch (error) {
    return { ok: false, value: null, error: error.message };
  }
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isISODateTime(value) {
  if (typeof value !== 'string') return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export function isDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** "5400" seconds -> "1h 30m". Falls back to "0m" for zero/negative/invalid input. */
export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return '0m';
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** YYYY-MM-DD string that is `days` before referenceDate (local time). */
export function dateStringDaysAgo(days, referenceDate = new Date()) {
  const d = new Date(referenceDate);
  d.setDate(d.getDate() - days);
  return todayDateString(d);
}

/** Offsets an existing YYYY-MM-DD string by `days` (positive or negative). */
export function addDaysToDateString(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayDateString(d);
}

/** YYYY-MM-DD strings compare correctly as plain strings (zero-padded, big-endian). */
export function isDateOnOrAfter(dateStr, cutoffDateStr) {
  return dateStr >= cutoffDateStr;
}

export function isDateOnOrBefore(dateStr, cutoffDateStr) {
  return dateStr <= cutoffDateStr;
}

export function isDateInRange(dateStr, startDateStr, endDateStr) {
  return dateStr >= startDateStr && dateStr <= endDateStr;
}

/** Monday of the calendar week containing referenceDate, as a YYYY-MM-DD string. */
export function getCalendarWeekStart(referenceDate = new Date()) {
  const d = new Date(referenceDate);
  const day = d.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return todayDateString(d);
}

/** "2026-09-01" -> "2026-09" */
export function monthOf(dateStr) {
  return typeof dateStr === 'string' ? dateStr.slice(0, 7) : '';
}

export function currentMonthString(referenceDate = new Date()) {
  return monthOf(todayDateString(referenceDate));
}

/** "2026-09-04" -> "4 Sep" — the friendly display format used in lists throughout the app. */
export function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
