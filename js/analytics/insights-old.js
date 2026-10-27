import { getSettings } from '../core/store.js';
import { listSubjects, getSubject } from '../features/subjects.js';
import { getCompletedSessions, computeStreaks } from './stats.js';
import {
  todayDateString,
  dateStringDaysAgo,
  addDaysToDateString,
  isDateOnOrAfter,
  isDateInRange,
  getCalendarWeekStart,
  formatDuration,
} from '../core/utils.js';

const MS_PER_DAY = 86_400_000;
const MAX_INSIGHTS = 7;

// Base weights — the *starting* point for priority, not the final word.
// Final ranking blends this with how statistically significant an insight
// is and how much data backs it, so a strong "good" insight can outrank a
// marginal "warning".
const SEVERITY_WEIGHT = { critical: 100, warning: 78, excellent: 66, good: 56, neutral: 32 };

// Every category has a cap on how many of its insights can appear at once.
// This is what stops the feed from reading like the same observation said
// three different ways (e.g. three separate "you're consistent" notes).
const CATEGORY_CAP = { pace: 1, habit: 2, subjects: 2, balance: 1, testing: 1, quality: 1 };

/* --------------------------------- Math helpers -------------------------------- */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Ordinary least-squares fit over {x, y} points. Returns null when there
// isn't enough data, or the x-values don't vary (a line needs a slope).
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
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// A percentage change that refuses to explode when the baseline is tiny.
// An unguarded ratio is exactly what produces nonsense like "up 2,883%" —
// it just means the previous number was close to zero.
function safeRatioChange(current, previous, minBaseline) {
  if (previous < minBaseline) return null;
  return ((current - previous) / previous) * 100;
}

function scorePriority(severity, magnitude01 = 0, confidence01 = 0) {
  const base = SEVERITY_WEIGHT[severity] ?? 30;
  const magnitudeBonus = clamp(magnitude01, 0, 1) * 34;
  const confidenceBonus = clamp(confidence01, 0, 1) * 16;
  return Math.round(base + magnitudeBonus + confidenceBonus);
}

/* ------------------------------- Data helpers ---------------------------------- */

// A rolling 7-day window, `weeksAgo` weeks back from today (0 = this week).
function getWeekWindow(weeksAgo, now) {
  return {
    start: dateStringDaysAgo(7 * weeksAgo + 6, now),
    end: dateStringDaysAgo(7 * weeksAgo, now),
  };
}

function earliestSessionDate(completed) {
  return completed.reduce((min, s) => (s.date < min ? s.date : min), completed[0].date);
}

function weekdayName(dateString) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
}

/* ---------------------------------- Rules --------------------------------------- */

// Habit trend: fits a line through the last up-to-4 rolling weekly
// active-day counts instead of comparing two windows as a single ratio.
// A regression is far more resistant to one unusually good/bad week being
// mistaken for a real trend, and weeks that predate the user's first-ever
// session are excluded so early history doesn't look like a "decline".
function ruleConsistencyTrend(now) {
  const completed = getCompletedSessions();
  if (completed.length === 0) return null;
  const firstDate = earliestSessionDate(completed);

  const series = [];
  for (let w = 0; w < 4; w += 1) {
    const { start, end } = getWeekWindow(w, now);
    if (end < firstDate) break; // window predates any activity — stop here
    const activeDays = new Set(
      completed.filter((s) => isDateInRange(s.date, start, end)).map((s) => s.date)
    ).size;
    series.push({ x: -w, y: activeDays });
  }
  if (series.length === 0) return null;
  const thisWeekDays = series[0].y;

  // Not enough weeks of history yet to talk about a trend — report state instead.
  if (series.length < 3) {
    if (thisWeekDays <= 2) {
      return {
        id: 'consistency-low', category: 'habit', severity: 'warning',
        text: `Is hafte abhi tak sirf ${thisWeekDays} din hi padhai hui hai. Aaj ek session daal do, warna momentum tootne laga hai.`,
        priority: scorePriority('warning', (3 - thisWeekDays) / 3, 0.3),
      };
    }
    if (thisWeekDays >= 6) {
      return {
        id: 'consistency-excellent', category: 'habit', severity: 'excellent',
        text: `Pichhle 7 mein se ${thisWeekDays} din padhai ki hai — consistency ekdum solid hai. Yahi rakhna.`,
        priority: scorePriority('excellent', thisWeekDays / 7, 0.3),
      };
    }
    return null;
  }

  const fit = linearRegression(series);
  const confidence = clamp(series.length / 4, 0, 1);

  if (fit && Math.abs(fit.slope) >= 0.35) {
    const improving = fit.slope > 0;
    const magnitude = clamp(Math.abs(fit.slope) / 2, 0, 1);
    return {
      id: improving ? 'consistency-up' : 'consistency-down',
      category: 'habit',
      severity: improving ? 'good' : 'warning',
      text: improving
        ? `Pichhle kuch hafton se tumhari consistency lagatar upar ja rahi hai — is hafte ${thisWeekDays} active din ho chuke hain. Graph sahi direction mein hai.`
        : `Pichhle kuch hafton se consistency neeche gir rahi hai — is hafte sirf ${thisWeekDays} active din. Ye pattern bann raha hai, ise abhi pakadna zaroori hai.`,
      priority: scorePriority(improving ? 'good' : 'warning', magnitude, confidence),
    };
  }

  if (thisWeekDays >= 6) {
    return {
      id: 'consistency-excellent', category: 'habit', severity: 'excellent',
      text: `${thisWeekDays} din is hafte, aur ye pichhle kai hafton se steady chal raha hai. Habit ban chuki hai — solid.`,
      priority: scorePriority('excellent', thisWeekDays / 7, confidence),
    };
  }
  if (thisWeekDays <= 2) {
    return {
      id: 'consistency-low', category: 'habit', severity: 'warning',
      text: `Is hafte sirf ${thisWeekDays} din padhai hui, aur pichhle hafton mein bhi yahi haal tha. Consistency kaafi time se struggle kar rahi hai — is par dhyan dena zaroori hai.`,
      priority: scorePriority('warning', (3 - thisWeekDays) / 3, confidence),
    };
  }
  return null;
}

function ruleStreak(now) {
  const completed = getCompletedSessions();
  const { current, longest } = computeStreaks(completed, now);
  if (current < 3) return null;

  const isPersonalBest = current === longest && longest > 3;
  const magnitude = clamp(current / 14, 0, 1); // a 2-week streak already reads as "maxed out"
  return {
    id: isPersonalBest ? 'streak-best' : 'streak-active',
    category: 'habit',
    severity: isPersonalBest ? 'excellent' : 'good',
    text: isPersonalBest
      ? `${current} din ka streak chal raha hai — ye tumhara ab tak ka sabse lamba hai. Jo bhi kar rahe ho, waisa hi karte raho.`
      : `${current} din ka study streak chal raha hai. Isko tootne mat dena.`,
    priority: scorePriority(isPersonalBest ? 'excellent' : 'good', magnitude, 0.8),
  };
}

// Strongest day, based on each weekday's *average* session length (so a
// weekday that simply occurs more often doesn't automatically look
// "stronger"), reported as a share of the week rather than a ratio against
// the runner-up. A ratio explodes whenever the runner-up happens to be
// small — that's exactly what produced the "+1,360%" bug.
function ruleStrongestDay() {
  const completed = getCompletedSessions();
  if (completed.length < 6) return null;

  const totalsByDay = new Map();
  const countsByDay = new Map();
  completed.forEach((s) => {
    const day = weekdayName(s.date);
    totalsByDay.set(day, (totalsByDay.get(day) || 0) + s.duration);
    countsByDay.set(day, (countsByDay.get(day) || 0) + 1);
  });
  if (totalsByDay.size < 3) return null; // need real spread across days

  const averages = Array.from(totalsByDay.keys()).map((day) => ({
    day,
    avg: totalsByDay.get(day) / countsByDay.get(day),
  }));

  const avgValues = averages.map((a) => a.avg);
  const m = mean(avgValues);
  const sd = stdDev(avgValues);
  if (sd === 0) return null; // every day looks identical

  const top = averages.reduce((best, a) => (a.avg > best.avg ? a : best));
  const zScore = (top.avg - m) / sd;
  if (zScore < 0.8) return null; // not meaningfully ahead of the rest

  const grandTotal = Array.from(totalsByDay.values()).reduce((a, b) => a + b, 0);
  const sharePercent = Math.round((totalsByDay.get(top.day) / grandTotal) * 100);

  return {
    id: 'strongest-day', category: 'habit', severity: 'neutral',
    text: `${top.day} tumhara sabse strong din hai — average ${formatDuration(top.avg)} per session, aur weekly total ka karib ${sharePercent}% isi din se aata hai. Sabse tough topic isi din rakho.`,
    priority: scorePriority('neutral', clamp(zScore / 3, 0, 1), clamp(completed.length / 20, 0, 1)),
  };
}

function ruleSubjectDominance() {
  const completed = getCompletedSessions();
  const totals = new Map();
  completed.forEach((s) => totals.set(s.subjectId, (totals.get(s.subjectId) || 0) + s.duration));
  if (totals.size < 2) return null;

  const grandTotal = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  if (grandTotal === 0) return null;

  let dominantId = null;
  let dominantPercent = 0;
  totals.forEach((seconds, id) => {
    const pct = (seconds / grandTotal) * 100;
    if (pct > dominantPercent) {
      dominantPercent = pct;
      dominantId = id;
    }
  });
  if (dominantPercent < 50) return null;

  const subject = getSubject(dominantId);
  const roundedPct = Math.round(dominantPercent);
  const severity = dominantPercent >= 70 ? 'warning' : 'neutral';
  return {
    id: 'subject-dominance', category: 'subjects', severity,
    text: severity === 'warning'
      ? `${subject?.name || 'Ek subject'} akela hi ${roundedPct}% study time le raha hai. Baaki subjects peeche reh sakte hain — balance thoda check kar lena.`
      : `${subject?.name || 'Ek subject'} tumhare schedule par haavi hai — total study time ka ${roundedPct}%.`,
    priority: scorePriority(severity, (dominantPercent - 50) / 50, clamp(completed.length / 15, 0, 1)),
  };
}

// Reports the single most-overdue subject (largest gap), not just the
// first one found — so the insight always points at the real priority.
function ruleNeglectedSubject(now) {
  const completed = getCompletedSessions();
  if (completed.length === 0) return null;
  const todayStr = todayDateString(now);

  let worst = null;
  for (const subject of listSubjects()) {
    const subjectSessions = completed.filter((s) => s.subjectId === subject.id);
    if (subjectSessions.length === 0) continue; // never started isn't "neglected"
    const lastDate = subjectSessions.reduce((max, s) => (s.date > max ? s.date : max), subjectSessions[0].date);
    const gapDays = Math.round((new Date(`${todayStr}T00:00:00`) - new Date(`${lastDate}T00:00:00`)) / MS_PER_DAY);
    if (gapDays >= 5 && (!worst || gapDays > worst.gapDays)) {
      worst = { subject, gapDays };
    }
  }
  if (!worst) return null;

  const severity = worst.gapDays >= 12 ? 'critical' : 'warning';
  return {
    id: `neglected-${worst.subject.id}`, category: 'subjects', severity,
    text: severity === 'critical'
      ? `${worst.subject.name} ko ${worst.gapDays} din se haath nahi lagaya — ye ab ignore karne layak nahi raha, jald wapas lauto.`
      : `${worst.subject.name} ko ${worst.gapDays} din se touch nahi kiya. Ab wapas laut aana chahiye.`,
    priority: scorePriority(severity, clamp(worst.gapDays / 20, 0, 1), 0.6),
  };
}

function ruleTheoryPracticeBalance() {
  const completed = getCompletedSessions();
  if (completed.length < 4) return null;

  const total = completed.reduce((sum, s) => sum + s.duration, 0);
  if (total === 0) return null;

  const theorySeconds = completed.filter((s) => s.studyType === 'Theory' || s.studyType === 'Lecture').reduce((sum, s) => sum + s.duration, 0);
  const practiceSeconds = completed.filter((s) => s.studyType === 'Practice' || s.studyType === 'PYQ').reduce((sum, s) => sum + s.duration, 0);
  const theoryPct = (theorySeconds / total) * 100;
  const practicePct = (practiceSeconds / total) * 100;

  if (theoryPct >= 60 && practicePct <= 20) {
    return {
      id: 'theory-heavy', category: 'balance', severity: 'warning',
      text: `${Math.round(theoryPct)}% time theory mein ja raha hai lekin practice sirf ${Math.round(practicePct)}%. Thode aur problem-solving sessions daalo, balance banega.`,
      priority: scorePriority('warning', (theoryPct - 60) / 40, clamp(completed.length / 15, 0, 1)),
    };
  }
  if (practicePct >= 60 && theoryPct <= 15 && total >= 3600 * 3) {
    return {
      id: 'practice-heavy', category: 'balance', severity: 'neutral',
      text: `Practice pe zyada zor hai (${Math.round(practicePct)}%) aur theory kaafi kam (${Math.round(theoryPct)}%). Agar basics clear hain to theek hai, warna thodi theory se concepts aur pakke honge.`,
      priority: scorePriority('neutral', (practicePct - 60) / 40, clamp(completed.length / 15, 0, 1)),
    };
  }
  return null;
}

function ruleTestFrequency(now) {
  const completed = getCompletedSessions();
  if (completed.length < 4) return null;

  const todayStr = todayDateString(now);
  const testSessions = completed.filter((s) => s.studyType === 'Test');

  if (testSessions.length === 0) {
    if (completed.length >= 8) {
      return {
        id: 'no-tests-yet', category: 'testing', severity: 'neutral',
        text: 'Abhi tak koi test session log nahi hui hai. Khud ko test karna sabse tez tareeka hai ye jaanne ka ki kitna actually yaad reh raha hai.',
        priority: scorePriority('neutral', 0.3, clamp(completed.length / 20, 0, 1)),
      };
    }
    return null;
  }

  const lastTestDate = testSessions.reduce((max, s) => (s.date > max ? s.date : max), testSessions[0].date);
  const gapDays = Math.round((new Date(`${todayStr}T00:00:00`) - new Date(`${lastTestDate}T00:00:00`)) / MS_PER_DAY);
  if (gapDays < 14) return null;

  const severity = gapDays >= 21 ? 'warning' : 'neutral';
  return {
    id: 'no-recent-tests', category: 'testing', severity,
    text: `Last test session ko ${gapDays} din ho gaye. Ek quick self-test abhi kaafi kuch bata dega ki tayyari kahan khadi hai.`,
    priority: scorePriority(severity, clamp((gapDays - 14) / 21, 0, 1), 0.6),
  };
}

// Session-length trend, guarded so a small previous-week average can't turn
// a modest absolute change into a triple-digit percentage swing.
function ruleSessionQualityTrend(now) {
  const completed = getCompletedSessions();
  const { start: thisStart, end: thisEnd } = getWeekWindow(0, now);
  const { start: prevStart, end: prevEnd } = getWeekWindow(1, now);

  const thisWeek = completed.filter((s) => isDateInRange(s.date, thisStart, thisEnd));
  const prevWeek = completed.filter((s) => isDateInRange(s.date, prevStart, prevEnd));
  if (thisWeek.length < 2 || prevWeek.length < 2) return null;

  const avgThis = mean(thisWeek.map((s) => s.duration));
  const avgPrev = mean(prevWeek.map((s) => s.duration));

  const changePct = safeRatioChange(avgThis, avgPrev, 180); // ignore baselines under 3 minutes
  if (changePct === null || Math.abs(changePct) < 10) return null;

  const improving = changePct > 0;
  const magnitude = clamp(Math.abs(changePct) / 100, 0, 1);
  const confidence = clamp((thisWeek.length + prevWeek.length) / 12, 0, 1);
  return {
    id: 'session-quality-trend', category: 'quality', severity: improving ? 'good' : 'warning',
    text: improving
      ? `Average focus session ${formatDuration(avgPrev)} se badhkar ${formatDuration(avgThis)} ho gaya hai is hafte. Focus lamba ho raha hai — badhiya sign hai.`
      : `Average focus session ${formatDuration(avgPrev)} se ghatkar ${formatDuration(avgThis)} reh gaya hai is hafte. Sessions chhote ho rahe hain, thoda dhyan do.`,
    priority: scorePriority(improving ? 'good' : 'warning', magnitude, confidence),
  };
}

// Goal pace, projected with a shrinkage estimator: blend a naive "keep
// going at today's rate" extrapolation with a pattern-based estimate built
// from historical performance on the specific weekdays still to come.
// Early in the week — where a single long session would otherwise send the
// naive number into orbit — the pattern-based estimate dominates; later in
// the week, the actual pace takes over. This is what keeps the projection
// from ever reading "2,883% of your goal" off one strong Monday.
function ruleGoalProjection(now) {
  const settings = getSettings();
  const weeklyGoalSeconds = (settings.weeklyGoalMinutes || 0) * 60;
  if (weeklyGoalSeconds === 0) return null;

  const weekStart = getCalendarWeekStart(now);
  const todayStr = todayDateString(now);
  const completed = getCompletedSessions();

  const weekSecondsSoFar = completed
    .filter((s) => isDateInRange(s.date, weekStart, todayStr))
    .reduce((sum, s) => sum + s.duration, 0);
  if (weekSecondsSoFar === 0) return null;

  const elapsedDays = Math.round((new Date(`${todayStr}T00:00:00`) - new Date(`${weekStart}T00:00:00`)) / MS_PER_DAY) + 1;
  const remainingDays = Math.max(0, 7 - elapsedDays);

  const dailyTotals = completed.reduce((map, s) => map.set(s.date, (map.get(s.date) || 0) + s.duration), new Map());
  const overallDailyAvg = mean(Array.from(dailyTotals.values()));

  let estimatedRemaining = 0;
  for (let i = 1; i <= remainingDays; i += 1) {
    const futureDate = addDaysToDateString(todayStr, i);
    const targetWeekday = weekdayName(futureDate);
    const priorOccurrences = completed
      .filter((s) => s.date < todayStr && weekdayName(s.date) === targetWeekday)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-6);
    estimatedRemaining += priorOccurrences.length
      ? mean(priorOccurrences.map((s) => s.duration))
      : overallDailyAvg;
  }

  const naiveProjection = (weekSecondsSoFar / elapsedDays) * 7;
  const patternProjection = weekSecondsSoFar + estimatedRemaining;

  // Trust in "today's rate" grows through the week; clamp so neither
  // estimate is ever taken fully on faith.
  const confidence = clamp(elapsedDays / 7, 0.15, 0.85);
  const blendedProjection = confidence * naiveProjection + (1 - confidence) * patternProjection;
  const projectedPercent = Math.round((blendedProjection / weeklyGoalSeconds) * 100);

  let text;
  let severity;
  if (projectedPercent >= 160) {
    severity = 'excellent';
    text = `Is hafte pace kaafi aage hai — weekly goal comfortably clear hone wala hai, extra margin ke saath.`;
  } else if (projectedPercent >= 100) {
    severity = 'excellent';
    text = `Isi pace pe chalte rahe to weekly goal ka karib ${projectedPercent}% pura ho jayega. Badhiya chal raha hai.`;
  } else if (projectedPercent >= 75) {
    severity = 'good';
    text = `Isi pace pe weekly goal ka karib ${projectedPercent}% tak pahunchoge — kaafi paas ho, bas ek final push chahiye.`;
  } else if (projectedPercent >= 50) {
    severity = 'neutral';
    text = `Abhi ke pace pe weekly goal ka karib ${projectedPercent}% hi ban raha hai. Aage ke din thode zyada mehnat maangte hain.`;
  } else {
    severity = 'warning';
    text = `Isi pace pe weekly goal ka sirf ${projectedPercent}% hi pura hoga. Agle kuch dinon mein thoda zyada time dena padega, warna goal miss ho sakta hai.`;
  }

  const magnitude = clamp(Math.abs(projectedPercent - 100) / 100, 0, 1);
  return {
    id: 'goal-projection', category: 'pace', severity, text,
    priority: scorePriority(severity, magnitude, confidence),
  };
}

const RULES = [
  ruleConsistencyTrend,
  ruleStreak,
  ruleStrongestDay,
  ruleSubjectDominance,
  ruleNeglectedSubject,
  ruleTheoryPracticeBalance,
  ruleTestFrequency,
  ruleSessionQualityTrend,
  ruleGoalProjection,
];

/**
 * Runs every rule against current data, scores each resulting insight by a
 * blend of severity, statistical significance, and how much data backs it,
 * then keeps the strongest ones — capped per category so the feed never
 * repeats the same observation twice, and capped overall at MAX_INSIGHTS.
 * Returning fewer than that is normal: nothing is padded in just to fill
 * space if there isn't a genuinely useful insight left to show.
 */
export function generateInsights(now = new Date()) {
  const candidates = RULES.map((rule) => rule(now)).filter(Boolean);
  candidates.sort((a, b) => b.priority - a.priority);

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
