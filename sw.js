// Keeps the app shell available offline; data always comes fresh from Supabase.
// Network first, and the browser cache is skipped, so a new version shows up on the next open.
const SHELL = "tm-shell-v28";
const FILES = ["./", "index.html", "manifest.json", "icon.svg", "config.js", "lib/supabase.js", "lib/marked.min.js", "lib/purify.min.js"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"}))))); });
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, {cache: "no-store"}).then(r => { const c = r.clone(); caches.open(SHELL).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
