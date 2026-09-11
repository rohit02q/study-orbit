import { getEmbedUrl } from '../features/music.js';

let widgetEl = null;
let iframeEl = null;
let currentTrack = null;
let isPlaying = false;
let isExpanded = true;

function ensureWidget() {
  if (widgetEl) return widgetEl;

  widgetEl = document.createElement('div');
  widgetEl.className = 'music-widget';
  widgetEl.innerHTML = `
    <button class="music-widget-pill" data-action="expand" aria-label="Expand player">
      <i data-lucide="music"></i>
      <span class="music-widget-pill-title"></span>
    </button>
    <div class="music-widget-header">
      <span class="music-widget-title"></span>
      <button class="music-widget-icon-btn" data-action="minimize" aria-label="Minimize"><i data-lucide="chevron-down"></i></button>
    </div>
    <div class="music-widget-iframe-wrap"><iframe id="music-widget-iframe" allow="autoplay" title="Focus music player"></iframe></div>
    <div class="music-widget-controls">
      <button class="music-widget-icon-btn" data-action="toggle-play" aria-label="Play or pause"><i data-lucide="pause"></i></button>
      <input type="range" class="music-widget-volume" min="0" max="100" value="70" data-action="volume" aria-label="Volume" />
      <button class="music-widget-icon-btn" data-action="close" aria-label="Stop and close"><i data-lucide="x"></i></button>
    </div>
  `;
  document.body.appendChild(widgetEl);
  iframeEl = widgetEl.querySelector('#music-widget-iframe');

  widgetEl.querySelector('[data-action="expand"]').addEventListener('click', () => setExpanded(true));
  widgetEl.querySelector('[data-action="minimize"]').addEventListener('click', () => setExpanded(false));
  widgetEl.querySelector('[data-action="toggle-play"]').addEventListener('click', togglePlayPause);
  widgetEl.querySelector('[data-action="close"]').addEventListener('click', closePlayer);
  widgetEl.querySelector('[data-action="volume"]').addEventListener('input', (e) => setVolume(Number(e.target.value)));

  window.lucide?.createIcons();
  return widgetEl;
}

/** Call once at app boot — creates the (hidden, until a track loads) widget. */
export function initMusicPlayer() {
  ensureWidget();
}

export function loadTrack(track) {
  ensureWidget();
  currentTrack = track;
  isPlaying = true;
  isExpanded = true;

  iframeEl.src = `${getEmbedUrl(track.videoId)}&autoplay=1`;
  widgetEl.querySelector('.music-widget-title').textContent = track.title;
  widgetEl.querySelector('.music-widget-pill-title').textContent = track.title;
  widgetEl.classList.add('has-track');
  updatePlayPauseIcon();
  applyExpandedState();
  window.lucide?.createIcons();
}

export function getCurrentTrack() {
  return currentTrack;
}

function sendCommand(func, args = []) {
  if (!iframeEl?.contentWindow) return;
  iframeEl.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

function togglePlayPause() {
  if (!currentTrack) return;
  isPlaying = !isPlaying;
  sendCommand(isPlaying ? 'playVideo' : 'pauseVideo');
  updatePlayPauseIcon();
}

function updatePlayPauseIcon() {
  const icon = widgetEl.querySelector('[data-action="toggle-play"] i');
  if (icon) icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
  window.lucide?.createIcons();
}

function setVolume(value) {
  sendCommand('setVolume', [value]);
}

function setExpanded(expanded) {
  isExpanded = expanded;
  applyExpandedState();
}

/**
 * Only header/controls toggle via display:none here — the iframe wrap is
 * height-collapsed instead (see CSS), never display:none, so minimizing
 * never interrupts playback. That distinction is the entire point of this
 * widget being "collapsible without dominating the UI."
 */
function applyExpandedState() {
  widgetEl.classList.toggle('is-expanded', isExpanded);
}

function closePlayer() {
  sendCommand('stopVideo');
  currentTrack = null;
  isPlaying = false;
  iframeEl.src = '';
  widgetEl.classList.remove('has-track', 'is-expanded');
}
