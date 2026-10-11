/* NMA BUILD OS 4.5.0 — Field PWA Service Worker */
const CACHE='nma-build-field-4.5.0';
const STATIC=['/offline.html','/manifest.webmanifest','/nma_offline_enterprise_45.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('nma-build-field-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{if(e.data?.type==='PURGE_FIELD_CACHE')e.waitUntil(caches.delete(CACHE).then(()=>caches.open(CACHE).then(c=>c.addAll(STATIC))))});
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;if(u.pathname.startsWith('/api/'))return;
 if(r.mode==='navigate'&&u.pathname==='/cantiere'){
   e.respondWith(fetch(r).then(resp=>{if(resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put('/cantiere',clone))}return resp}).catch(()=>caches.match('/cantiere').then(x=>x||caches.match('/offline.html'))));return;
 }
 if(STATIC.includes(u.pathname))e.respondWith(caches.match(r).then(c=>c||fetch(r)));
});
