import { getDashboardSnapshot } from '../analytics/stats.js';
import { getTopDashboardInsight } from '../analytics/dashboardInsight.js';
import { getSettings } from '../core/store.js';
import { formatDuration, todayDateString } from '../core/utils.js';
import { renderEmptyState } from './emptyStates.js';
import { SEVERITY_ICON } from './insightCards.js';

export function renderDashboardPage(container) {
  container.innerHTML = '';

  const settings = getSettings();
  const greetingName = settings.displayName?.trim() || 'User';
  const topInsight = getTopDashboardInsight();

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Hi, ${greetingName}</h2>
      ${
        topInsight
          ? `<div class="dashboard-insight insight-card insight-${topInsight.severity}">
               <i data-lucide="${SEVERITY_ICON[topInsight.severity]}"></i><span>${topInsight.text}</span>
             </div>`
          : `<div class="page-header-sub">Your study activity at a glance.</div>`
      }
    </div>
  `;
  container.appendChild(header);

  const snapshot = getDashboardSnapshot();

  if (!snapshot.hasAnyData) {
    container.appendChild(
      renderEmptyState({
        icon: '<i data-lucide="layout-dashboard"></i>',
        heading: 'Your productivity journey starts with one focused session.',
        body: 'Once you log study sessions, this page will show today\u2019s totals, your streak, and a weekly overview.',
        actionLabel: 'Start a session',
        onAction: () => (window.location.hash = '/timer'),
      })
    );
    window.lucide?.createIcons();
    return;
  }

  container.appendChild(buildHeroStats(snapshot));

  const twoCol = document.createElement('div');
  twoCol.className = 'two-col-grid';
  twoCol.appendChild(buildTodayCard(snapshot));
  twoCol.appendChild(buildWeeklyCard(snapshot));
  container.appendChild(twoCol);

  container.appendChild(buildSubjectDistributionCard(snapshot));

  window.lucide?.createIcons();
}

function buildHeroStats(snapshot) {
  const grid = document.createElement('div');
  grid.className = 'hero-stats-grid';

  const goalFillWidth = Math.min(100, Math.max(0, snapshot.dailyGoalPercent));
  const goalOverGoal = snapshot.dailyGoalPercent >= 100;

  grid.innerHTML = `
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="clock"></i> Today</div>
      <div class="stat-card-value">${formatDuration(snapshot.todaySeconds)}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="calendar-days"></i> This week</div>
      <div class="stat-card-value">${formatDuration(snapshot.weekSeconds)}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="calendar"></i> This month</div>
      <div class="stat-card-value">${formatDuration(snapshot.monthSeconds)}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="flame"></i> Streak</div>
      <div class="stat-card-value">${snapshot.streak.current} day${snapshot.streak.current === 1 ? '' : 's'}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="target"></i> Daily goal</div>
      <div class="stat-card-value">${goalOverGoal ? 'Reached' : `${goalFillWidth}%`}</div>
      <div class="goal-progress-track"><div class="goal-progress-fill" style="width:${goalFillWidth}%; ${goalOverGoal ? 'background: var(--color-ember);' : ''}"></div></div>
    </div>
  `;
  return grid;
}

function buildTodayCard(snapshot) {
  const card = document.createElement('div');
  card.className = 'card section-card';
  const { today } = snapshot;

  const timelineHtml =
    today.timeline.length === 0
      ? `<div style="color: var(--color-text-faint); font-size: 13px; margin-bottom: var(--space-4);">No sessions logged yet today.</div>`
      : `<div class="timeline-list">${today.timeline
          .map((s) => {
            const start = new Date(s.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            const isActive = s.status !== 'completed';
            return `
              <div class="timeline-item">
                <span class="timeline-time">${start}</span>
                <span class="timeline-subject">${s.studyType}${isActive ? ' \u2014 in progress' : ''}</span>
                <span class="timeline-duration mono">${isActive ? '\u2014' : formatDuration(s.duration)}</span>
              </div>`;
          })
          .join('')}</div>`;

  card.innerHTML = `
    <h3 class="font-display">Today\u2019s overview</h3>
    ${timelineHtml}
    <div class="mini-stat-row"><span class="label">Sessions today</span><span class="value">${today.sessionCount}</span></div>
    <div class="mini-stat-row"><span class="label">Most studied subject</span><span class="value">${today.mostStudiedSubject?.subject?.name || '\u2014'}</span></div>
    <div class="mini-stat-row"><span class="label">Most productive type</span><span class="value">${today.mostProductiveType?.key || '\u2014'}</span></div>
    <div class="mini-stat-row"><span class="label">Longest session</span><span class="value">${formatDuration(today.longestSessionSeconds)}</span></div>
  `;
  return card;
}

function buildWeeklyCard(snapshot) {
  const card = document.createElement('div');
  card.className = 'card section-card';
  const { weekly } = snapshot;
  const maxSeconds = Math.max(1, ...weekly.breakdown.map((d) => d.seconds));
  const todayStr = todayDateString();

  const barsHtml = weekly.breakdown
    .map((d) => {
      const heightPercent = Math.max(2, Math.round((d.seconds / maxSeconds) * 100));
      return `
        <div class="weekly-bar-col" title="${d.label}: ${formatDuration(d.seconds)}">
          <div class="weekly-bar-value">${d.seconds > 0 ? formatDuration(d.seconds) : ''}</div>
          <div class="weekly-bar${d.date === todayStr ? ' is-today' : ''}" style="height:${heightPercent}%"></div>
          <div class="weekly-bar-label">${d.label[0]}</div>
        </div>`;
    })
    .join('');

  card.innerHTML = `
    <h3 class="font-display">Weekly overview</h3>
    <div class="page-header-sub" style="margin: -8px 0 var(--space-3);">Mon\u2013Sun, resets every Monday</div>
    <div class="weekly-bars">${barsHtml}</div>
    <div class="mini-stat-row"><span class="label">Daily average</span><span class="value">${formatDuration(weekly.averageSeconds)}</span></div>
    <div class="mini-stat-row"><span class="label">Best day</span><span class="value">${weekly.bestDay.seconds > 0 ? `${weekly.bestDay.label} \u2014 ${formatDuration(weekly.bestDay.seconds)}` : '\u2014'}</span></div>
    <div class="mini-stat-row"><span class="label">Lightest day</span><span class="value">${weekly.weakestDay.label} \u2014 ${formatDuration(weekly.weakestDay.seconds)}</span></div>
  `;
  return card;
}

function buildSubjectDistributionCard(snapshot) {
  const card = document.createElement('div');
  card.className = 'card section-card';

  if (snapshot.subjectDistribution.length === 0) {
    card.innerHTML = `<h3 class="font-display">Subject distribution</h3><div style="color: var(--color-text-faint); font-size: 13px;">No completed sessions yet.</div>`;
    return card;
  }

  const rowsHtml = snapshot.subjectDistribution
    .map(
      (row) => `
      <div>
        <div class="distribution-row-top">
          <span class="name"><span class="subject-color-dot" style="background:${row.color}"></span>${row.name}</span>
          <span class="value">${formatDuration(row.seconds)} \u00b7 ${row.percent}%</span>
        </div>
        <div class="distribution-bar-track"><div class="distribution-bar-fill" style="width:${row.percent}%; background:${row.color};"></div></div>
      </div>`
    )
    .join('');

  card.innerHTML = `<h3 class="font-display">Subject distribution</h3><div class="distribution-list">${rowsHtml}</div>`;
  return card;
}
