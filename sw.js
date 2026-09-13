// Caches only the static app shell so the icon/launch experience is snappy.
// API calls and tokens are never cached here.
const CACHE_NAME = 'spotifykids-shell-v2';
const SHELL_FILES = [
  './',
  'index.html',
  'style.css',
  'config.js',
  'auth.js',
  'api.js',
  'player.js',
  'app.js',
  'manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never intercept Spotify API/auth calls
  // Network-first so local edits show up on reload; falls back to cache when offline.
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
