const CACHE='tobacco-inventory-v2';
const BASE=new URL('./',self.registration.scope).href;
const DECODER='https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
const DECODER_CACHE='tobacco-decoder-v1';
const SHELL=['./','./index.html','./app.js','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tobacco-inventory-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()]))});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.href===DECODER){
  event.respondWith(caches.open(DECODER_CACHE).then(async cache=>{
    const cached=await cache.match(req);
    if(cached)return cached;
    const response=await fetch(req);
    if(response.ok||response.type==='opaque')await cache.put(req,response.clone());
    return response;
  }));
  return;
 }
 if(url.origin!==self.location.origin)return;
 if(!url.href.startsWith(BASE))return;
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{
  if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{})}
  return res;
 })));
});
