import { listNotesMeta, createNote, updateNoteContent, togglePinned, deleteNote, getNoteMeta, getNoteContent } from '../features/notes.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';
import { renderEmptyState } from './emptyStates.js';

let containerRef = null;
let searchQuery = '';
let editingNoteId = null;
let autosaveTimer = null;

export function renderNotesPage(container) {
  containerRef = container;
  searchQuery = '';
  editingNoteId = null;
  paintList();
}

/** Router onLeave — flush any pending autosave immediately so a fast navigation never loses text. */
export function leaveNotesPage() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    flushEditorSave();
  }
}

function flushEditorSave() {
  if (!editingNoteId || !containerRef) return;
  const titleEl = document.getElementById('note-title-input');
  const bodyEl = document.getElementById('note-body-textarea');
  if (!titleEl || !bodyEl) return;
  updateNoteContent(editingNoteId, { title: titleEl.value, content: bodyEl.value });
}

// ---------- List view ----------

function paintList() {
  containerRef.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Notes</h2>
      <div class="page-header-sub">Capture ideas while they're fresh.</div>
    </div>
    <button class="btn btn-primary" id="new-note-btn"><i data-lucide="plus"></i> New note</button>
  `;
  containerRef.appendChild(header);
  header.querySelector('#new-note-btn').addEventListener('click', handleNewNote);

  const notes = listNotesMeta({ search: searchQuery });
  const hasAnyNotes = listNotesMeta({}).length > 0;

  if (!hasAnyNotes) {
    containerRef.appendChild(
      renderEmptyState({
        icon: '<i data-lucide="notebook-pen"></i>',
        heading: 'Capture important ideas before they disappear.',
        body: 'Notes you write here are saved automatically as you type.',
        actionLabel: 'New note',
        onAction: handleNewNote,
      })
    );
    window.lucide?.createIcons();
    return;
  }

  const searchWrap = document.createElement('div');
  searchWrap.className = 'form-field';
  searchWrap.style.maxWidth = '320px';
  searchWrap.innerHTML = `<input type="text" id="note-search-input" placeholder="Search notes by title\u2026" value="${searchQuery}" />`;
  containerRef.appendChild(searchWrap);
  searchWrap.querySelector('input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    paintList();
    const input = document.getElementById('note-search-input');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });

  if (notes.length === 0) {
    containerRef.appendChild(
      renderEmptyState({ icon: '<i data-lucide="search"></i>', heading: 'No notes match your search.', body: 'Try a different title keyword.' })
    );
    window.lucide?.createIcons();
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'note-grid';
  notes.forEach((note) => grid.appendChild(buildNoteCard(note)));
  containerRef.appendChild(grid);

  window.lucide?.createIcons();
}

function buildNoteCard(note) {
  const card = document.createElement('div');
  card.className = 'card note-card';
  const updated = new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  card.innerHTML = `
    <div class="note-card-top">
      <span class="note-card-title" title="${note.title}">${note.title}</span>
      <button class="note-pin-btn${note.pinned ? ' is-pinned' : ''}" data-action="pin" aria-label="Pin note">
        <i data-lucide="${note.pinned ? 'pin' : 'pin-off'}"></i>
      </button>
    </div>
    <div class="note-card-snippet" id="snippet-${note.id}">Loading\u2026</div>
    <div class="note-card-meta">
      <span>${note.wordCount} word${note.wordCount === 1 ? '' : 's'}</span>
      <span>${updated}</span>
    </div>
  `;

  getNoteContent(note.id).then((content) => {
    const snippetEl = document.getElementById(`snippet-${note.id}`);
    if (snippetEl) snippetEl.textContent = content.trim() ? content.slice(0, 100) : 'No content yet.';
  });

  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="pin"]')) return;
    openEditor(note.id);
  });
  card.querySelector('[data-action="pin"]').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePinned(note.id);
    paintList();
  });

  return card;
}

async function handleNewNote() {
  const outcome = await createNote({ title: 'Untitled note', content: '' });
  if (outcome.ok) openEditor(outcome.record.id);
}

// ---------- Editor view ----------

async function openEditor(noteId) {
  editingNoteId = noteId;
  const meta = getNoteMeta(noteId);
  if (!meta) {
    showToast('Note not found.', 'error');
    paintList();
    return;
  }
  const content = await getNoteContent(noteId);

  containerRef.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'note-editor';
  wrap.innerHTML = `
    <div class="note-editor-toolbar">
      <button class="btn btn-ghost" id="back-to-notes-btn"><i data-lucide="arrow-left"></i> Back</button>
      <div style="display:flex; align-items:center; gap: var(--space-3);">
        <span class="note-save-indicator" id="save-indicator">Saved</span>
        <button class="btn btn-ghost" id="delete-note-btn" style="color: var(--color-danger);"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
    <input type="text" class="note-title-input" id="note-title-input" value="${meta.title}" placeholder="Untitled note" />
    <textarea class="note-body-textarea" id="note-body-textarea" placeholder="Start writing\u2026">${content}</textarea>
  `;
  containerRef.appendChild(wrap);
  window.lucide?.createIcons();

  const titleEl = document.getElementById('note-title-input');
  const bodyEl = document.getElementById('note-body-textarea');
  const indicator = document.getElementById('save-indicator');

  const scheduleAutosave = () => {
    indicator.textContent = 'Saving\u2026';
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      await updateNoteContent(noteId, { title: titleEl.value, content: bodyEl.value });
      if (document.getElementById('save-indicator')) indicator.textContent = 'Saved';
    }, 600);
  };

  titleEl.addEventListener('input', scheduleAutosave);
  bodyEl.addEventListener('input', scheduleAutosave);

  document.getElementById('back-to-notes-btn').addEventListener('click', async () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      await updateNoteContent(noteId, { title: titleEl.value, content: bodyEl.value });
    }
    editingNoteId = null;
    paintList();
  });

  document.getElementById('delete-note-btn').addEventListener('click', () => {
    openModal({
      title: 'Delete this note?',
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await deleteNote(noteId);
        editingNoteId = null;
        showToast('Note deleted.', 'success');
        paintList();
      },
    });
  });
}
