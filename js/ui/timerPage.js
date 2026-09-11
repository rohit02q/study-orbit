import {
  getActiveSession,
  startSession,
  pauseSession,
  resumeSession,
  stopSession,
  discardActiveSession,
  computeElapsedSeconds,
  buildSessionInsight,
  STUDY_TYPES,
} from '../features/timer.js';
import { listSubjects, getSubject } from '../features/subjects.js';
import { getSettings } from '../core/store.js';
import { formatDuration } from '../core/utils.js';
import { showToast } from './toast.js';
import { openModal } from './modal.js';
import { renderEmptyState } from './emptyStates.js';
import { buildCustomSelect } from './customSelect.js';

const FOCUS_QUOTES = [
  'Small steps compound.',
  'Focus is a skill, not a mood.',
  'Done beats perfect.',
  'One session at a time.',
  'Progress hides in repetition.',
  'Show up, then show up again.',
  'Discipline outlasts motivation.',
  'The work is the reward.',
  'Consistency beats intensity.',
  'Slow is smooth, smooth is fast.',
  'You don\u2019t need to feel ready.',
  'Every rep counts, even the quiet ones.',
];

let containerRef = null;
let tickIntervalId = null;
let keydownHandler = null;
let fullscreenChangeHandler = null;

export function renderTimerPage(container) {
  containerRef = container;
  paint();
  attachKeyboardShortcuts();
  attachFullscreenSync();
}

/** Called by the router when leaving this page — must not leak intervals/listeners. */
export function leaveTimerPage() {
  clearTick();
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
  if (fullscreenChangeHandler) document.removeEventListener('fullscreenchange', fullscreenChangeHandler);
  keydownHandler = null;
  fullscreenChangeHandler = null;
  hideFocusOverlay();
}

function clearTick() {
  if (tickIntervalId) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
}

function paint() {
  clearTick();
  if (!containerRef) return;
  containerRef.innerHTML = '';

  const active = getActiveSession();

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Study Timer</h2>
      <div class="page-header-sub">${active ? 'Session in progress.' : 'Set up a focused session.'}</div>
    </div>
  `;
  containerRef.appendChild(header);

  if (active) {
    containerRef.appendChild(buildActiveTimerCard(active));
    startTick(active);
  } else {
    containerRef.appendChild(buildSetupForm());
  }

  window.lucide?.createIcons();
}

// ---------- Setup form ----------

function buildSetupForm() {
  const subjects = listSubjects();

  if (subjects.length === 0) {
    return renderEmptyState({
      icon: '<i data-lucide="book-open"></i>',
      heading: 'Add a subject before starting a session.',
      body: 'Study sessions are tracked against a subject so your analytics stay organized.',
      actionLabel: 'Go to Subjects',
      onAction: () => (window.location.hash = '/subjects'),
    });
  }

  const wrap = document.createElement('div');
  wrap.className = 'card timer-setup';
  wrap.innerHTML = `
    <div class="form-field">
      <label>Subject</label>
      <div id="timer-subject-slot"></div>
    </div>
    <div class="form-field">
      <label>Study type</label>
      <div id="timer-type-slot"></div>
    </div>
    <div class="form-field">
      <label for="timer-goal">Session goal <span style="font-weight:400;">(optional)</span></label>
      <input type="text" id="timer-goal" placeholder="e.g. Finish chapter 4 problems" />
    </div>
    <button class="btn btn-primary" id="start-session-btn" style="width:100%; justify-content:center; margin-top: 4px;">
      <i data-lucide="play"></i> Start session
    </button>
    <div class="kbd-hints"><span><kbd>Space</kbd> start/pause</span></div>
  `;

  const subjectSelect = buildCustomSelect({
    value: subjects[0]?.id,
    options: subjects.map((s) => ({ value: s.id, label: s.name })),
  });
  subjectSelect.id = 'timer-subject-select';
  wrap.querySelector('#timer-subject-slot').replaceWith(subjectSelect);

  const typeSelect = buildCustomSelect({
    value: STUDY_TYPES[0],
    options: STUDY_TYPES.map((t) => ({ value: t, label: t })),
  });
  typeSelect.id = 'timer-type-select';
  wrap.querySelector('#timer-type-slot').replaceWith(typeSelect);

  wrap.querySelector('#start-session-btn').addEventListener('click', () => attemptStart());
  window.lucide?.createIcons();
  return wrap;
}

function attemptStart() {
  const subjectId = document.getElementById('timer-subject-select')?.getValue();
  const studyType = document.getElementById('timer-type-select')?.getValue();
  const goalNote = document.getElementById('timer-goal')?.value || '';

  const outcome = startSession({ subjectId, studyType, goalNote });
  if (!outcome.ok) {
    showToast(outcome.errors[0], 'error');
    return;
  }
  paint();
}

// ---------- Active timer ----------

function buildActiveTimerCard(session) {
  const subject = getSubject(session.subjectId);
  const wrap = document.createElement('div');
  wrap.className = 'card timer-display-card';
  wrap.id = 'timer-active-card';
  wrap.innerHTML = `
    <div class="timer-subject-label">
      <span class="subject-color-dot" style="background:${subject?.color || '#888'}"></span>
      ${subject?.name || 'Unknown subject'} \u2014 ${session.studyType}
    </div>
    ${session.goalNote ? `<div class="timer-goal-note"><i data-lucide="flag" style="width:13px;height:13px;vertical-align:-2px;"></i> ${session.goalNote}</div>` : ''}
    <span class="badge ${session.status === 'running' ? 'badge-signal' : 'badge-ember'} timer-status-badge">
      ${session.status === 'running' ? 'Running' : 'Paused'}
    </span>
    <div class="timer-digits mono" id="timer-digits">00:00:00</div>
    <div class="timer-controls">
      <button class="btn btn-primary" id="pause-resume-btn">
        <i data-lucide="${session.status === 'running' ? 'pause' : 'play'}"></i> ${session.status === 'running' ? 'Pause' : 'Resume'}
      </button>
      <button class="btn btn-secondary" id="stop-btn"><i data-lucide="square"></i> Stop &amp; Save</button>
      <button class="btn btn-secondary" id="focus-btn"><i data-lucide="maximize"></i> Focus mode</button>
      <button class="btn btn-ghost" id="reset-btn" style="color: var(--color-danger);"><i data-lucide="rotate-ccw"></i> Reset</button>
    </div>
    <div class="kbd-hints">
      <span><kbd>Space</kbd> pause/resume</span>
      <span><kbd>F</kbd> focus mode</span>
      <span><kbd>R</kbd> reset</span>
    </div>
  `;

  wrap.querySelector('#pause-resume-btn').addEventListener('click', () => togglePauseResume(session));
  wrap.querySelector('#stop-btn').addEventListener('click', () => attemptStop(session));
  wrap.querySelector('#focus-btn').addEventListener('click', () => enterFocusMode(session));
  wrap.querySelector('#reset-btn').addEventListener('click', () => confirmReset(session));

  return wrap;
}

function startTick(session) {
  const update = () => {
    const digitsEl = document.getElementById('timer-digits');
    const focusDigitsEl = document.getElementById('focus-timer-digits');
    const elapsed = computeElapsedSeconds(session);
    const text = formatClock(elapsed);
    if (digitsEl) digitsEl.textContent = text;
    if (focusDigitsEl) focusDigitsEl.textContent = text;
  };
  update();
  tickIntervalId = setInterval(update, 1000);
}

function formatClock(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function togglePauseResume(session) {
  const outcome = session.status === 'running' ? pauseSession(session.id) : resumeSession(session.id);
  if (!outcome.ok) {
    showToast(outcome.errors[0], 'error');
    return;
  }
  paint();
  // paint() only rebuilds the regular page — the focus-mode overlay lives in
  // a separate DOM tree (appended to document.body), so its icon/aria-label
  // must be updated here explicitly or it goes stale after the first tap.
  syncFocusModeControls(outcome.record);
}

function syncFocusModeControls(session) {
  const overlay = document.getElementById('focus-mode-overlay');
  if (!overlay || !overlay.classList.contains('is-active')) return;
  const btn = overlay.querySelector('#focus-pause-resume-btn');
  if (!btn) return;
  const isRunning = session.status === 'running';
  // Lucide's createIcons() replaces the <i> tag with an inline <svg> the
  // first time it runs, so re-querying for an <i> on later toggles finds
  // nothing — regenerate the icon markup fresh each time instead of trying
  // to mutate whatever createIcons() already turned it into.
  btn.innerHTML = `<i data-lucide="${isRunning ? 'pause' : 'play'}"></i>`;
  btn.setAttribute('aria-label', isRunning ? 'Pause' : 'Resume');
  window.lucide?.createIcons();
}

function attemptStop(session) {
  const outcome = stopSession(session.id);
  if (!outcome.ok) {
    showToast(outcome.errors[0], 'error');
    return;
  }
  if (getSettings().timerDefaults?.soundOnComplete) playCompletionSound();
  hideFocusOverlay();
  showSessionSummary(outcome.record);
}

/** A short, synthesized tone — no audio asset to ship, works offline, respects the Settings toggle. */
function playCompletionSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    /* Web Audio unavailable — silently skip, this is a non-essential touch */
  }
}

function confirmReset(session) {
  openModal({
    title: 'Reset this session?',
    body: 'The current session will be discarded and not saved. This cannot be undone.',
    confirmLabel: 'Discard session',
    danger: true,
    onConfirm: () => {
      discardActiveSession(session.id);
      hideFocusOverlay();
      showToast('Session discarded.', 'info');
      paint();
    },
  });
}

// ---------- Session summary ----------

function showSessionSummary(completedSession) {
  const subject = getSubject(completedSession.subjectId);
  const insight = buildSessionInsight(completedSession);
  const startTime = new Date(completedSession.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const endTime = new Date(completedSession.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="summary-title">
      <h2 id="summary-title">Session saved</h2>
      <p>${subject?.name || 'Unknown subject'} \u2014 ${completedSession.studyType}</p>
      <div class="summary-stat-grid">
        <div><div class="summary-stat-label">Duration</div><div class="summary-stat-value mono">${formatDuration(completedSession.duration)}</div></div>
        <div><div class="summary-stat-label">Started</div><div class="summary-stat-value">${startTime}</div></div>
        <div><div class="summary-stat-label">Ended</div><div class="summary-stat-value">${endTime}</div></div>
        <div><div class="summary-stat-label">Study type</div><div class="summary-stat-value">${completedSession.studyType}</div></div>
      </div>
      <div class="summary-insight">${insight}</div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="summary-done-btn">Done</button>
      </div>
    </div>
  `;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', escClose);
    paint();
  };
  const escClose = (e) => {
    if (e.key === 'Escape') close();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#summary-done-btn').addEventListener('click', close);
  document.addEventListener('keydown', escClose);
  document.body.appendChild(overlay);
}

// ---------- Fullscreen Focus Mode ----------

function getOrCreateFocusOverlay() {
  let overlay = document.getElementById('focus-mode-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'focus-mode-overlay';
  overlay.className = 'focus-mode-overlay';
  document.body.appendChild(overlay);
  return overlay;
}

function enterFocusMode(session) {
  const subject = getSubject(session.subjectId);
  const quote = FOCUS_QUOTES[Math.floor(Math.random() * FOCUS_QUOTES.length)];
  const overlay = getOrCreateFocusOverlay();

  overlay.innerHTML = `
    <div class="focus-mode-glow"></div>
    <button class="focus-mode-exit" id="focus-exit-btn" aria-label="Exit focus mode"><i data-lucide="x"></i></button>
    <div class="focus-mode-subject">
      <span class="subject-color-dot" style="background:${subject?.color || '#888'}"></span>
      ${subject?.name || 'Unknown subject'} \u2014 ${session.studyType}
    </div>
    ${session.goalNote ? `<div class="timer-goal-note">${session.goalNote}</div>` : ''}
    <div class="focus-mode-digits mono" id="focus-timer-digits">00:00:00</div>
    <div class="focus-mode-quote">${quote}</div>
    <div class="focus-mode-controls">
      <button class="focus-icon-btn" id="focus-pause-resume-btn" aria-label="${session.status === 'running' ? 'Pause' : 'Resume'}">
        <i data-lucide="${session.status === 'running' ? 'pause' : 'play'}"></i>
      </button>
      <button class="focus-icon-btn" id="focus-stop-btn" aria-label="Stop and save">
        <i data-lucide="square"></i>
      </button>
    </div>
    <div class="kbd-hints"><span><kbd>Esc</kbd> exit</span> <span><kbd>Space</kbd> pause/resume</span></div>
  `;

  overlay.classList.add('is-active');
  overlay.querySelector('#focus-exit-btn').addEventListener('click', exitFocusMode);
  overlay.querySelector('#focus-pause-resume-btn').addEventListener('click', () => togglePauseResume(session));
  overlay.querySelector('#focus-stop-btn').addEventListener('click', () => attemptStop(session));

  window.lucide?.createIcons();

  document.documentElement.requestFullscreen?.().catch(() => {
    /* Fullscreen may be denied (e.g. sandboxed preview) — the overlay still works as an immersive view. */
  });
}

function exitFocusMode() {
  hideFocusOverlay();
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}

function hideFocusOverlay() {
  const overlay = document.getElementById('focus-mode-overlay');
  overlay?.classList.remove('is-active');
}

function attachFullscreenSync() {
  // If the user exits native fullscreen via the browser's own Esc handling,
  // keep our overlay state in sync rather than leaving a stale full-viewport panel.
  fullscreenChangeHandler = () => {
    if (!document.fullscreenElement) hideFocusOverlay();
  };
  document.addEventListener('fullscreenchange', fullscreenChangeHandler);
}

// ---------- Keyboard shortcuts ----------

function attachKeyboardShortcuts() {
  keydownHandler = (e) => {
    const tag = document.activeElement?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    const modalOpen = document.querySelector('.modal-overlay');

    if (e.key === 'Escape') {
      if (document.getElementById('focus-mode-overlay')?.classList.contains('is-active')) {
        exitFocusMode();
      }
      return; // let modal's own Esc handler manage itself
    }

    if (isTyping || modalOpen) return;

    const active = getActiveSession();

    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
      // Enter is an internal-only alternate for Space (not surfaced in the
      // kbd-hints UI) — preventDefault avoids a focused button double-firing
      // its own native Enter-triggers-click behavior on top of this handler.
      e.preventDefault();
      if (active) togglePauseResume(active);
      else attemptStart();
    } else if (e.key.toLowerCase() === 'r' && active) {
      confirmReset(active);
    } else if (e.key.toLowerCase() === 'f' && active) {
      const overlay = document.getElementById('focus-mode-overlay');
      if (overlay?.classList.contains('is-active')) exitFocusMode();
      else enterFocusMode(active);
    }
  };
  document.addEventListener('keydown', keydownHandler);
}
