import { addRecord, updateRecord, deleteRecord, listRecords, getRecord } from '../core/store.js';
import { todayDateString, dateStringDaysAgo, nowISO } from '../core/utils.js';
import { TODO_PRIORITIES, TODO_CATEGORIES } from '../core/schema.js';

export { TODO_PRIORITIES, TODO_CATEGORIES };

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };

export function createTodo({ title, category, priority, subjectId = null, dueDate = null }) {
  const trimmedTitle = (title || '').trim();
  if (!trimmedTitle) return { ok: false, record: null, errors: ['Task title is required.'] };

  return addRecord('todos', {
    title: trimmedTitle,
    category,
    priority,
    subjectId: subjectId || null,
    dueDate: dueDate || null,
    completed: false,
    completedAt: null,
  });
}

export function editTodo(id, patch) {
  const cleaned = { ...patch };
  if (cleaned.title !== undefined) {
    const trimmed = cleaned.title.trim();
    if (!trimmed) return { ok: false, record: null, errors: ['Task title is required.'] };
    cleaned.title = trimmed;
  }
  if (cleaned.dueDate === '') cleaned.dueDate = null;
  if (cleaned.subjectId === '') cleaned.subjectId = null;
  return updateRecord('todos', id, cleaned);
}

/** Toggles completion and stamps/clears completedAt accordingly. */
export function toggleTodoComplete(id) {
  const todo = getRecord('todos', id);
  if (!todo) return { ok: false, record: null, errors: ['Task not found.'] };
  const completed = !todo.completed;
  return updateRecord('todos', id, { completed, completedAt: completed ? nowISO() : null });
}

export function deleteTodo(id) {
  return deleteRecord('todos', id);
}

/**
 * Views: 'all' (everything), 'today' (due today, not done), 'upcoming'
 * (due after today, not done), 'completed'.
 * Active (incomplete) todos are sorted by priority then due date; completed
 * ones by most-recently-completed first.
 */
export function listTodos(filter = 'all') {
  const all = listRecords('todos');
  const today = todayDateString();

  let filtered;
  if (filter === 'today') filtered = all.filter((t) => !t.completed && t.dueDate === today);
  else if (filter === 'upcoming') filtered = all.filter((t) => !t.completed && t.dueDate && t.dueDate > today);
  else if (filter === 'completed') filtered = all.filter((t) => t.completed);
  else filtered = all;

  return filtered.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.completed && b.completed) return new Date(b.completedAt) - new Date(a.completedAt);
    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

export function isOverdue(todo, today = todayDateString()) {
  return !todo.completed && !!todo.dueDate && todo.dueDate < today;
}

/** Real counts computed from stored todos — nothing here is a placeholder. */
export function getTodoStats(now = new Date()) {
  const all = listRecords('todos');
  const completed = all.filter((t) => t.completed);
  const today = todayDateString(now);
  const overdueCount = all.filter((t) => isOverdue(t, today)).length;

  const weekStart = dateStringDaysAgo(6, now);
  const completedThisWeek = completed.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= weekStart).length;

  return {
    total: all.length,
    completedCount: completed.length,
    completionRate: all.length > 0 ? Math.round((completed.length / all.length) * 100) : 0,
    overdueCount,
    completedThisWeek,
  };
}
