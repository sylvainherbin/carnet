// Service worker « Carnet » — cache-first avec remplissage au fil de l'eau.
// Les assets Vite étant fingerprintés, une nouvelle version de l'app change
// leurs URL ; on renouvelle CACHE à chaque déploiement pour purger l'ancien.
const CACHE = 'carnet-v3';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // L'API GitHub (synchro) ne doit JAMAIS être servie depuis le cache.
  if (new URL(request.url).hostname === 'api.github.com') return;

  // Navigation : réseau d'abord (pour récupérer les mises à jour), repli hors ligne sur le cache.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); return r; })
        .catch(() => caches.match(request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Assets (JS/CSS fingerprintés, polices Google, icônes) : cache d'abord, réseau en repli.
  e.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((r) => {
        if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        return r;
      });
    })
  );
});
