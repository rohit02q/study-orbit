import { buildCustomSelect } from './customSelect.js';

let activeOverlay = null;

/**
 * @param {{ title: string, body: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean, onConfirm?: () => void }} options
 */
export function openModal({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm }) {
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">${title}</h2>
      <p>${body}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="cancel">${cancelLabel}</button>
        <button class="btn ${danger ? 'btn-secondary' : 'btn-primary'}" data-action="confirm"
          style="${danger ? 'color: var(--color-danger); border-color: var(--color-danger-dim);' : ''}">
          ${confirmLabel}
        </button>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', closeModal);
  overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
    onConfirm?.();
    closeModal();
  });

  document.addEventListener('keydown', escListener);
  document.body.appendChild(overlay);
  activeOverlay = overlay;
}

function escListener(e) {
  if (e.key === 'Escape') closeModal();
}

export function closeModal() {
  if (!activeOverlay) return;
  activeOverlay.remove();
  activeOverlay = null;
  document.removeEventListener('keydown', escListener);
}

/**
 * Generic form modal, reused by every "add/edit X" flow across features.
 * @param {{
 *   title: string,
 *   fields: Array<
 *     | { type: 'text', name: string, label: string, value?: string, placeholder?: string, required?: boolean }
 *     | { type: 'color', name: string, label: string, value?: string, options: string[] }
 *     | { type: 'select', name: string, label: string, value?: string, options: Array<{value:string,label:string}> }
 *   >,
 *   submitLabel?: string,
 *   onSubmit: (values: Record<string,string>) => { ok: boolean, errors?: string[] } | Promise<{ok:boolean, errors?:string[]}>
 * }} config
 */
export function openFormModal({ title, fields, submitLabel = 'Save', onSubmit }) {
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const fieldsHtml = fields
    .map((field) => {
      if (field.type === 'color') {
        const swatches = field.options
          .map(
            (hex) => `
            <button type="button" class="color-swatch" data-color="${hex}"
              style="background:${hex}; ${hex === field.value ? 'outline: 2px solid var(--color-text); outline-offset: 2px;' : ''}"
              aria-label="${hex}"></button>`
          )
          .join('');
        return `
          <div class="form-field">
            <label>${field.label}</label>
            <div class="color-swatch-row" data-field="${field.name}">${swatches}</div>
            <input type="hidden" name="${field.name}" value="${field.value || field.options[0]}" />
          </div>`;
      }
      if (field.type === 'select') {
        return `
          <div class="form-field">
            <label>${field.label}</label>
            <div class="custom-select-slot" data-slot="${field.name}"></div>
          </div>`;
      }
      if (field.type === 'date' || field.type === 'time') {
        return `
          <div class="form-field">
            <label for="field-${field.name}">${field.label}</label>
            <input type="${field.type}" id="field-${field.name}" name="${field.name}"
              value="${field.value || ''}" ${field.required ? 'required' : ''} />
          </div>`;
      }
      if (field.type === 'textarea') {
        return `
          <div class="form-field">
            <label for="field-${field.name}">${field.label}</label>
            <textarea id="field-${field.name}" name="${field.name}" rows="${field.rows || 3}"
              placeholder="${field.placeholder || ''}">${field.value || ''}</textarea>
          </div>`;
      }
      return `
        <div class="form-field">
          <label for="field-${field.name}">${field.label}</label>
          <input type="text" id="field-${field.name}" name="${field.name}"
            value="${field.value || ''}" placeholder="${field.placeholder || ''}"
            ${field.required ? 'required' : ''} />
        </div>`;
    })
    .join('');

  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">${title}</h2>
      <form id="modal-form">
        ${fieldsHtml}
        <div class="form-error" id="modal-form-error" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${submitLabel}</button>
        </div>
      </form>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelector('[data-action="cancel"]').addEventListener('click', closeModal);

  overlay.querySelectorAll('.color-swatch-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('.color-swatch');
      if (!btn) return;
      row.querySelectorAll('.color-swatch').forEach((s) => (s.style.outline = 'none'));
      btn.style.outline = '2px solid var(--color-text)';
      btn.style.outlineOffset = '2px';
      row.nextElementSibling.value = btn.dataset.color;
    });
  });

  const form = overlay.querySelector('#modal-form');
  const errorBox = overlay.querySelector('#modal-form-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const values = Object.fromEntries(formData.entries());
    const outcome = await onSubmit(values);
    if (outcome?.ok === false) {
      errorBox.hidden = false;
      errorBox.textContent = (outcome.errors || ['Something went wrong.']).join(' ');
      return;
    }
    closeModal();
  });

  document.addEventListener('keydown', escListener);
  document.body.appendChild(overlay);
  activeOverlay = overlay;

  fields
    .filter((field) => field.type === 'select')
    .forEach((field) => {
      const slot = overlay.querySelector(`[data-slot="${field.name}"]`);
      const customSelect = buildCustomSelect({ name: field.name, value: field.value, options: field.options });
      slot.replaceWith(customSelect);
    });
  window.lucide?.createIcons();

  overlay.querySelector('input[type="text"]')?.focus();
}
