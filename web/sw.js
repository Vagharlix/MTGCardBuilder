// Offline cache when the app is opened in a browser (PWA, e.g. on iPhone).
// Not used inside the desktop/Android apps, which already ship every file.
// Strategy: cache-first for files of this site; anything fetched once
// (frame packs, images, fonts) stays available offline afterwards.
const CACHE = 'card-studio-v1';
const CORE = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/app.css', '/css/ui-fonts.css', '/css/card-fonts.css',
  '/js/app/assets.js', '/js/app/generated.js', '/js/app/storage.js', '/js/app/platform.js', '/js/app/ui.js', '/js/app/print.js',
  '/js/main-1.js', '/js/creator-23.js', '/js/frameSearch.js',
  '/js/frames/groupStandard-3.js', '/js/frames/packM15Regular-1.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      if (hit) {
        // refresh app code in the background, serve the cached copy now
        if (/\.(html|js|css)$/.test(url.pathname) || url.pathname === '/') network.catch(() => {});
        return hit;
      }
      return network.catch(() => (req.mode === 'navigate' ? cache.match('/index.html') : Response.error()));
    })
  );
});
