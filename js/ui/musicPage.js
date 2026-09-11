import { listTracks, addTrack, deleteTrack, MUSIC_PLAYLISTS, getThumbnailUrl } from '../features/music.js';
import { loadTrack } from './musicPlayer.js';
import { openFormModal, openModal } from './modal.js';
import { showToast } from './toast.js';
import { renderEmptyState } from './emptyStates.js';

let containerRef = null;
let currentPlaylist = MUSIC_PLAYLISTS[0];

export function renderMusicPage(container) {
  containerRef = container;
  currentPlaylist = MUSIC_PLAYLISTS[0];
  paint();
}

function paint() {
  containerRef.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Music</h2>
      <div class="page-header-sub">Focus playlists, backed by YouTube embeds.</div>
    </div>
    <button class="btn btn-primary" id="add-track-btn"><i data-lucide="plus"></i> Add track</button>
  `;
  containerRef.appendChild(header);
  header.querySelector('#add-track-btn').addEventListener('click', openAddModal);

  const allTracks = listTracks();
  if (allTracks.length === 0) {
    containerRef.appendChild(
      renderEmptyState({
        icon: '<i data-lucide="music"></i>',
        heading: 'No focus playlist set up.',
        body: 'Paste a YouTube link to start a focus playlist for your sessions.',
        actionLabel: 'Add a track',
        onAction: openAddModal,
      })
    );
    window.lucide?.createIcons();
    return;
  }

  containerRef.appendChild(buildTabRow());

  const tracks = listTracks(currentPlaylist);
  if (tracks.length === 0) {
    containerRef.appendChild(
      renderEmptyState({
        icon: '<i data-lucide="music"></i>',
        heading: `No tracks in ${currentPlaylist} yet.`,
        body: 'Add one, or switch to another playlist above.',
        actionLabel: 'Add a track',
        onAction: openAddModal,
      })
    );
  } else {
    const grid = document.createElement('div');
    grid.className = 'track-grid';
    tracks.forEach((track) => grid.appendChild(buildTrackCard(track)));
    containerRef.appendChild(grid);
  }

  window.lucide?.createIcons();
}

function buildTabRow() {
  const row = document.createElement('div');
  row.className = 'tab-row';
  row.innerHTML = MUSIC_PLAYLISTS.map((p) => `<button class="tab-btn${p === currentPlaylist ? ' is-active' : ''}" data-playlist="${p}">${p}</button>`).join('');
  row.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentPlaylist = btn.dataset.playlist;
      paint();
    });
  });
  return row;
}

function buildTrackCard(track) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <img class="track-thumb" src="${getThumbnailUrl(track.videoId)}" alt="" loading="lazy" />
    <div class="track-card-title" title="${track.title}">${track.title}</div>
    <div class="track-card-actions">
      <button class="btn btn-primary" data-action="play"><i data-lucide="play"></i> Play</button>
      <button class="btn btn-ghost" data-action="delete" style="color: var(--color-danger);" aria-label="Delete track"><i data-lucide="trash-2"></i></button>
    </div>
  `;

  card.querySelector('[data-action="play"]').addEventListener('click', () => {
    loadTrack(track);
    showToast(`Playing ${track.title}`, 'success');
  });
  card.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDelete(track));

  return card;
}

function openAddModal() {
  openFormModal({
    title: 'Add track',
    submitLabel: 'Add track',
    fields: [
      { type: 'select', name: 'playlist', label: 'Playlist', value: currentPlaylist, options: MUSIC_PLAYLISTS.map((p) => ({ value: p, label: p })) },
      { type: 'text', name: 'title', label: 'Title', placeholder: 'e.g. Deep Focus Piano', required: true },
      { type: 'text', name: 'youtubeUrl', label: 'YouTube URL', placeholder: 'https://www.youtube.com/watch?v=\u2026', required: true },
    ],
    onSubmit: (values) => {
      const outcome = addTrack(values);
      if (outcome.ok) {
        showToast('Track added.', 'success');
        paint();
      }
      return outcome;
    },
  });
}

function confirmDelete(track) {
  openModal({
    title: `Remove "${track.title}"?`,
    body: 'This only removes it from your saved tracks \u2014 nothing happens on YouTube.',
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: () => {
      deleteTrack(track.id);
      showToast('Track removed.', 'success');
      paint();
    },
  });
}
