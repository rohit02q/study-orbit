import { addRecord, deleteRecord, listRecords } from '../core/store.js';
import { MUSIC_PLAYLISTS } from '../core/schema.js';

export { MUSIC_PLAYLISTS };

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extracts a YouTube video id from any common URL shape
 * (watch?v=, youtu.be/, /embed/, /shorts/) using only URL parsing —
 * no scraping, no third-party requests. Returns null if not a valid,
 * recognizable YouTube URL.
 */
export function extractYouTubeId(rawUrl) {
  let url;
  try {
    url = new URL((rawUrl || '').trim());
  } catch {
    return null;
  }

  let candidate = null;
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    candidate = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') candidate = url.searchParams.get('v');
    else if (url.pathname.startsWith('/embed/')) candidate = url.pathname.split('/embed/')[1]?.split('/')[0];
    else if (url.pathname.startsWith('/shorts/')) candidate = url.pathname.split('/shorts/')[1]?.split('/')[0];
  }

  return candidate && YOUTUBE_ID_PATTERN.test(candidate) ? candidate : null;
}

export function getThumbnailUrl(videoId) {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

export function getEmbedUrl(videoId) {
  return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0`;
}

/** Returns { ok, record, errors }. */
export function addTrack({ playlist, title, youtubeUrl }) {
  const trimmedTitle = (title || '').trim();
  if (!trimmedTitle) return { ok: false, record: null, errors: ['A title is required.'] };
  if (!MUSIC_PLAYLISTS.includes(playlist)) return { ok: false, record: null, errors: ['Choose a playlist.'] };

  const videoId = extractYouTubeId(youtubeUrl);
  if (!videoId) return { ok: false, record: null, errors: ['That doesn\u2019t look like a valid YouTube URL.'] };

  return addRecord('musicTracks', { playlist, title: trimmedTitle, youtubeUrl: youtubeUrl.trim(), videoId });
}

export function deleteTrack(id) {
  return deleteRecord('musicTracks', id);
}

export function listTracks(playlist) {
  const all = listRecords('musicTracks');
  const filtered = playlist ? all.filter((t) => t.playlist === playlist) : all;
  return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
