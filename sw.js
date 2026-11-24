// Keeps the app shell available offline; data always comes fresh from Supabase.
const SHELL = "tm-shell-v3";
self.addEventListener("install", e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(["./", "index.html", "manifest.json", "icon.svg", "config.js", "lib/supabase.js", "lib/marked.min.js", "lib/purify.min.js"]))));
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(SHELL).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
