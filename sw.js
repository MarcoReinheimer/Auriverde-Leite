// Deixa o app abrir sem internet: guarda os arquivos do app e as bibliotecas
// (Excel, PDF, fontes) na primeira vez que são usados.
const VERSAO = 'auriverde-v1';
const ARQUIVOS = ['./', './index.html', './claude-local.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const doApp = url.origin === self.location.origin;
  if (doApp) {
    // arquivos do app: tenta a versão nova na internet; sem internet, usa a guardada
    e.respondWith(
      fetch(req).then((r) => { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); return r; })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
  } else {
    // bibliotecas e fontes: usa a guardada; se não tiver, baixa e guarda
    e.respondWith(
      caches.match(req).then((r) => r || fetch(req).then((resp) => { const copia = resp.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); return resp; }))
    );
  }
});
