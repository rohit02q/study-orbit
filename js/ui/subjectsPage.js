import {
  listSubjects,
  createSubject,
  editSubject,
  archiveSubject,
  deleteSubject,
  subjectHasSessions,
  getSubjectStats,
  SUBJECT_COLOR_PALETTE,
} from '../features/subjects.js';
import { openFormModal, openModal } from './modal.js';
import { showToast } from './toast.js';
import { renderEmptyState } from './emptyStates.js';
import { formatDuration } from '../core/utils.js';

let containerRef = null;
let showArchived = false;

export function renderSubjectsPage(container) {
  containerRef = container;
  showArchived = false;
  paint();
}

function paint() {
  containerRef.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Subjects</h2>
      <div class="page-header-sub">Organize your study time by topic.</div>
    </div>
    <button class="btn btn-primary" id="add-subject-btn">
      <i data-lucide="plus"></i> Add subject
    </button>
  `;
  containerRef.appendChild(header);

  const activeSubjects = listSubjects({ includeArchived: false });
  const allSubjects = listSubjects({ includeArchived: true });
  const archivedSubjects = allSubjects.filter((s) => s.archived);

  if (activeSubjects.length === 0 && archivedSubjects.length === 0) {
    containerRef.appendChild(
      renderEmptyState({
        icon: '<i data-lucide="book-open"></i>',
        heading: 'No subjects yet.',
        body: 'Add a subject to start organizing your study time by topic.',
        actionLabel: 'Add a subject',
        onAction: openAddModal,
      })
    );
  } else {
    containerRef.appendChild(buildGrid(activeSubjects));

    if (archivedSubjects.length > 0) {
      const toggle = document.createElement('button');
      toggle.className = 'archived-toggle';
      toggle.innerHTML = `<i data-lucide="${showArchived ? 'chevron-down' : 'chevron-right'}"></i> ${showArchived ? 'Hide' : 'Show'} archived (${archivedSubjects.length})`;
      toggle.addEventListener('click', () => {
        showArchived = !showArchived;
        paint();
      });
      containerRef.appendChild(toggle);

      if (showArchived) {
        containerRef.appendChild(buildGrid(archivedSubjects, { archived: true }));
      }
    }
  }

  document.getElementById('add-subject-btn').addEventListener('click', openAddModal);
  window.lucide?.createIcons();
}

function buildGrid(subjects, { archived = false } = {}) {
  const grid = document.createElement('div');
  grid.className = 'subject-grid';
  subjects.forEach((subject) => grid.appendChild(buildCard(subject, { archived })));
  return grid;
}

function buildCard(subject, { archived }) {
  const stats = getSubjectStats(subject.id);
  const card = document.createElement('div');
  card.className = `card subject-card${archived ? ' is-archived' : ''}`;
  card.innerHTML = `
    <div class="subject-card-top">
      <span class="subject-color-dot" style="background:${subject.color}"></span>
      <span class="subject-card-name" title="${subject.name}">${subject.name}</span>
    </div>
    <div class="subject-stats-row">
      <div>
        <div class="subject-stat-label">Total time</div>
        <div class="subject-stat-value mono">${formatDuration(stats.totalSeconds)}</div>
      </div>
      <div>
        <div class="subject-stat-label">This week</div>
        <div class="subject-stat-value mono">${formatDuration(stats.weekSeconds)}</div>
      </div>
      <div>
        <div class="subject-stat-label">Sessions</div>
        <div class="subject-stat-value mono">${stats.sessionCount}</div>
      </div>
      <div>
        <div class="subject-stat-label">Avg. session</div>
        <div class="subject-stat-value mono">${formatDuration(stats.avgDurationSeconds)}</div>
      </div>
    </div>
    <div class="subject-card-actions">
      <button class="btn btn-secondary" data-action="edit"><i data-lucide="pencil"></i> Edit</button>
      <button class="btn btn-secondary" data-action="${archived ? 'restore' : 'archive'}">
        <i data-lucide="${archived ? 'rotate-ccw' : 'archive'}"></i> ${archived ? 'Restore' : 'Archive'}
      </button>
      <button class="btn btn-ghost" data-action="delete" style="color: var(--color-danger);" aria-label="Delete subject">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  `;

  card.querySelector('[data-action="edit"]').addEventListener('click', () => openEditModal(subject));
  card.querySelector('[data-action="archive"], [data-action="restore"]')?.addEventListener('click', () => {
    const outcome = archiveSubject(subject.id, !archived);
    if (outcome.ok) {
      showToast(archived ? `${subject.name} restored.` : `${subject.name} archived.`, 'success');
      paint();
    }
  });
  card.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete(subject));

  return card;
}

function openAddModal() {
  openFormModal({
    title: 'Add subject',
    submitLabel: 'Add subject',
    fields: [
      { type: 'text', name: 'name', label: 'Name', placeholder: 'e.g. Organic Chemistry', required: true },
      { type: 'color', name: 'color', label: 'Color', value: SUBJECT_COLOR_PALETTE[0], options: SUBJECT_COLOR_PALETTE },
    ],
    onSubmit: (values) => {
      const outcome = createSubject({ name: values.name, color: values.color });
      if (outcome.ok) {
        showToast(`${outcome.record.name} added.`, 'success');
        paint();
      }
      return outcome;
    },
  });
}

function openEditModal(subject) {
  openFormModal({
    title: 'Edit subject',
    submitLabel: 'Save changes',
    fields: [
      { type: 'text', name: 'name', label: 'Name', value: subject.name, required: true },
      { type: 'color', name: 'color', label: 'Color', value: subject.color, options: SUBJECT_COLOR_PALETTE },
    ],
    onSubmit: (values) => {
      const outcome = editSubject(subject.id, { name: values.name, color: values.color });
      if (outcome.ok) {
        showToast('Subject updated.', 'success');
        paint();
      }
      return outcome;
    },
  });
}

function confirmDelete(subject) {
  if (subjectHasSessions(subject.id)) {
    openModal({
      title: 'Can\u2019t delete this subject',
      body: `${subject.name} has study sessions on record. Archive it instead to hide it from new sessions while keeping your history intact.`,
      confirmLabel: 'Archive instead',
      cancelLabel: 'Never mind',
      onConfirm: () => {
        archiveSubject(subject.id, true);
        showToast(`${subject.name} archived.`, 'success');
        paint();
      },
    });
    return;
  }

  openModal({
    title: `Delete ${subject.name}?`,
    body: 'This subject has no study sessions yet, so deleting it is safe. This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      const outcome = deleteSubject(subject.id);
      if (outcome.ok) {
        showToast(`${subject.name} deleted.`, 'success');
        paint();
      } else {
        showToast(outcome.errors[0], 'error');
      }
    },
  });
}
