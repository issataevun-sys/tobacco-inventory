/* v1.2.0: standalone inventory shell and cached ZXing decoder. */
const SHELL_CACHE='cr-inventory-pwa-v1.2.4';
const DECODER_CACHE='cr-inventory-zxing-v1';
const SHELL=['./','./index.html','./app.js','./icon.svg','./manifest.webmanifest'];
const DECODERS=new Set([
 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'
]);
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(
 Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('cr-inventory-pwa-')&&k!==SHELL_CACHE)||(k.startsWith('tobacco-inventory-'))).map(k=>caches.delete(k)))),
  self.clients.claim()
 ])
));
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(DECODERS.has(url.href)){
  event.respondWith(caches.open(DECODER_CACHE).then(async cache=>{
   const found=await cache.match(req);if(found)return found;
   const res=await fetch(req);
   if(res.ok||res.type==='opaque')await cache.put(req,res.clone());
   return res;
  }));
  return;
 }
 if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
 event.respondWith(caches.open(SHELL_CACHE).then(async cache=>{
  const found=await cache.match(req);
  if(found)return found;
  return fetch(req);
 }));
});
