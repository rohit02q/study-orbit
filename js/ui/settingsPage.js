import { getSettings, updateSettings, clearAllData } from '../core/store.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

let containerRef = null;

export function renderSettingsPage(container) {
  containerRef = container;
  paint();
}

function paint() {
  containerRef.innerHTML = '';
  const settings = getSettings();

  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <div>
      <h2 class="font-display">Settings</h2>
      <div class="page-header-sub">Your profile, goals, and data.</div>
    </div>
  `;
  containerRef.appendChild(header);

  containerRef.appendChild(buildProfileCard(settings));
  containerRef.appendChild(buildGoalsCard(settings));
  containerRef.appendChild(buildTimerCard(settings));
  containerRef.appendChild(buildDataCard());

  window.lucide?.createIcons();
}

function buildProfileCard(settings) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginBottom = 'var(--space-4)';
  card.innerHTML = `
    <h3 class="font-display">Profile</h3>
    <div class="form-field" style="max-width: 320px;">
      <label for="settings-name">Your name</label>
      <input type="text" id="settings-name" placeholder="e.g. Alex" value="${settings.displayName || ''}" />
    </div>
    <button class="btn btn-primary" id="save-name-btn">Save</button>
  `;
  card.querySelector('#save-name-btn').addEventListener('click', () => {
    const value = card.querySelector('#settings-name').value.trim();
    updateSettings({ displayName: value });
    showToast('Profile updated.', 'success');
  });
  return card;
}

function buildGoalsCard(settings) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginBottom = 'var(--space-4)';
  card.innerHTML = `
    <h3 class="font-display">Study goals</h3>
    <div class="form-field" style="max-width: 220px;">
      <label for="settings-daily-goal">Daily goal (minutes)</label>
      <input type="text" inputmode="numeric" id="settings-daily-goal" value="${settings.dailyGoalMinutes}" />
    </div>
    <div class="form-field" style="max-width: 220px;">
      <label for="settings-weekly-goal">Weekly goal (minutes)</label>
      <input type="text" inputmode="numeric" id="settings-weekly-goal" value="${settings.weeklyGoalMinutes}" />
    </div>
    <button class="btn btn-primary" id="save-goals-btn">Save</button>
  `;
  card.querySelector('#save-goals-btn').addEventListener('click', () => {
    const daily = Number(card.querySelector('#settings-daily-goal').value);
    const weekly = Number(card.querySelector('#settings-weekly-goal').value);
    if (!Number.isFinite(daily) || daily < 0 || !Number.isFinite(weekly) || weekly < 0) {
      showToast('Enter valid non-negative numbers.', 'error');
      return;
    }
    updateSettings({ dailyGoalMinutes: daily, weeklyGoalMinutes: weekly });
    showToast('Goals updated.', 'success');
  });
  return card;
}

function buildTimerCard(settings) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.marginBottom = 'var(--space-4)';
  card.innerHTML = `
    <h3 class="font-display">Timer</h3>
    <div class="settings-toggle-row">
      <div>
        <div style="font-weight: 600;">Sound on session complete</div>
        <div style="font-size: 12px; color: var(--color-text-muted);">Plays a short tone when you stop and save a session.</div>
      </div>
      <button class="toggle-switch ${settings.timerDefaults.soundOnComplete ? 'is-on' : ''}" id="sound-toggle" role="switch" aria-checked="${!!settings.timerDefaults.soundOnComplete}" aria-label="Sound on session complete"></button>
    </div>
  `;
  card.querySelector('#sound-toggle').addEventListener('click', (e) => {
    const isOn = e.currentTarget.classList.toggle('is-on');
    e.currentTarget.setAttribute('aria-checked', String(isOn));
    updateSettings({ timerDefaults: { ...getSettings().timerDefaults, soundOnComplete: isOn } });
  });
  return card;
}

function buildDataCard() {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3 class="font-display">Data</h3>
    <p style="color: var(--color-text-muted); font-size: 13px; margin: 4px 0 var(--space-4);">
      Export or import backups on the <a href="#/data" style="color: var(--color-ember);">Data &amp; Backup</a> page.
    </p>
    <button class="btn btn-secondary" id="settings-clear-data-btn" style="color: var(--color-danger); border-color: var(--color-danger-dim);">
      <i data-lucide="trash-2"></i> Clear all data
    </button>
  `;
  card.querySelector('#settings-clear-data-btn').addEventListener('click', () => {
    openModal({
      title: 'Clear all data?',
      body: 'This removes every session, subject, task, note, sleep record, and music track from this device. This cannot be undone.',
      confirmLabel: 'Clear everything',
      danger: true,
      onConfirm: async () => {
        await clearAllData();
        showToast('All data cleared.', 'success');
        paint();
      },
    });
  });
  return card;
}
