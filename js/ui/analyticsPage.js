import {
  getSubjectDistributionInRange,
  getStudyTypeDistributionInRange,
  getDailyStudySeries,
  getMonthToDateSeries,
  getTodayHourlySeries,
  getCompletedSessions,
} from '../analytics/stats.js';
import { generateInsights } from '../analytics/insights.js';
import { renderChart, destroyAllCharts, buildLineChartConfig, buildDonutChartConfig } from '../analytics/charts.js';
import { renderEmptyState } from './emptyStates.js';
import { buildCustomSelect } from './customSelect.js';
import { renderInsightCardsHtml } from './insightCards.js';
import { todayDateString, dateStringDaysAgo, currentMonthString } from '../core/utils.js';

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
];

const STUDY_TYPE_COLORS = {
  Theory: '#5B8DEF',
  Practice: '#63D2C4',
  PYQ: '#8B7FD6',
  Test: '#E8615F',
  Revision: '#D9C548',
  Lecture: '#4CAF7D',
  Other: '#8A94A6',
};

let currentRange = '7';

export function renderAnalyticsPage(container) {
  currentRange = '7';
  paint(container);
}

/** Router onLeave hook — Chart.js instances must be destroyed or they leak on repeated visits. */
export function leaveAnalyticsPage() {
  destroyAllCharts();
}

function paint(container) {
  destroyAllCharts();
  container.innerHTML = '';

  const hasData = getCompletedSessions().length > 0;

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Analytics</h2>
      <div class="page-header-sub">Trends and Smart Insights from your study history.</div>
    </div>
    ${hasData ? `
      <div class="range-select-wrap">
        <label style="font-size:13px; color:var(--color-text-muted);">Range</label>
        <div id="range-select-slot" style="min-width:160px;"></div>
      </div>` : ''}
  `;
  container.appendChild(header);

  if (!hasData) {
    container.appendChild(
      renderEmptyState({
        icon: '<i data-lucide="bar-chart-3"></i>',
        heading: 'Nothing to analyze yet.',
        body: 'Charts and Smart Insights will appear here once you\u2019ve logged a few sessions.',
        actionLabel: 'Start a session',
        onAction: () => (window.location.hash = '/timer'),
      })
    );
    window.lucide?.createIcons();
    return;
  }

  const chartsSection = document.createElement('div');
  chartsSection.id = 'analytics-charts-section';
  container.appendChild(chartsSection);
  renderChartsIntoSection(chartsSection);

  const rangeSelect = buildCustomSelect({
    value: currentRange,
    options: RANGE_OPTIONS,
    onChange: (value) => {
      currentRange = value;
      renderChartsIntoSection(chartsSection);
    },
  });
  header.querySelector('#range-select-slot').replaceWith(rangeSelect);

  container.appendChild(buildInsightsSection());

  window.lucide?.createIcons();
}

function seriesForCurrentRange() {
  if (currentRange === 'today') return getTodayHourlySeries();
  if (currentRange === '30') return getDailyStudySeries(30);
  if (currentRange === 'month') return getMonthToDateSeries();
  return getDailyStudySeries(7);
}

/** Same range options as the daily chart, expressed as a [startDate, endDate] pair for the two donuts. */
function dateBoundsForCurrentRange() {
  const today = todayDateString();
  if (currentRange === 'today') return { startDate: today, endDate: today };
  if (currentRange === '30') return { startDate: dateStringDaysAgo(29), endDate: today };
  if (currentRange === 'month') return { startDate: `${currentMonthString()}-01`, endDate: today };
  return { startDate: dateStringDaysAgo(6), endDate: today };
}

function renderChartsIntoSection(sectionEl) {
  destroyAllCharts(); // the canvases below are about to be replaced
  sectionEl.innerHTML = `
    <div class="card chart-card">
      <h3 class="font-display">Daily study time</h3>
      <div class="chart-wrap"><canvas id="chart-daily"></canvas></div>
    </div>
    <div class="two-col-grid">
      <div class="card">
        <h3 class="font-display">Subject distribution</h3>
        <div class="chart-wrap-donut"><canvas id="chart-subjects"></canvas></div>
      </div>
      <div class="card">
        <h3 class="font-display">Study type distribution</h3>
        <div class="chart-wrap-donut"><canvas id="chart-types"></canvas></div>
      </div>
    </div>
  `;

  const series = seriesForCurrentRange();
  const labels = series.map((s) => s.label);
  const hours = series.map((s) => Math.round((s.seconds / 3600) * 100) / 100);
  renderChart('chart-daily', buildLineChartConfig(labels, hours));

  const { startDate, endDate } = dateBoundsForCurrentRange();

  const subjectDist = getSubjectDistributionInRange(startDate, endDate);
  renderChart(
    'chart-subjects',
    buildDonutChartConfig(
      subjectDist.map((s) => s.name),
      subjectDist.map((s) => Math.round((s.seconds / 3600) * 100) / 100),
      subjectDist.map((s) => s.color)
    )
  );

  const typeDist = getStudyTypeDistributionInRange(startDate, endDate);
  renderChart(
    'chart-types',
    buildDonutChartConfig(
      typeDist.map((s) => s.type),
      typeDist.map((s) => Math.round((s.seconds / 3600) * 100) / 100),
      typeDist.map((s) => STUDY_TYPE_COLORS[s.type] || '#8A94A6')
    )
  );
}

function buildInsightsSection() {
  const insights = generateInsights();
  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginTop = 'var(--space-4)';

  if (insights.length === 0) {
    card.innerHTML = `
      <h3 class="font-display">Smart Insights</h3>
      <div style="color: var(--color-text-faint); font-size: 13px;">Not enough data yet for meaningful insights. Keep logging sessions.</div>
    `;
    return card;
  }

  const itemsHtml = renderInsightCardsHtml(insights);

  card.innerHTML = `<h3 class="font-display">Smart Insights</h3>${itemsHtml}`;
  return card;
}
