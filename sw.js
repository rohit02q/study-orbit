const CACHE_NAME = 'study-orbit-v2';

// App shell — these are cached during installation.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',

  './css/tokens.css',
  './css/style.css',
  './css/animations.css',
  './css/responsive.css',

  './js/app.js',
  './assets/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Don't let one missing file prevent the SW from installing.
      await Promise.allSettled(
        CORE_ASSETS.map(async (asset) => {
          try {
            await cache.add(asset);
          } catch (error) {
            console.warn('[SW] Failed to cache:', asset, error);
          }
        })
      );
    })
  );

  self.skipWaiting();
});


// ---------------------------------------------------------
// ACTIVATE
// ---------------------------------------------------------

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});


// ---------------------------------------------------------
// FETCH
// ---------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET requests can be cached.
  if (request.method !== 'GET') return;

  event.respondWith(handleRequest(request));
});


// ---------------------------------------------------------
// REQUEST HANDLER
// ---------------------------------------------------------

async function handleRequest(request) {
  const url = new URL(request.url);

  // -------------------------------------------------------
  // 1. HTML / PAGE NAVIGATION
  // -------------------------------------------------------
  //
  // Network first:
  //   Online  -> latest version
  //   Offline -> cached version
  //
  if (request.mode === 'navigate') {
    try {
      const response = await fetch(request);

      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }

      return response;
    } catch (error) {
      return (
        (await caches.match(request)) ||
        (await caches.match('./index.html')) ||
        new Response(
          `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Study Orbit</title>
            </head>
            <body>
              <h2>Study Orbit</h2>
              <p>You are offline and this page has not been cached yet.</p>
            </body>
          </html>
          `,
          {
            headers: {
              'Content-Type': 'text/html',
            },
          }
        )
      );
    }
  }


  // -------------------------------------------------------
  // 2. CHECK CACHE FIRST
  // -------------------------------------------------------
  //
  // This covers:
  // CSS
  // JS
  // images
  // fonts
  // JSON
  // icons
  // Tailwind CDN
  // libraries
  // same-origin assets
  // cross-origin CDN assets (when browser allows it)
  //

  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }


  // -------------------------------------------------------
  // 3. NOT CACHED -> FETCH FROM NETWORK
  // -------------------------------------------------------

  try {
    const response = await fetch(request);

    // Don't cache failed responses.
    if (!response || !response.ok) {
      return response;
    }


    // -----------------------------------------------------
    // 4. CACHE EVERYTHING THAT CAN BE CACHED
    // -----------------------------------------------------

    const cache = await caches.open(CACHE_NAME);

    try {
      await cache.put(request, response.clone());
    } catch (cacheError) {
      console.warn(
        '[SW] Could not cache:',
        request.url,
        cacheError
      );
    }

    return response;

  } catch (networkError) {

    // -----------------------------------------------------
    // 5. OFFLINE FALLBACK
    // -----------------------------------------------------

    const fallback = await caches.match(request);

    if (fallback) {
      return fallback;
    }

    // Nothing available offline.
    return new Response('', {
      status: 503,
      statusText: 'Offline',
    });
  }
}