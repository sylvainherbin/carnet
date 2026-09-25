// Service worker « Carnet » — cache-first avec remplissage au fil de l'eau.
// Les assets Vite étant fingerprintés, une nouvelle version de l'app change
// leurs URL ; on renouvelle CACHE à chaque déploiement pour purger l'ancien.
const CACHE = 'carnet-v44';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

// On garde la génération précédente en plus de la nouvelle : le précache ne
// contient pas les assets fingerprintés, et les supprimer tous à l'activation
// laisserait une première ouverture hors ligne sans JS ni CSS. L'ancien cache
// sert alors de repli, et les générations plus vieilles partent.
const generation = (k) => { const m = /^carnet-v(\d+)$/.exec(k); return m ? Number(m[1]) : -1; };

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => {
        const autres = keys.filter((k) => k !== CACHE).sort((a, b) => generation(b) - generation(a));
        return Promise.all(autres.slice(1).map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // L'API GitHub (synchro) ne doit JAMAIS être servie depuis le cache.
  if (new URL(request.url).hostname === 'api.github.com') return;

  // Navigation : réseau d'abord (pour récupérer les mises à jour), repli hors ligne sur le cache.
  // « no-cache » force la revalidation auprès du serveur : GitHub Pages annonce
  // dix minutes de cache HTTP sur index.html, et un index périmé pointerait vers
  // des assets fingerprintés d'une version précédente.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); return r; })
        .catch(() => caches.match(request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Assets (JS/CSS fingerprintés, polices Google, icônes) : cache d'abord,
  // réseau en repli. caches.match sans nom cherche dans toutes les générations,
  // donc un asset encore présent dans la précédente est servi hors ligne.
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
