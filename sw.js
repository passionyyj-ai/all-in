const CACHE_NAME='allin-v5.7.4';
const APP_SHELL=[
 './','./index.html','./admin.html','./operation.html',
 './styles.css?v=5.7.4','./config.js?v=5.7.4','./common.js?v=5.7.4',
 './member.js?v=5.7.4','./admin.js?v=5.7.4','./operation.js?v=5.7.4',
 './manifest-member.webmanifest?v=5.7.4','./manifest-admin.webmanifest?v=5.7.4',
 './allin-logo.png','./icon-member-192.png','./icon-member-512.png',
 './icon-admin-192.png','./icon-admin-512.png'
  './icon-member-192.png?v=574',
  './icon-member-512.png?v=574',
  './icon-admin-192.png?v=574',
  './icon-admin-512.png?v=574',
];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 if(u.hostname.includes('supabase.co'))return;
 if(e.request.mode==='navigate'){
  e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,x));return r})
    .catch(()=>caches.match(e.request).then(r=>r||caches.match(e.request.url.includes('admin')?'./admin.html':'./index.html'))));
  return;
 }
 e.respondWith(caches.match(e.request).then(cached=>{
  const network=fetch(e.request).then(r=>{if(r&&r.status===200&&r.type==='basic'){const x=r.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,x))}return r}).catch(()=>cached);
  return cached||network;
 }));
});
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});
