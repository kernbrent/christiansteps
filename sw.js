const CACHE_NAME = 'csm-missions-v8';

const OFFLINE_ASSETS = [
  '/',
  '/Mission/Trips/2026/Athens-Greece/missionitinerary.html',
  '/Mission/Trips/2026/Athens-Greece/devotional.html',
  '/Mission/Trips/2026/Athens-Greece/index.html',
  '/Styles/Site.css',
  '/Styles/Site_mobile.css',
  '/data/missions.json',
  '/Images/missiongeneral.jpg',
  '/Images/icon-192.png',
  '/Images/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const isMediaRequest =
    event.request.destination === 'video' ||
    event.request.headers.has('range') ||
    requestUrl.pathname.toLowerCase().endsWith('.mp4');

  // Let the browser stream media directly. Partial (206) responses cannot be
  // stored by Cache Storage and rejecting that cache write breaks playback.
  if (isMediaRequest) return;

  const isUpdateSensitive =
    event.request.mode === 'navigate' ||
    ['document', 'style', 'script'].includes(event.request.destination) ||
    requestUrl.pathname === '/header.html' ||
    requestUrl.pathname === '/footer.html' ||
    requestUrl.pathname === '/data/tripmap.json' ||
    requestUrl.pathname === '/data/dayactivities.json' ||
    requestUrl.pathname === '/data/music_library.json' ||
    requestUrl.pathname === '/data/cast_library.json';

  if (isUpdateSensitive) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}
