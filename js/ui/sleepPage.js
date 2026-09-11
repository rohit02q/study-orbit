import { listSleepRecords, logSleep, deleteSleepRecord, getSleepStats } from '../features/sleep.js';
import { getSleepDurationSeries, getSleepScheduleSeries, getBedtimeWakeConsistency } from '../analytics/sleepStats.js';
import { generateSleepInsights } from '../analytics/sleepInsights.js';
import { renderChart, destroyAllCharts, buildLineChartConfig, buildFloatingBarChartConfig, buildHourOfDayLineChartConfig } from '../analytics/charts.js';
import { renderInsightCardsHtml } from './insightCards.js';
import { openFormModal, openModal } from './modal.js';
import { showToast } from './toast.js';
import { renderEmptyState } from './emptyStates.js';
import { formatDuration, todayDateString, formatShortDate } from '../core/utils.js';

let containerRef = null;

export function renderSleepPage(container) {
  containerRef = container;
  paint();
}

/** Router onLeave hook — Chart.js instances must be destroyed or they leak on repeated visits. */
export function leaveSleepPage() {
  destroyAllCharts();
}

function paint() {
  destroyAllCharts();
  containerRef.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Sleep</h2>
      <div class="page-header-sub">Track your rest alongside your study time.</div>
    </div>
    <button class="btn btn-primary" id="log-sleep-btn"><i data-lucide="plus"></i> Log sleep</button>
  `;
  containerRef.appendChild(header);
  header.querySelector('#log-sleep-btn').addEventListener('click', openLogModal);

  const stats = getSleepStats();
  const records = listSleepRecords();

  if (!stats.hasData) {
    containerRef.appendChild(
      renderEmptyState({
        icon: '<i data-lucide="moon"></i>',
        heading: 'Start tracking your sleep pattern to discover your schedule.',
        body: 'Log a night\u2019s sleep to see duration and consistency trends over time.',
        actionLabel: 'Log last night',
        onAction: openLogModal,
      })
    );
    window.lucide?.createIcons();
    return;
  }

  containerRef.appendChild(buildStatsRow(stats));

  const chartsSection = buildChartsSection(records);
  containerRef.appendChild(chartsSection);
  if (records.length >= MIN_RECORDS_FOR_CHARTS) renderSleepCharts();

  containerRef.appendChild(buildInsightsSection());
  containerRef.appendChild(buildHistoryCard(records));

  window.lucide?.createIcons();
}

const MIN_RECORDS_FOR_CHARTS = 3;

/** Builds chart markup only — canvases must be attached to the document before Chart.js can bind to them, so rendering happens separately in renderSleepCharts(). */
function buildChartsSection(records) {
  if (records.length < MIN_RECORDS_FOR_CHARTS) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = 'var(--space-4)';
    card.innerHTML = `
      <h3 class="font-display">Charts</h3>
      <div style="color: var(--color-text-faint); font-size: 13px;">
        Insufficient data to show charts yet \u2014 log at least ${MIN_RECORDS_FOR_CHARTS} nights to see trends.
      </div>
    `;
    return card;
  }

  const wrap = document.createElement('div');

  const durationCard = document.createElement('div');
  durationCard.className = 'card chart-card';
  durationCard.innerHTML = `<h3 class="font-display">Sleep duration trend</h3><div class="chart-wrap"><canvas id="chart-sleep-duration"></canvas></div>`;
  wrap.appendChild(durationCard);

  const scheduleCard = document.createElement('div');
  scheduleCard.className = 'card chart-card';
  scheduleCard.innerHTML = `<h3 class="font-display">Sleep schedule</h3><div class="chart-wrap"><canvas id="chart-sleep-schedule"></canvas></div>`;
  wrap.appendChild(scheduleCard);

  const consistencyRow = document.createElement('div');
  consistencyRow.className = 'two-col-grid';
  consistencyRow.innerHTML = `
    <div class="card">
      <h3 class="font-display">Bedtime consistency</h3>
      <div class="chart-wrap-donut"><canvas id="chart-bedtime-consistency"></canvas></div>
    </div>
    <div class="card">
      <h3 class="font-display">Wake-up consistency</h3>
      <div class="chart-wrap-donut"><canvas id="chart-wake-consistency"></canvas></div>
    </div>
  `;
  wrap.appendChild(consistencyRow);

  return wrap;
}

/** Must run AFTER buildChartsSection()'s output is attached to the document — Chart.js binds via document.getElementById. */
function renderSleepCharts() {
  const durationSeries = getSleepDurationSeries(14);
  renderChart(
    'chart-sleep-duration',
    buildLineChartConfig(
      durationSeries.map((d) => d.label),
      durationSeries.map((d) => (d.minutes == null ? null : Math.round((d.minutes / 60) * 100) / 100)),
      { label: 'Hours slept' }
    )
  );

  const scheduleSeries = getSleepScheduleSeries(14);
  renderChart(
    'chart-sleep-schedule',
    buildFloatingBarChartConfig(
      scheduleSeries.map((d) => d.label),
      scheduleSeries.map((d) => (d.bedtimeHour == null ? null : [d.bedtimeHour, d.wakeHour]))
    )
  );

  renderChart(
    'chart-bedtime-consistency',
    buildHourOfDayLineChartConfig(
      scheduleSeries.map((d) => d.label),
      scheduleSeries.map((d) => d.bedtimeHour)
    )
  );

  renderChart(
    'chart-wake-consistency',
    buildHourOfDayLineChartConfig(
      scheduleSeries.map((d) => d.label),
      scheduleSeries.map((d) => d.wakeHour),
      { color: '#63D2C4' }
    )
  );
}

function buildInsightsSection() {
  const insights = generateSleepInsights();
  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginBottom = 'var(--space-4)';

  if (insights.length === 0) {
    card.innerHTML = `
      <h3 class="font-display">Smart Analysis</h3>
      <div style="color: var(--color-text-faint); font-size: 13px;">Log a few more nights for consistency and trend analysis to kick in.</div>
    `;
    return card;
  }

  card.innerHTML = `<h3 class="font-display">Smart Analysis</h3>${renderInsightCardsHtml(insights)}`;
  return card;
}

function minutesToDurationText(minutes) {
  return formatDuration(minutes * 60);
}

function buildStatsRow(stats) {
  const grid = document.createElement('div');
  grid.className = 'hero-stats-grid';
  grid.innerHTML = `
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="moon"></i> Last night</div>
      <div class="stat-card-value">${minutesToDurationText(stats.lastNightMinutes)}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="calendar-days"></i> Weekly average</div>
      <div class="stat-card-value">${minutesToDurationText(stats.weekAvgMinutes)}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="calendar"></i> Monthly average</div>
      <div class="stat-card-value">${minutesToDurationText(stats.monthAvgMinutes)}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="bar-chart-2"></i> All-time average</div>
      <div class="stat-card-value">${minutesToDurationText(stats.avgAllMinutes)}</div>
    </div>
  `;
  return grid;
}

function buildHistoryCard(records) {
  const card = document.createElement('div');
  card.className = 'card section-card';
  card.innerHTML = `<h3 class="font-display">History</h3>`;

  const list = document.createElement('div');
  list.className = 'sleep-list';

  records.forEach((record) => {
    const sleepClock = new Date(record.sleepTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const wakeClock = new Date(record.wakeTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const row = document.createElement('div');
    row.className = 'sleep-row';
    row.innerHTML = `
      <div>
        <div>${formatShortDate(record.date)}</div>
        <div class="sleep-row-times">${sleepClock} \u2192 ${wakeClock}</div>
      </div>
      <div style="display:flex; align-items:center; gap: var(--space-3);">
        <span class="sleep-row-duration mono">${minutesToDurationText(record.durationMinutes)}</span>
        <button class="btn btn-ghost" data-action="delete" style="color: var(--color-danger); padding:6px;" aria-label="Delete record">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    `;
    row.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete(record));
    list.appendChild(row);
  });

  card.appendChild(list);
  return card;
}

function openLogModal() {
  openFormModal({
    title: 'Log sleep',
    submitLabel: 'Save',
    fields: [
      { type: 'date', name: 'date', label: 'Night of', value: todayDateString(), required: true },
      { type: 'time', name: 'sleepClock', label: 'Sleep time', value: '23:00', required: true },
      { type: 'time', name: 'wakeClock', label: 'Wake time', value: '07:00', required: true },
    ],
    onSubmit: (values) => {
      const outcome = logSleep(values);
      if (outcome.ok) {
        showToast('Sleep logged.', 'success');
        paint();
      }
      return outcome;
    },
  });
}

function confirmDelete(record) {
  openModal({
    title: `Delete sleep record for ${record.date}?`,
    body: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      deleteSleepRecord(record.id);
      showToast('Record deleted.', 'success');
      paint();
    },
  });
}
