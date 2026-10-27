import { getSettings } from '../core/store.js';
import { listSubjects, getSubject } from '../features/subjects.js';
import { getCompletedSessions, computeStreaks } from './stats.js';
import {
  todayDateString,
  dateStringDaysAgo,
  getCalendarWeekStart,
  formatDuration,
} from '../core/utils.js';

/*
 * Design rules for every insight in this file:
 *  1. Minimum-data gate: no insight is shown until there is enough history
 *     to back it (weekly stuff needs full weeks, weekday stuff needs 4+ weeks).
 *  2. Only COMPLETED days are compared (windows end yesterday), so a half-done
 *     week / half-done today never looks like a "decline".
 *  3. Coaching insights (subjects, tests, balance) only show when the basic
 *     study habit is there - no point talking about tests if studying itself
 *     isn't happening regularly.
 *  4. Text states the numbers it is based on. No guessing, no projections.
 */

const MS_PER_DAY = 86_400_000;
const MAX_INSIGHTS = 5;
const STREAK_WARN_HOUR = 16; // streak-at-risk reminder only after 4 pm, never first thing in the morning

const SEVERITY_WEIGHT = { critical: 100, warning: 70, excellent: 55, good: 50, neutral: 30 };

// Per-category cap so the feed never says the same thing twice.
const CATEGORY_CAP = { habit: 2, pace: 2, subjects: 1, balance: 1, testing: 1 };

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const THEORY_TYPES = new Set(['Theory', 'Lecture']);
const PRACTICE_TYPES = new Set(['Practice', 'PYQ', 'Test']);

const fmt = formatDuration;

/* --------------------------------- Math helpers -------------------------------- */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Ordinary least-squares line through {x, y} points; null if no usable slope.
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

// % change that refuses to run when the baseline is tiny ("up 2,883%" bug).
function safeRatioChange(current, previous, minBaseline) {
  if (previous < minBaseline) return null;
  return ((current - previous) / previous) * 100;
}

function scorePriority(severity, magnitude01 = 0) {
  return Math.round((SEVERITY_WEIGHT[severity] ?? 30) + clamp(magnitude01, 0, 1) * 30);
}

/* ------------------------------- Date helpers ---------------------------------- */
// Own small helpers (noon-anchored so DST can't shift a date by one).

const parseDate = (dateString) => new Date(`${dateString}T12:00:00`);
const inRange = (d, start, end) => d >= start && d <= end;
const weekdayIndex = (dateString) => parseDate(dateString).getDay();

function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / MS_PER_DAY);
}

function shiftDate(dateString, days) {
  const d = parseDate(dateString);
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 7 fully-completed days. weeksAgo 0 = the last 7 days ending YESTERDAY.
function completedWeek(weeksAgo, now) {
  return {
    start: dateStringDaysAgo(7 * weeksAgo + 7, now),
    end: dateStringDaysAgo(7 * weeksAgo + 1, now),
  };
}

/* ---------------------------------- Context ------------------------------------ */
// Everything the rules need, computed once per run.

function weekdayPattern(ctx) {
  const floor = dateStringDaysAgo(56, ctx.now);
  const start = ctx.firstDate > floor ? ctx.firstDate : floor;
  const end = ctx.yesterdayStr;
  if (daysBetween(start, end) + 1 < 28) return null; // need >= 4 occurrences of every weekday

  // Zero-study days are included - a day you skip must count against that weekday.
  const buckets = DAY_NAMES.map(() => []);
  for (let d = start; d <= end; d = shiftDate(d, 1)) {
    buckets[weekdayIndex(d)].push(ctx.secondsByDate.get(d) || 0);
  }
  const all = buckets.flat();
  if (all.filter((v) => v > 0).length < 12) return null;

  const overallMean = mean(all);
  const days = buckets.map((values, index) => {
    const skips = values.filter((v) => v === 0).length;
    return {
      index,
      name: DAY_NAMES[index],
      n: values.length,
      mean: mean(values),
      skips,
      skipRate: skips / values.length,
      aboveShare: values.filter((v) => v >= overallMean).length / values.length,
    };
  });
  return { overallMean, days };
}

function buildContext(now) {
  const completed = getCompletedSessions();
  if (!completed.length) return null;

  const todayStr = todayDateString(now);
  const yesterdayStr = dateStringDaysAgo(1, now);

  const secondsByDate = new Map();
  completed.forEach((s) => secondsByDate.set(s.date, (secondsByDate.get(s.date) || 0) + s.duration));
  const dates = Array.from(secondsByDate.keys()).sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const ctx = {
    now, todayStr, yesterdayStr, completed, secondsByDate, dates, firstDate, lastDate,
    studiedToday: secondsByDate.has(todayStr),
    // completed days since the first-ever session (today not counted)
    historyDays: Math.max(0, daysBetween(firstDate, yesterdayStr) + 1),
    gapDays: Math.max(0, daysBetween(lastDate, todayStr)),
  };
  ctx.activeDaysIn = (start, end) => dates.filter((d) => inRange(d, start, end)).length;
  ctx.secondsIn = (start, end) =>
    completed.filter((s) => inRange(s.date, start, end)).reduce((sum, s) => sum + s.duration, 0);

  const active14 = ctx.activeDaysIn(dateStringDaysAgo(14, now), yesterdayStr);
  ctx.onBreak = ctx.gapDays >= 3;
  // "Basic habit exists": 14+ days of history and studied on at least half of the last 14 days.
  ctx.canCoach = !ctx.onBreak && ctx.historyDays >= 14 && active14 >= 7;
  ctx.weekday = weekdayPattern(ctx);
  return ctx;
}

/* ---------------------------------- Rules --------------------------------------- */

// Active days per full 7-day window. Needs 2 full windows to say anything,
// 3+ for a trend. Windows that start before the first-ever session are skipped.
function ruleConsistency(ctx) {
  if (ctx.onBreak || ctx.historyDays < 14) return null;

  const series = []; // newest first
  for (let w = 0; w < 4; w += 1) {
    const { start, end } = completedWeek(w, ctx.now);
    if (start < ctx.firstDate) break;
    series.push({ x: -w, y: ctx.activeDaysIn(start, end) });
  }
  if (series.length < 2) return null;

  const thisDays = series[0].y;
  const prevDays = series[1].y;

  if (series.length >= 3) {
    const fit = linearRegression(series);
    const net = series[0].y - series[series.length - 1].y;
    if (fit && Math.abs(fit.slope) >= 0.75 && Math.abs(net) >= 2 && Math.sign(net) === Math.sign(fit.slope)) {
      const improving = fit.slope > 0;
      const history = series.map((p) => p.y).reverse().join(' → ');
      return {
        id: improving ? 'consistency-up' : 'consistency-down',
        category: 'habit',
        severity: improving ? 'good' : 'warning',
        text: improving
          ? `Har hafte active din badh rahe hain (purane → naye: ${history}). Consistency sahi direction mein hai.`
          : `Har hafte active din ghat rahe hain (purane → naye: ${history}). Roz ka ek chhota fixed session wapas lao, length baad mein badhana.`,
        priority: scorePriority(improving ? 'good' : 'warning', Math.abs(fit.slope) / 2),
      };
    }
  }

  if (thisDays <= 2) {
    return {
      id: 'consistency-low', category: 'habit', severity: 'warning',
      text: `Pichhle 7 din mein sirf ${thisDays} din padhai hui (usse pehle ke 7 din mein ${prevDays}). Roz ka ek chhota fixed session (20-30 min) banao, length baad mein badhana.`,
      priority: scorePriority('warning', (3 - thisDays) / 3),
    };
  }
  return null;
}

// Streak is only mentioned when there is something to ACT on:
// it is about to break today, or it is a new personal best.
function ruleStreak(ctx) {
  const asOf = new Date(ctx.now);
  if (!ctx.studiedToday) asOf.setDate(asOf.getDate() - 1); // judge by completed days
  const { current, longest } = computeStreaks(ctx.completed, asOf);

  if (!ctx.studiedToday && current >= 3 && ctx.now.getHours() >= STREAK_WARN_HOUR) {
    return {
      id: 'streak-at-risk', category: 'habit', severity: 'warning',
      text: `${current} din ka streak chal raha hai, par aaj abhi tak koi session nahi hui. Aaj padhai nahi hui to streak toot jayega.`,
      priority: scorePriority('warning', current / 14),
    };
  }
  if (ctx.studiedToday && current >= 7 && current === longest) {
    return {
      id: 'streak-best', category: 'habit', severity: 'excellent',
      text: `${current} din ka streak - ye tumhara ab tak ka sabse lamba streak hai.`,
      priority: scorePriority('excellent', current / 21),
    };
  }
  return null;
}

// Replaces "low consistency" style nagging when the user has simply stopped.
function ruleComeback(ctx) {
  if (!ctx.onBreak || ctx.dates.length < 3) return null;

  const before = ctx.activeDaysIn(shiftDate(ctx.lastDate, -13), ctx.lastDate);
  const recentDurations = ctx.completed
    .filter((s) => inRange(s.date, shiftDate(ctx.lastDate, -27), ctx.lastDate))
    .map((s) => s.duration);
  const typical = median(recentDurations);
  const severity = ctx.gapDays >= 7 ? 'critical' : 'warning';
  return {
    id: 'comeback', category: 'habit', severity,
    text: `${ctx.gapDays} din se koi session nahi hui. Usse pehle ke 14 din mein ${before} din padhai hui thi. Aaj ek normal session (${fmt(typical)}) se wapas shuru karo.`,
    priority: scorePriority(severity, (ctx.gapDays - 3) / 11),
  };
}

// Best weekday, from DAILY totals over 4-8 full weeks (zero days included).
// Shown only when it is today/tomorrow, so it is actually usable for planning.
function ruleBestDay(ctx) {
  const wp = ctx.weekday;
  if (!wp || ctx.onBreak) return null;

  const top = wp.days.reduce((best, d) => (d.mean > best.mean ? d : best));
  const clearlyAhead = top.mean >= wp.overallMean * 1.3 && top.mean - wp.overallMean >= 20 * 60;
  const notOneSpike = top.aboveShare >= 0.6; // above the daily average on most of its occurrences
  if (!clearlyAhead || !notOneSpike) return null;

  const todayIdx = weekdayIndex(ctx.todayStr);
  if (top.index !== todayIdx && top.index !== (todayIdx + 1) % 7) return null;

  const when = top.index === todayIdx ? 'Aaj' : 'Kal';
  return {
    id: 'best-day', category: 'habit', severity: 'neutral',
    text: `${when} ${top.name} hai - pichhle ${top.n} ${top.name} ka average ${fmt(top.mean)} raha, jabki har din ka overall average ${fmt(wp.overallMean)} hai. Heavy topics isi din rakho.`,
    priority: scorePriority('neutral', top.mean / wp.overallMean - 1.3),
  };
}

// A weekday that is skipped again and again. Shown on that day, before studying.
function ruleSkipDay(ctx) {
  const wp = ctx.weekday;
  if (!wp || ctx.onBreak || ctx.studiedToday) return null;

  const todayIdx = weekdayIndex(ctx.todayStr);
  const d = wp.days[todayIdx];
  if (d.skipRate < 0.75) return null;

  const others = wp.days.filter((x) => x.index !== todayIdx);
  const otherSkipRate = others.reduce((s, x) => s + x.skips, 0) / others.reduce((s, x) => s + x.n, 0);
  if (d.skipRate - otherSkipRate < 0.3) return null; // not specific to this weekday

  return {
    id: 'skip-day', category: 'habit', severity: 'warning',
    text: `Aaj ${d.name} hai - pichhle ${d.n} ${d.name} mein se ${d.skips} baar bilkul padhai nahi hui (baaki dinon mein ye ${Math.round(otherSkipRate * 100)}% hai). Aaj ka ek chhota session abhi fix kar lo.`,
    priority: scorePriority('warning', d.skipRate - otherSkipRate),
  };
}

// Study time: last 7 completed days vs the 7 before. Facts only, with the reason shown.
function ruleVolumeTrend(ctx) {
  if (ctx.onBreak || ctx.historyDays < 14) return null;

  const cur = completedWeek(0, ctx.now);
  const prev = completedWeek(1, ctx.now);
  const curSec = ctx.secondsIn(cur.start, cur.end);
  const prevSec = ctx.secondsIn(prev.start, prev.end);

  const changePct = safeRatioChange(curSec, prevSec, 2 * 3600); // ignore baselines under 2h
  if (changePct === null || Math.abs(changePct) < 25 || Math.abs(curSec - prevSec) < 3600) return null;

  const curDays = ctx.activeDaysIn(cur.start, cur.end);
  const prevDays = ctx.activeDaysIn(prev.start, prev.end);
  const perDayCur = curDays ? curSec / curDays : 0;
  const perDayPrev = prevDays ? prevSec / prevDays : 0;
  const up = changePct > 0;

  return {
    id: 'volume-trend', category: 'pace', severity: up ? 'good' : 'warning',
    text: `Pichhle 7 din mein ${fmt(curSec)} padhai hui, usse pehle ke 7 din mein ${fmt(prevSec)} - ${Math.round(Math.abs(changePct))}% ${up ? 'zyada' : 'kam'}. (Active din: ${curDays} vs ${prevDays}, har active din ka avg: ${fmt(perDayCur)} vs ${fmt(perDayPrev)})`,
    priority: scorePriority(up ? 'good' : 'warning', Math.abs(changePct) / 100),
  };
}

const goalSeconds = () => (getSettings().weeklyGoalMinutes || 0) * 60;

// NOT a projection. Plain arithmetic: how much is left vs how many days are left.
// Only from day 4 of the week, and only when it needs more than a normal day of yours.
function ruleGoalPace(ctx) {
  const goal = goalSeconds();
  if (!goal || ctx.onBreak || ctx.historyDays < 14) return null;

  const weekStart = getCalendarWeekStart(ctx.now);
  const elapsed = daysBetween(weekStart, ctx.todayStr) + 1;
  if (elapsed < 4 || elapsed > 7) return null;

  const remaining = goal - ctx.secondsIn(weekStart, ctx.todayStr);
  if (remaining <= 0) return null;
  const daysLeft = ctx.studiedToday ? 7 - elapsed : 8 - elapsed;
  if (daysLeft <= 0) return null;

  const activeDayTotals = ctx.dates
    .filter((d) => inRange(d, dateStringDaysAgo(28, ctx.now), ctx.yesterdayStr))
    .map((d) => ctx.secondsByDate.get(d));
  if (activeDayTotals.length < 8) return null;
  const typical = median(activeDayTotals);

  const perDay = remaining / daysLeft;
  if (perDay <= typical * 1.15) return null; // doable at a normal pace - the progress bar already shows it

  const left = `${daysLeft} din bache hain${ctx.studiedToday ? '' : ' (aaj milakar)'}`;
  const text = perDay > 10 * 3600
    ? `Weekly goal mein ${fmt(remaining)} baaki hai aur ${left} - roz ~${fmt(perDay)} chahiye, jo is hafte ke liye realistic nahi hai.`
    : `Weekly goal mein ${fmt(remaining)} baaki hai aur ${left} - roz ~${fmt(perDay)} chahiye, jabki tumhara normal padhai wala din ${fmt(typical)} ka hai.`;
  return {
    id: 'goal-pace', category: 'pace', severity: 'warning', text,
    priority: scorePriority('warning', perDay / typical - 1.15),
  };
}

// Is the goal itself set right? Judged on the last 4 full calendar weeks,
// shown only in the first 2 days of a week (the moment you can actually change it).
function ruleGoalCalibration(ctx) {
  const goal = goalSeconds();
  if (!goal) return null;

  const weekStart = getCalendarWeekStart(ctx.now);
  if (daysBetween(weekStart, ctx.todayStr) + 1 > 2) return null;

  const totals = [];
  for (let k = 1; k <= 4; k += 1) {
    const start = shiftDate(weekStart, -7 * k);
    if (start < ctx.firstDate) return null; // need 4 full weeks of history
    totals.push(ctx.secondsIn(start, shiftDate(start, 6)));
  }
  const med = median(totals);
  const hit = totals.filter((t) => t >= goal).length;

  if (totals.every((t) => t >= goal * 1.2)) {
    return {
      id: 'goal-too-easy', category: 'pace', severity: 'neutral',
      text: `Pichhle 4 hafton mein har hafta weekly goal (${fmt(goal)}) se 20%+ upar gaya, median ${fmt(med)}. Goal thoda badha sakte ho.`,
      priority: scorePriority('neutral', 0.4),
    };
  }
  if (totals.filter((t) => t < goal * 0.7).length >= 3) {
    return {
      id: 'goal-too-high', category: 'pace', severity: 'warning',
      text: `Pichhle 4 hafton mein weekly goal (${fmt(goal)}) sirf ${hit} baar pura hua, median hafta ${fmt(med)} ka raha. Goal ko median ke paas rakho, ya routine mein time badhao.`,
      priority: scorePriority('warning', 1 - med / goal),
    };
  }
  return null;
}

// "Neglected" is judged against the subject's OWN rhythm: a subject you study
// every 3 days is overdue at ~8 days, one you study daily is overdue at 5.
function ruleNeglectedSubject(ctx) {
  if (!ctx.canCoach) return null;

  let worst = null;
  for (const subject of listSubjects()) {
    const days = Array.from(
      new Set(ctx.completed.filter((s) => s.subjectId === subject.id).map((s) => s.date))
    ).sort();
    if (days.length < 3) continue; // no rhythm to compare against yet

    const gap = daysBetween(days[days.length - 1], ctx.todayStr);
    if (gap > 30) continue; // dormant, not "neglected"

    const typical = median(days.slice(1).map((d, i) => daysBetween(days[i], d)));
    const threshold = Math.max(5, Math.ceil(typical * 2.5));
    if (gap < threshold) continue;

    const score = gap / threshold;
    if (!worst || score > worst.score) worst = { subject, gap, typical, score };
  }
  if (!worst) return null;

  const rhythm = worst.typical <= 1.5 ? 'lagbhag roz' : `har ~${Math.round(worst.typical)} din mein`;
  const severity = worst.gap >= 14 ? 'critical' : 'warning';
  return {
    id: `neglected-${worst.subject.id}`, category: 'subjects', severity,
    text: `${worst.subject.name} ko ${worst.gap} din se nahi padha - pehle tum ise ${rhythm} padhte the.`,
    priority: scorePriority(severity, (worst.score - 1) / 2),
  };
}

// Per subject, last 28 days: lots of theory/lecture, almost no practice.
function ruleTheoryWithoutPractice(ctx) {
  if (!ctx.canCoach) return null;

  const since = dateStringDaysAgo(28, ctx.now);
  const bySubject = new Map();
  ctx.completed.forEach((s) => {
    if (s.date < since) return;
    const kind = THEORY_TYPES.has(s.studyType) ? 'theory' : PRACTICE_TYPES.has(s.studyType) ? 'practice' : null;
    if (!kind) return;
    const entry = bySubject.get(s.subjectId) || { theory: 0, practice: 0 };
    entry[kind] += s.duration;
    bySubject.set(s.subjectId, entry);
  });

  let worst = null;
  bySubject.forEach((v, id) => {
    const total = v.theory + v.practice;
    if (v.theory < 3 * 3600 || v.practice / total > 0.1) return;
    if (!worst || v.theory > worst.theory) worst = { id, ...v };
  });
  if (!worst) return null;

  const name = getSubject(worst.id)?.name;
  if (!name) return null;
  const practicePart = worst.practice === 0 ? 'practice ek baar bhi nahi' : `practice sirf ${fmt(worst.practice)}`;
  return {
    id: `theory-no-practice-${worst.id}`, category: 'balance', severity: 'warning',
    text: `${name} mein pichhle 28 din mein ${fmt(worst.theory)} theory/lecture hui, ${practicePart}. Ab is subject ke questions / PYQ solve karna shuru karo.`,
    priority: scorePriority('warning', (worst.theory / 3600 - 3) / 10),
  };
}

// Test nudge is based on how much you studied since the last test, not just the calendar,
// and never fires unless the study habit itself is in place (ctx.canCoach).
function ruleTestFrequency(ctx) {
  if (!ctx.canCoach || ctx.historyDays < 21) return null;

  const tests = ctx.completed.filter((s) => s.studyType === 'Test');
  if (tests.length === 0) {
    const total = ctx.completed.reduce((sum, s) => sum + s.duration, 0);
    if (ctx.dates.length < 14 || total < 15 * 3600) return null;
    return {
      id: 'no-tests-yet', category: 'testing', severity: 'neutral',
      text: `Abhi tak ek bhi Test session log nahi hui, jabki ${fmt(total)} padhai ho chuki hai. Ek chhota test do - pata chalega kya yaad hai aur kya nahi.`,
      priority: scorePriority('neutral', 0.3),
    };
  }

  const lastTest = tests.reduce((max, s) => (s.date > max ? s.date : max), tests[0].date);
  const gap = daysBetween(lastTest, ctx.todayStr);
  const studySince = ctx.completed
    .filter((s) => s.date > lastTest && s.studyType !== 'Test')
    .reduce((sum, s) => sum + s.duration, 0);
  if (gap < 14 || studySince < 8 * 3600) return null;

  const severity = gap >= 28 ? 'warning' : 'neutral';
  return {
    id: 'no-recent-tests', category: 'testing', severity,
    text: `Last test ${gap} din pehle tha, aur tab se ${fmt(studySince)} padhai ho chuki hai. Ek test se check karo kitna retain hua.`,
    priority: scorePriority(severity, (gap - 14) / 28),
  };
}

const RULES = [
  ruleConsistency,
  ruleStreak,
  ruleComeback,
  ruleBestDay,
  ruleSkipDay,
  ruleVolumeTrend,
  ruleGoalPace,
  ruleGoalCalibration,
  ruleNeglectedSubject,
  ruleTheoryWithoutPractice,
  ruleTestFrequency,
];

/**
 * Runs every rule, keeps the strongest insights (max MAX_INSIGHTS, capped per
 * category). Returning fewer - or none - is normal: nothing is padded in.
 */
export function generateInsights(now = new Date()) {
  const ctx = buildContext(now);
  if (!ctx) return [];

  const candidates = RULES
    .map((rule) => {
      try {
        return rule(ctx);
      } catch (err) {
        console.warn(`[insights] ${rule.name} failed`, err); // one broken rule must not kill the feed
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority);

  const categoryCounts = {};
  const selected = [];
  for (const insight of candidates) {
    if (selected.length >= MAX_INSIGHTS) break;
    const cap = CATEGORY_CAP[insight.category] ?? 1;
    const used = categoryCounts[insight.category] || 0;
    if (used >= cap) continue;
    categoryCounts[insight.category] = used + 1;
    selected.push(insight);
  }
  return selected;
}
