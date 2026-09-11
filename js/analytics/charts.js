// Hardcoded to match css/tokens.css — Chart.js configs can't read CSS
// variables directly, so these must be kept in sync by hand if the palette changes.
const CHART_COLORS = {
  text: '#E7EAF0',
  textMuted: '#8A94A6',
  textFaint: '#5B6273',
  grid: 'rgba(38, 45, 58, 0.6)',
  ember: '#F0A857',
  emberFill: 'rgba(240, 168, 87, 0.15)',
  signal: '#63D2C4',
  surfaceRaised: '#1E2530',
};

const registry = new Map();

/** Destroys any existing chart on this canvas id, then creates a fresh one. Never leaks. */
export function renderChart(canvasId, config) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof window.Chart === 'undefined') return null;
  const instance = new window.Chart(canvas.getContext('2d'), config);
  registry.set(canvasId, instance);
  return instance;
}

export function destroyChart(canvasId) {
  const existing = registry.get(canvasId);
  if (existing) {
    existing.destroy();
    registry.delete(canvasId);
  }
}

/** Called on route leave — the router's onLeave hook is the single place this must run. */
export function destroyAllCharts() {
  registry.forEach((chart) => chart.destroy());
  registry.clear();
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function animationConfig() {
  return prefersReducedMotion() ? false : { duration: 400 };
}

function tooltipTheme() {
  return {
    backgroundColor: CHART_COLORS.surfaceRaised,
    titleColor: CHART_COLORS.text,
    bodyColor: CHART_COLORS.text,
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    displayColors: false,
  };
}

export function buildLineChartConfig(labels, dataPoints, { label = 'Hours studied' } = {}) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label,
          data: dataPoints,
          borderColor: CHART_COLORS.ember,
          backgroundColor: CHART_COLORS.emberFill,
          tension: 0.3,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: CHART_COLORS.ember,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipTheme() },
      scales: {
        x: { ticks: { color: CHART_COLORS.textFaint }, grid: { color: 'transparent' } },
        y: { ticks: { color: CHART_COLORS.textFaint }, grid: { color: CHART_COLORS.grid }, beginAtZero: true },
      },
      animation: animationConfig(),
    },
  };
}

export function buildDonutChartConfig(labels, dataPoints, colors) {
  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: dataPoints, backgroundColor: colors, borderColor: CHART_COLORS.surfaceRaised, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: CHART_COLORS.textMuted, boxWidth: 10, padding: 12 } },
        tooltip: { ...tooltipTheme(), displayColors: true },
      },
      animation: animationConfig(),
    },
  };
}

function formatHourLabel(value) {
  const h = Math.floor(((value % 24) + 24) % 24);
  const m = Math.round((value - Math.floor(value)) * 60);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}${m > 0 ? ':' + String(m).padStart(2, '0') : ''}${period}`;
}

/**
 * Floating-bar chart for a nightly time range (e.g. bedtime -> wake time).
 * `ranges` is an array of [startHour, endHour] decimal-hour pairs, or null
 * for a night with no data (Chart.js skips a null bar cleanly).
 */
export function buildFloatingBarChartConfig(labels, ranges, { color = CHART_COLORS.signal } = {}) {
  return {
    type: 'bar',
    data: { labels, datasets: [{ data: ranges, backgroundColor: color, borderRadius: 4, barThickness: 14 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipTheme(),
          callbacks: {
            label: (ctx) => {
              const range = ctx.raw;
              if (!range) return 'No data';
              return `${formatHourLabel(range[0])} \u2192 ${formatHourLabel(range[1])}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: CHART_COLORS.textFaint }, grid: { color: 'transparent' } },
        y: {
          min: 0,
          max: 32,
          ticks: { color: CHART_COLORS.textFaint, stepSize: 4, callback: (v) => formatHourLabel(v) },
          grid: { color: CHART_COLORS.grid },
        },
      },
      animation: animationConfig(),
    },
  };
}

/** Simple line chart for a single hour-of-day series (bedtime trend, wake-up trend). */
export function buildHourOfDayLineChartConfig(labels, hourValues, { color = CHART_COLORS.ember } = {}) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data: hourValues,
          borderColor: color,
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: color,
          borderWidth: 2,
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipTheme(), callbacks: { label: (ctx) => (ctx.raw == null ? 'No data' : formatHourLabel(ctx.raw)) } },
      },
      scales: {
        x: { ticks: { color: CHART_COLORS.textFaint }, grid: { color: 'transparent' } },
        y: { ticks: { color: CHART_COLORS.textFaint, callback: (v) => formatHourLabel(v) }, grid: { color: CHART_COLORS.grid } },
      },
      animation: animationConfig(),
    },
  };
}

