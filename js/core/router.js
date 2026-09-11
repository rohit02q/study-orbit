import { emit } from './events.js';

const routes = new Map();
let currentRoute = null;
let mountEl = null;

/**
 * Register a page.
 * @param {string} path - route id, e.g. 'dashboard'
 * @param {{ title: string, render: (container: HTMLElement) => void, onLeave?: () => void }} config
 */
export function registerRoute(path, config) {
  routes.set(path, config);
}

export function initRouter(mountElement, { defaultRoute = 'dashboard' } = {}) {
  mountEl = mountElement;
  window.addEventListener('hashchange', () => navigate(getPathFromHash(), false));
  const initial = getPathFromHash() || defaultRoute;
  navigate(initial, true);
}

function getPathFromHash() {
  return window.location.hash.replace(/^#\/?/, '') || null;
}

export function navigate(path, replaceHash = true) {
  const config = routes.get(path) || routes.get('dashboard');
  const resolvedPath = routes.has(path) ? path : 'dashboard';

  if (currentRoute && routes.get(currentRoute)?.onLeave) {
    routes.get(currentRoute).onLeave();
  }

  if (replaceHash && getPathFromHash() !== resolvedPath) {
    window.location.hash = `/${resolvedPath}`;
  }

  currentRoute = resolvedPath;
  mountEl.innerHTML = '';
  config.render(mountEl);
  emit('route:changed', { path: resolvedPath, title: config.title });
}

export function getCurrentRoute() {
  return currentRoute;
}
