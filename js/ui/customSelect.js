/**
 * Builds a custom dropdown selector (not a native <select>/<option>).
 * Returns the wrapper element with .getValue()/.setValue() attached, and a
 * hidden <input name="..."> inside it so it participates in FormData like
 * any other form field.
 *
 * @param {{ name?: string, value?: string, options: Array<{value:string,label:string}>, onChange?: (value:string)=>void }} config
 */
export function buildCustomSelect({ name = '', value, options, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'custom-select';

  const selected = options.find((o) => o.value === value) || options[0];

  wrap.innerHTML = `
    <button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="custom-select-value">${selected?.label ?? ''}</span>
      <i data-lucide="chevron-down"></i>
    </button>
    <div class="custom-select-panel" role="listbox" hidden>
      ${options
        .map(
          (o) => `<button type="button" class="custom-select-option${o.value === selected?.value ? ' is-selected' : ''}" role="option" data-value="${o.value}">${o.label}</button>`
        )
        .join('')}
    </div>
    <input type="hidden" name="${name}" value="${selected?.value ?? ''}" />
  `;

  const trigger = wrap.querySelector('.custom-select-trigger');
  const panel = wrap.querySelector('.custom-select-panel');
  const hiddenInput = wrap.querySelector('input[type="hidden"]');
  const valueLabel = wrap.querySelector('.custom-select-value');

  function onOutsideClick(e) {
    if (!wrap.contains(e.target)) close();
  }
  function onEscape(e) {
    if (e.key === 'Escape') close();
  }
  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onOutsideClick);
    document.addEventListener('keydown', onEscape);
  }
  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onEscape);
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.hidden) open();
    else close();
  });

  panel.querySelectorAll('.custom-select-option').forEach((optionEl) => {
    optionEl.addEventListener('click', () => {
      hiddenInput.value = optionEl.dataset.value;
      valueLabel.textContent = optionEl.textContent;
      panel.querySelectorAll('.custom-select-option').forEach((o) => o.classList.remove('is-selected'));
      optionEl.classList.add('is-selected');
      close();
      onChange?.(optionEl.dataset.value);
    });
  });

  wrap.getValue = () => hiddenInput.value;
  wrap.setValue = (v) => {
    hiddenInput.value = v;
    const match = options.find((o) => o.value === v);
    if (match) valueLabel.textContent = match.label;
  };

  return wrap;
}
