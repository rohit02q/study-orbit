import { registerRoute, initRouter, navigate, getCurrentRoute } from './core/router.js';
import { on, emit } from './core/events.js';
import { showToast } from './ui/toast.js';
import { initStore } from './core/store.js';
import { renderSubjectsPage } from './ui/subjectsPage.js';
import { renderTimerPage, leaveTimerPage } from './ui/timerPage.js';
import { renderDashboardPage } from './ui/dashboardPage.js';
import { renderAnalyticsPage, leaveAnalyticsPage } from './ui/analyticsPage.js';
import { renderTodosPage } from './ui/todosPage.js';
import { renderNotesPage, leaveNotesPage } from './ui/notesPage.js';
import { renderSleepPage, leaveSleepPage } from './ui/sleepPage.js';
import { renderDataPage } from './ui/dataPage.js';
import { renderMusicPage } from './ui/musicPage.js';
import { initMusicPlayer } from './ui/musicPlayer.js';
import { renderSettingsPage } from './ui/settingsPage.js';

const NAV_ITEMS = [
  { path: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { path: 'timer', label: 'Study Timer', icon: 'timer' },
  { path: 'subjects', label: 'Subjects', icon: 'book-open' },
  { path: 'analytics', label: 'Analytics', icon: 'bar-chart-3' },
  { path: 'test-analysis', label: 'Test Analysis', icon: 'graduation-cap', href: 'test.html' },
  { path: 'tasks', label: 'Tasks', icon: 'check-square' },
  { path: 'notes', label: 'Notes', icon: 'notebook-pen' },
  { path: 'sleep', label: 'Sleep', icon: 'moon' },
  { path: 'music', label: 'Music', icon: 'music' },
  { path: 'data', label: 'Data & Backup', icon: 'database' },
  { path: 'settings', label: 'Settings', icon: 'settings' },
];

function buildSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <img src="assets/logo.png" alt="Study Orbit" class="brand-mark" />
      <span class="brand-label">Study Orbit</span>
    </div>
    <nav class="sidebar-nav">
      ${NAV_ITEMS.map((item) =>
        item.href
          ? `
        <a href="${item.href}" class="nav-item" data-path="${item.path}" data-external="true">
          <i data-lucide="${item.icon}"></i>
          <span class="nav-label">${item.label}</span>
        </a>`
          : `
        <a href="#/${item.path}" class="nav-item" data-path="${item.path}">
          <i data-lucide="${item.icon}"></i>
          <span class="nav-label">${item.label}</span>
        </a>`
      ).join('')}
    </nav>
    <div class="sidebar-footer">
      <button class="sidebar-collapse-btn" id="collapse-btn" aria-label="Collapse sidebar">
        <i data-lucide="panel-left-close"></i>
        <span class="nav-label">Collapse</span>
      </button>
    </div>
  `;
  window.lucide?.createIcons();
}

function highlightActiveNav(path) {
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.path === path);
  });
  const titleEl = document.getElementById('topbar-title');
  const item = NAV_ITEMS.find((n) => n.path === path);
  if (titleEl && item) titleEl.textContent = item.label;
}

function wireResponsiveDrawer() {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('drawer-scrim');
  const toggle = document.getElementById('drawer-toggle');

  const openDrawer = () => {
    sidebar.classList.add('is-open');
    scrim.classList.add('is-visible');
  };
  const closeDrawer = () => {
    sidebar.classList.remove('is-open');
    scrim.classList.remove('is-visible');
  };

  toggle.addEventListener('click', openDrawer);
  scrim.addEventListener('click', closeDrawer);
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('.nav-item')) closeDrawer();
  });
}

function wireCollapseToggle() {
  document.getElementById('collapse-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('is-collapsed');
  });
}

function wireNavClicks() {
  document.getElementById('sidebar').addEventListener('click', (e) => {
    const link = e.target.closest('.nav-item');
    if (!link) return;
    if (link.dataset.external === 'true') return; // let the browser navigate normally, e.g. to test.html
    e.preventDefault();
    navigate(link.dataset.path);
  });
}

function init() {
  const { warnings, restoredFromBackup } = initStore();
  if (restoredFromBackup) showToast('Your data was restored from a backup.', 'info');
  if (warnings?.length) warnings.forEach((w) => console.warn(w));

  initMusicPlayer();

  buildSidebar();
  wireResponsiveDrawer();
  wireCollapseToggle();
  wireNavClicks();

  registerRoute('subjects', {
    title: 'Subjects',
    render: renderSubjectsPage,
  });

  registerRoute('timer', {
    title: 'Study Timer',
    render: renderTimerPage,
    onLeave: leaveTimerPage,
  });

  registerRoute('dashboard', {
    title: 'Dashboard',
    render: renderDashboardPage,
  });

  registerRoute('analytics', {
    title: 'Analytics',
    render: renderAnalyticsPage,
    onLeave: leaveAnalyticsPage,
  });

  registerRoute('tasks', {
    title: 'Tasks',
    render: renderTodosPage,
  });

  registerRoute('notes', {
    title: 'Notes',
    render: renderNotesPage,
    onLeave: leaveNotesPage,
  });

  registerRoute('sleep', {
    title: 'Sleep',
    render: renderSleepPage,
    onLeave: leaveSleepPage,
  });

  registerRoute('data', {
    title: 'Data & Backup',
    render: renderDataPage,
  });

  registerRoute('music', {
    title: 'Music',
    render: renderMusicPage,
  });

  registerRoute('settings', {
    title: 'Settings',
    render: renderSettingsPage,
  });

  on('route:changed', ({ path }) => highlightActiveNav(path));

  initRouter(document.getElementById('main-content'), { defaultRoute: 'dashboard' });

  showToast('Study Orbit loaded.', 'success');
}

document.addEventListener('DOMContentLoaded', init);
