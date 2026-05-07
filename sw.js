const CACHE_NAME = 'csm-missions-v2';

const urlsToCache = [
  '/',
  '/missionitinerary.html',
  '/devotional.html',
  '/missions.html',
  '/Styles/Site.css',
  '/Styles/Site_mobile.css',
  '/data/missions.json',
  '/Images/missiongeneral.jpg',
  '/Images/icon-192.png',
  '/Images/icon-512.png'
];

self.addEventListener('install', event => {

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })

  );

});


// CLEAN OLD CACHES
self.addEventListener('activate', event => {

  event.waitUntil(

    caches.keys().then(keys => {

      return Promise.all(

        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))

      );

    })

  );

});


self.addEventListener('fetch', event => {

  event.respondWith(

    caches.match(event.request)
      .then(response => {

        return response || fetch(event.request);

      })

  );

});