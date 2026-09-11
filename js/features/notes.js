import { addRecord, updateRecord, deleteRecord, listRecords, getRecord } from '../core/store.js';
import { getNoteBody, putNoteBody, deleteNoteBody } from '../core/idb.js';
import { nowISO } from '../core/utils.js';

function countWords(text) {
  return (text.trim().match(/\S+/g) || []).length;
}

export async function createNote({ title = 'Untitled note', content = '' } = {}) {
  const outcome = addRecord('notes', {
    title: title.trim() || 'Untitled note',
    pinned: false,
    updatedAt: nowISO(),
    wordCount: countWords(content),
  });
  if (!outcome.ok) return outcome;

  try {
    await putNoteBody(outcome.record.id, content);
  } catch {
    // IndexedDB unavailable — the note metadata still exists; body just won't persist.
  }
  return outcome;
}

/** Updates title and/or content (content goes to IndexedDB, wordCount/updatedAt to the store). */
export async function updateNoteContent(id, { title, content } = {}) {
  const patch = { updatedAt: nowISO() };
  if (title !== undefined) {
    const trimmed = title.trim();
    patch.title = trimmed || 'Untitled note';
  }
  if (content !== undefined) patch.wordCount = countWords(content);

  const outcome = updateRecord('notes', id, patch);
  if (outcome.ok && content !== undefined) {
    try {
      await putNoteBody(id, content);
    } catch {
      /* best-effort */
    }
  }
  return outcome;
}

export function togglePinned(id) {
  const note = getRecord('notes', id);
  if (!note) return { ok: false, record: null, errors: ['Note not found.'] };
  return updateRecord('notes', id, { pinned: !note.pinned });
}

export async function deleteNote(id) {
  const outcome = deleteRecord('notes', id);
  if (outcome.ok) {
    try {
      await deleteNoteBody(id);
    } catch {
      /* best-effort */
    }
  }
  return outcome;
}

/** Metadata only (title/pinned/wordCount/timestamps) — fast, no IndexedDB read. Search matches title only. */
export function listNotesMeta({ search = '' } = {}) {
  let notes = listRecords('notes');
  const query = search.trim().toLowerCase();
  if (query) notes = notes.filter((n) => n.title.toLowerCase().includes(query));

  return notes.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}

export function getNoteMeta(id) {
  return getRecord('notes', id);
}

/** Fetches the actual body text from IndexedDB. Returns '' if unavailable rather than throwing. */
export async function getNoteContent(id) {
  try {
    const body = await getNoteBody(id);
    return body?.content ?? '';
  } catch {
    return '';
  }
}
