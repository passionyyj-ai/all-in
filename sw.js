const CACHE_NAME='allin-v5.1.0';
const APP_SHELL=['./','./index.html','./admin.html','./styles.css?v=5.1.0','./config.js?v=5.1.0','./common.js?v=5.1.0','./member.js?v=5.1.0','./admin.js?v=5.1.0','./allin-manifest-v510.webmanifest','./allin-logo.png','./allin-app-icon-192-v503.png','./allin-app-icon-512-v503.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 if(u.hostname.includes('supabase.co'))return;
 if(e.request.mode==='navigate'){
  e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));return;
 }
 e.respondWith(caches.match(e.request).then(cached=>{const network=fetch(e.request).then(r=>{if(r&&r.status===200&&r.type==='basic'){const x=r.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,x))}return r}).catch(()=>cached);return cached||network}));
});
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});
