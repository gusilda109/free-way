// Минимальный service worker: нужен для установки PWA.
// Офлайн-режим в MVP не реализуется, поэтому ничего не кэшируем.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
