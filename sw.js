const CACHE_NAME = 'layerlama-admin-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return new Response('<h1 style="font-family:sans-serif;color:#aaa;text-align:center;margin-top:4rem;">Offline — check your connection</h1>', {
                headers: { 'Content-Type': 'text/html' }
            });
        })
    );
});
