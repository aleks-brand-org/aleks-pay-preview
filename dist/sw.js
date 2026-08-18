/*
 * Offline shell (spec section 42).
 *
 * Caches the application shell only. Financial data lives in the encrypted
 * IndexedDB vault and is never written to the Cache API, so clearing the cache
 * cannot leak or lose it, and a stale cache cannot serve stale money.
 *
 * Hand-written rather than generated: a service worker is the one script that
 * can outlive a bad deploy, so it should be short enough to read in full.
 */

const CACHE = 'aleks-pay-shell-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Never cache anything that is not a same-origin GET: API traffic carries
  // signed, short-lived requests and must not be replayed from a cache.
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(request, copy))
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('/index.html'))),
  )
})
