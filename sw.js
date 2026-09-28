// Deixa o app abrir sem internet. Guarda os arquivos do app e as bibliotecas
// (Excel, PDF, fontes). NUNCA guarda os dados do Supabase: esses vêm sempre do banco.
const VERSAO = 'auriverde-v3';
const ARQUIVOS = ['./', './index.html', './config.js', './supabase.js', './claude-supabase.js', './claude-local.js',
  './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
const BIBLIOTECAS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

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
  if (url.origin === self.location.origin) {
    // arquivos do app: tenta a versão nova; sem internet, usa a guardada
    e.respondWith(
      fetch(req).then((r) => { if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); } return r; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
  } else if (BIBLIOTECAS.includes(url.hostname)) {
    // bibliotecas e fontes: usa a guardada; se não tiver, baixa e guarda
    e.respondWith(
      caches.match(req).then((r) => r || fetch(req).then((resp) => { const copia = resp.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); return resp; }))
    );
  }
  // qualquer outra coisa (Supabase, login): vai direto para a internet, sem guardar
});
