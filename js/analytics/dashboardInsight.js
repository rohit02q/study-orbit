import { generateInsights } from './insights.js';
import { generateSleepInsights } from './sleepInsights.js';
import { getTodoStats } from '../features/todos.js';

const SEVERITY_RANK = { critical: 0, warning: 1, good: 2, excellent: 2, neutral: 3 };

/** The one dashboard-specific candidate not already covered by the study/sleep engines. */
function ruleOverdueTasks(now) {
  const stats = getTodoStats(now);
  if (stats.overdueCount === 0) return null;
  return {
    id: 'overdue-tasks',
    severity: 'warning',
    text: `You have ${stats.overdueCount} overdue task${stats.overdueCount === 1 ? '' : 's'}. Worth clearing ${stats.overdueCount === 1 ? 'it' : 'a couple'} today.`,
  };
}

/**
 * Picks the single most useful thing to say to the user right now, pulled
 * from the SAME rule engines that power the Analytics and Sleep pages —
 * never a static/generic message. Warnings surface first (most actionable),
 * then encouraging observations, then neutral facts. Returns null when
 * nothing applies yet (e.g. a brand-new user with no data logged).
 */
export function getTopDashboardInsight(now = new Date()) {
  const candidates = [ruleOverdueTasks(now), ...generateInsights(now), ...generateSleepInsights(now)].filter(Boolean);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return candidates[0];
}
