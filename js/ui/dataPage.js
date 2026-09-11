import { exportData, parseImportFile, applyImport } from '../features/importExport.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

const COLLECTION_LABELS = {
  subjects: 'Subjects',
  studySessions: 'Sessions',
  todos: 'Tasks',
  notes: 'Notes',
  sleepRecords: 'Sleep',
  musicTracks: 'Music',
};

let containerRef = null;
let pendingFile = null;
let pendingParseResult = null;

export function renderDataPage(container) {
  containerRef = container;
  pendingFile = null;
  pendingParseResult = null;
  paint();
}

function paint() {
  containerRef.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Data &amp; Backup</h2>
      <div class="page-header-sub">Export a full backup, or import one from another device.</div>
    </div>
  `;
  containerRef.appendChild(header);

  containerRef.appendChild(buildExportCard());
  containerRef.appendChild(buildImportCard());
}

function buildExportCard() {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginBottom = 'var(--space-4)';
  card.innerHTML = `
    <h3 class="font-display">Export</h3>
    <p style="color: var(--color-text-muted); font-size: 13px; margin: 4px 0 var(--space-4);">
      Downloads a single JSON file with everything \u2014 subjects, sessions, tasks, notes, sleep records, and settings.
    </p>
    <button class="btn btn-primary" id="export-data-btn"><i data-lucide="download"></i> Export my data</button>
  `;
  card.querySelector('#export-data-btn').addEventListener('click', async () => {
    const outcome = await exportData();
    if (outcome.ok) showToast(`Exported ${outcome.filename}`, 'success');
  });
  window.lucide?.createIcons();
  return card;
}

function buildImportCard() {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'import-card';

  card.innerHTML = `
    <h3 class="font-display">Import</h3>
    <p style="color: var(--color-text-muted); font-size: 13px; margin: 4px 0 var(--space-4);">
      Choose a Study Orbit backup file (.json) to preview before importing.
    </p>
    <div class="import-dropzone" id="import-dropzone">
      <i data-lucide="upload" style="width:22px; height:22px; margin-bottom:8px; color: var(--color-text-faint);"></i>
      <div>
        <button class="btn btn-secondary" id="choose-file-btn">Choose backup file</button>
      </div>
      <input type="file" id="import-file-input" accept="application/json,.json" hidden />
    </div>
    <div id="import-preview-area"></div>
  `;

  card.querySelector('#choose-file-btn').addEventListener('click', () => {
    card.querySelector('#import-file-input').click();
  });
  card.querySelector('#import-file-input').addEventListener('change', handleFileSelected);

  window.lucide?.createIcons();
  return card;
}

async function handleFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  pendingFile = file;

  const previewArea = document.getElementById('import-preview-area');
  previewArea.innerHTML = `<div class="file-chip"><i data-lucide="file-text"></i> ${file.name} \u2014 reading\u2026</div>`;
  window.lucide?.createIcons();

  const result = await parseImportFile(file);
  pendingParseResult = result;
  renderPreview(file, result);
}

function renderPreview(file, result) {
  const previewArea = document.getElementById('import-preview-area');

  if (!result.ok) {
    previewArea.innerHTML = `
      <div class="file-chip"><i data-lucide="file-text"></i> ${file.name}</div>
      <div class="import-error-list">
        This file couldn\u2019t be imported.
        <ul>${result.errors.slice(0, 6).map((e) => `<li>${e}</li>`).join('')}</ul>
        ${result.errors.length > 6 ? `<div>\u2026and ${result.errors.length - 6} more issue(s).</div>` : ''}
      </div>
    `;
    return;
  }

  const countsHtml = Object.entries(COLLECTION_LABELS)
    .map(([key, label]) => `<div class="count-item"><div class="count-value mono">${result.counts[key] ?? 0}</div><div class="count-label">${label}</div></div>`)
    .join('');

  previewArea.innerHTML = `
    <div class="file-chip"><i data-lucide="file-text"></i> ${file.name}</div>
    ${result.migrated ? `<div class="import-error-list" style="color: var(--color-text-muted); background: var(--color-surface-raised);">This backup used an older format and will be upgraded automatically during import.</div>` : ''}
    <div class="import-preview-counts">${countsHtml}</div>
    <div class="import-actions">
      <button class="btn btn-primary" id="merge-import-btn"><i data-lucide="git-merge"></i> Merge with existing data</button>
      <button class="btn btn-secondary" id="replace-import-btn" style="color: var(--color-danger); border-color: var(--color-danger-dim);">
        <i data-lucide="triangle-alert"></i> Replace all data
      </button>
    </div>
  `;
  window.lucide?.createIcons();

  document.getElementById('merge-import-btn').addEventListener('click', () => runImport('merge'));
  document.getElementById('replace-import-btn').addEventListener('click', confirmReplaceImport);
}

function confirmReplaceImport() {
  openModal({
    title: 'Replace all existing data?',
    body: 'This will permanently overwrite every subject, session, task, note, and sleep record currently on this device with the contents of this file. This cannot be undone.',
    confirmLabel: 'Replace everything',
    danger: true,
    onConfirm: () => runImport('replace'),
  });
}

async function runImport(mode) {
  if (!pendingParseResult?.ok) return;
  const outcome = await applyImport(pendingParseResult.data, mode);

  if (!outcome.ok) {
    showToast('Import failed \u2014 no changes were made to some records.', 'error');
    return;
  }

  const summary = Object.entries(COLLECTION_LABELS)
    .map(([key, label]) => `${outcome.importedCounts[key] ?? 0} ${label.toLowerCase()}`)
    .join(', ');
  showToast(mode === 'replace' ? `Data replaced: ${summary}.` : `Imported: ${summary}.`, 'success');

  pendingFile = null;
  pendingParseResult = null;
  paint();
}
