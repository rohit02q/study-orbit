export const SEVERITY_ICON = {
  excellent: 'trending-up',
  good: 'thumbs-up',
  neutral: 'info',
  warning: 'alert-triangle',
  critical: 'alert-octagon',
};

export function renderInsightCardsHtml(insights) {
  return insights
    .map((i) => `<div class="insight-card insight-${i.severity}"><i data-lucide="${SEVERITY_ICON[i.severity]}"></i><span>${i.text}</span></div>`)
    .join('');
}
