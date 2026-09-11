import {
  listTodos,
  createTodo,
  editTodo,
  toggleTodoComplete,
  deleteTodo,
  isOverdue,
  getTodoStats,
  TODO_PRIORITIES,
  TODO_CATEGORIES,
} from '../features/todos.js';
import { listSubjects, getSubject } from '../features/subjects.js';
import { openFormModal, openModal } from './modal.js';
import { showToast } from './toast.js';
import { renderEmptyState } from './emptyStates.js';
import { todayDateString, formatShortDate } from '../core/utils.js';

const PRIORITY_BADGE = { High: 'badge-danger', Medium: 'badge-warning', Low: 'badge-neutral' };
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
];

let containerRef = null;
let currentFilter = 'all';

export function renderTodosPage(container) {
  containerRef = container;
  currentFilter = 'all';
  paint();
}

function paint() {
  containerRef.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Tasks</h2>
      <div class="page-header-sub">Plan what you\u2019ll study next.</div>
    </div>
    <button class="btn btn-primary" id="add-todo-btn"><i data-lucide="plus"></i> Add task</button>
  `;
  containerRef.appendChild(header);

  const allTodos = listTodos('all');
  if (allTodos.length === 0) {
    containerRef.appendChild(
      renderEmptyState({
        icon: '<i data-lucide="check-square"></i>',
        heading: 'Your task list is clear.',
        body: 'Add a task to plan what you\u2019ll study next.',
        actionLabel: 'Add a task',
        onAction: openAddModal,
      })
    );
    header.querySelector('#add-todo-btn').addEventListener('click', openAddModal);
    window.lucide?.createIcons();
    return;
  }

  containerRef.appendChild(buildStatsRow());
  containerRef.appendChild(buildTabRow());

  const todos = listTodos(currentFilter);
  if (todos.length === 0) {
    containerRef.appendChild(
      renderEmptyState({
        icon: '<i data-lucide="check-square"></i>',
        heading: emptyHeadingFor(currentFilter),
        body: 'Nothing to show in this view right now.',
      })
    );
  } else {
    containerRef.appendChild(buildList(todos));
  }

  header.querySelector('#add-todo-btn').addEventListener('click', openAddModal);
  window.lucide?.createIcons();
}

function emptyHeadingFor(filter) {
  if (filter === 'today') return 'Nothing due today.';
  if (filter === 'upcoming') return 'Nothing coming up.';
  if (filter === 'completed') return 'No completed tasks yet.';
  return 'No tasks yet.';
}

function buildStatsRow() {
  const stats = getTodoStats();
  const grid = document.createElement('div');
  grid.className = 'hero-stats-grid';
  grid.style.marginBottom = 'var(--space-4)';
  grid.innerHTML = `
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="check-circle"></i> Completion rate</div>
      <div class="stat-card-value">${stats.completionRate}%</div>
    </div>
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="calendar-check"></i> Completed this week</div>
      <div class="stat-card-value">${stats.completedThisWeek}</div>
    </div>
    <div class="card stat-card">
      <div class="stat-card-label"><i data-lucide="alert-circle"></i> Overdue</div>
      <div class="stat-card-value" style="${stats.overdueCount > 0 ? 'color: var(--color-danger);' : ''}">${stats.overdueCount}</div>
    </div>
  `;
  return grid;
}

function buildTabRow() {
  const row = document.createElement('div');
  row.className = 'tab-row';
  row.innerHTML = FILTERS.map((f) => `<button class="tab-btn${f.key === currentFilter ? ' is-active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('');
  row.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      paint();
    });
  });
  return row;
}

function buildList(todos) {
  const today = todayDateString();
  const list = document.createElement('div');
  list.className = 'todo-list';

  todos.forEach((todo) => {
    const overdue = isOverdue(todo, today);
    const subject = todo.subjectId ? getSubject(todo.subjectId) : null;
    const row = document.createElement('div');
    row.className = 'todo-row';
    row.innerHTML = `
      <button class="todo-checkbox${todo.completed ? ' is-checked' : ''}" aria-label="Toggle complete">
        ${todo.completed ? '<i data-lucide="check"></i>' : ''}
      </button>
      <span class="todo-title${todo.completed ? ' is-completed' : ''}" title="${todo.title}">${todo.title}</span>
      <div class="todo-meta">
        ${subject ? `<span class="badge badge-neutral">${subject.name}</span>` : ''}
        <span class="badge ${PRIORITY_BADGE[todo.priority]}">${todo.priority}</span>
        <span class="badge badge-neutral">${todo.category}</span>
        ${todo.dueDate ? `<span class="todo-due${overdue ? ' is-overdue' : ''}">${formatShortDate(todo.dueDate)}</span>` : ''}
      </div>
      <div class="todo-actions">
        <button class="btn btn-ghost" data-action="edit" aria-label="Edit task"><i data-lucide="pencil"></i></button>
        <button class="btn btn-ghost" data-action="delete" style="color: var(--color-danger);" aria-label="Delete task"><i data-lucide="trash-2"></i></button>
      </div>
    `;

    row.querySelector('.todo-checkbox').addEventListener('click', () => {
      toggleTodoComplete(todo.id);
      paint();
    });
    row.querySelector('[data-action="edit"]').addEventListener('click', () => openEditModal(todo));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete(todo));

    list.appendChild(row);
  });

  return list;
}

function subjectOptions() {
  const subjects = listSubjects();
  return [
    { value: '', label: 'No subject' },
    ...subjects.map((s) => ({ value: s.id, label: s.name })),
  ];
}

function openAddModal() {
  openFormModal({
    title: 'Add task',
    submitLabel: 'Add task',
    fields: [
      { type: 'text', name: 'title', label: 'Title', placeholder: 'e.g. Finish practice set 3', required: true },
      { type: 'select', name: 'priority', label: 'Priority', value: 'Medium', options: TODO_PRIORITIES.map((p) => ({ value: p, label: p })) },
      { type: 'select', name: 'category', label: 'Category', value: 'Study', options: TODO_CATEGORIES.map((c) => ({ value: c, label: c })) },
      { type: 'select', name: 'subjectId', label: 'Subject', value: '', options: subjectOptions() },
      { type: 'date', name: 'dueDate', label: 'Due date (optional)', value: todayDateString() },
    ],
    onSubmit: (values) => {
      const outcome = createTodo(values);
      if (outcome.ok) {
        showToast('Task added.', 'success');
        paint();
      }
      return outcome;
    },
  });
}

function openEditModal(todo) {
  openFormModal({
    title: 'Edit task',
    submitLabel: 'Save changes',
    fields: [
      { type: 'text', name: 'title', label: 'Title', value: todo.title, required: true },
      { type: 'select', name: 'priority', label: 'Priority', value: todo.priority, options: TODO_PRIORITIES.map((p) => ({ value: p, label: p })) },
      { type: 'select', name: 'category', label: 'Category', value: todo.category, options: TODO_CATEGORIES.map((c) => ({ value: c, label: c })) },
      { type: 'select', name: 'subjectId', label: 'Subject', value: todo.subjectId || '', options: subjectOptions() },
      { type: 'date', name: 'dueDate', label: 'Due date (optional)', value: todo.dueDate || '' },
    ],
    onSubmit: (values) => {
      const outcome = editTodo(todo.id, values);
      if (outcome.ok) {
        showToast('Task updated.', 'success');
        paint();
      }
      return outcome;
    },
  });
}

function confirmDelete(todo) {
  openModal({
    title: `Delete "${todo.title}"?`,
    body: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      deleteTodo(todo.id);
      showToast('Task deleted.', 'success');
      paint();
    },
  });
}
