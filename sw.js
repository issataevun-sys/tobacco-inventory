/* Versioned atomic app shell. Never touch IndexedDB or pending operation data. */
const VERSION='1.3.29';
const SHELL_CACHE='cr-inventory-pwa-v'+VERSION;
const DECODER_CACHE='cr-inventory-zxing-v1';
const SHELL=['index.html','app.js','icon.png','manifest.webmanifest','version.json'];
const DECODERS=new Set([
 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'
]);
function asset(name){return new URL(name,self.registration.scope).href;}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(SHELL_CACHE);
 try{
  const entries=await Promise.all(SHELL.map(async name=>{
   const response=await fetch(asset(name)+'?release='+VERSION,{cache:'no-store'});
   if(!response.ok)throw Error('Missing shell asset '+name);
   if(name==='index.html'&&!(await response.clone().text()).includes('app.js?v='+VERSION))throw Error('HTML version mismatch');
   if(name==='app.js'&&!(await response.clone().text()).includes("APP_VERSION='"+VERSION+"'"))throw Error('JS version mismatch');
   if(name==='version.json'&&(await response.clone().json()).version!==VERSION)throw Error('Release version mismatch');
   return [asset(name),response];
  }));
  await Promise.all(entries.map(pair=>cache.put(pair[0],pair[1])));
 }catch(e){await caches.delete(SHELL_CACHE);throw e;}
})()));
self.addEventListener('message',event=>{
 if(event.data&&event.data.type==='GET_VERSION'&&event.ports[0])event.ports[0].postMessage({version:VERSION});
 if(event.data&&event.data.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 // Keep prior shell caches for already-open clients; delete no application data.
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url),scope=new URL(self.registration.scope);
 if(DECODERS.has(url.href)){
  event.respondWith(caches.open(DECODER_CACHE).then(async cache=>{
   const found=await cache.match(req);if(found)return found;
   const res=await fetch(req);if(res.ok||res.type==='opaque')await cache.put(req,res.clone());return res;
  }));return;
 }
 if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 const name=url.pathname.slice(scope.pathname.length);
 if(name==='version.json')return; // always live, never block release checks
 if(req.mode==='navigate'||name===''||name==='index.html'){
  event.respondWith(caches.open(SHELL_CACHE).then(async cache=>(await cache.match(asset('index.html')))||fetch(req)));return;
 }
 if(name==='app.js'){
  event.respondWith((async()=>{
   const requested=url.searchParams.get('v');
   const cache=await caches.open(requested&&/^\d+\.\d+\.\d+$/.test(requested)?'cr-inventory-pwa-v'+requested:SHELL_CACHE);
   const found=await cache.match(asset('app.js'),{ignoreSearch:true});if(found)return found;
   return fetch(req);
  })());return;
 }
 if(SHELL.includes(name))event.respondWith(caches.open(SHELL_CACHE).then(async cache=>(await cache.match(asset(name)))||fetch(req)));
});
