/**
 * Renders a dashed-border invitation-to-act card. Copy speaks from the
 * interface's voice: what's missing and what to do about it — no filler.
 * @param {{ icon: string, heading: string, body: string, actionLabel?: string, onAction?: () => void }} opts
 */
export function renderEmptyState({ icon, heading, body, actionLabel, onAction }) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';
  wrap.innerHTML = `
    <div class="empty-state-icon">${icon}</div>
    <h3>${heading}</h3>
    <p>${body}</p>
    ${actionLabel ? `<button class="btn btn-primary" style="margin-top: 4px;">${actionLabel}</button>` : ''}
  `;
  if (actionLabel && onAction) {
    wrap.querySelector('button').addEventListener('click', onAction);
  }
  return wrap;
}
