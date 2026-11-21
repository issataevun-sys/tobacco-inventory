'use strict';
const $=id=>document.getElementById(id);
const DB='tobacco-inventory-scanner-v1';
let db=null,scanner=null,scanning=false,stopPending=false,scanLocked=false;
const setStatus=t=>{$('status').textContent=t};
const makeId=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2);
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function transaction(mode,fn){return new Promise((resolve,reject)=>{const tx=db.transaction('records',mode),store=tx.objectStore('records');let req;try{req=fn(store)}catch(e){reject(e);return}tx.oncomplete=()=>resolve(req?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
function normalizeCode(raw){
 const s=String(raw||'').replace(/^\s+|\s+$/g,'');
 // GS1 element string: AI 01 + 14-digit GTIN, often preceded by symbology identifier ]d2.
 const cleaned=s.replace(/^\]d[12]/,'').replace(/^\]Q3/,'');
 let match=cleaned.match(/(?:^|\x1d|\()01\)?(\d{14})/);
 if(match)return match[1];
 // GS1 human-readable text sometimes separates AI (01) and GTIN with spaces.
 match=cleaned.match(/\(01\)\s*(\d{14})/);
 if(match)return match[1];
 // GS1 Data Matrix raw payload can start with 01 without separators.
 if(/^01\d{14}/.test(cleaned))return cleaned.slice(2,16);
 const digits=cleaned.replace(/\D/g,'');
 if(/^\d{13,14}$/.test(digits))return digits.length===13?'0'+digits:digits;
 return null;
}
function validGtin(s){
 if(!/^\d{14}$/.test(s))return false;
 let sum=0;for(let i=12;i>=0;i--)sum+=Number(s[i])*((12-i)%2===0?3:1);
 return (10-sum%10)%10===Number(s[13]);
}
function renderRow(r){
 const li=document.createElement('li'),left=document.createElement('div'),title=document.createElement('div'),sub=document.createElement('div'),right=document.createElement('div');
 title.className='item-title';title.textContent=r.flavor||'Не указан вкус';sub.className='item-sub';sub.textContent=r.gtin+' · '+new Date(r.createdAt).toLocaleString('ru-RU');
 right.className='item-weight';right.textContent=r.weight+' г';left.append(title,sub);li.append(left,right);return li;
}
async function rows(){const all=await transaction('readonly',s=>s.getAll());return all.sort((a,b)=>b.createdAt-a.createdAt)}
async function refresh(){const all=await rows();$('count').textContent=String(all.length);$('items').replaceChildren(...all.map(renderRow))}
function clearEntry(){$('code').value='';$('flavor').value='';$('weight').value=''}
function scanFound(raw){
 if(scanLocked)return;
 const code=normalizeCode(raw);
 if(!code||!validGtin(code)){
  // Do not silently discard a successfully decoded Data Matrix: show a safe preview for diagnosis.
  $('result').textContent='Код распознан, но GTIN не найден. Начало данных: '+String(raw).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,35);
  return;
 }
 scanLocked=true;
 $('code').value=code;$('result').textContent='GTIN определён: '+code;
 stopScanner().then(()=>$('weight').focus());
}
async function loadDecoder(){
 if(window.Html5Qrcode)return;
 const script=document.createElement('script');script.src='https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
 await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(Error('Библиотека сканера недоступна. Проверьте интернет.'));document.head.append(script)});
 // Cache the decoder when first loaded so subsequent PWA launches may work offline.
 try{const cache=await caches.open('tobacco-decoder-v1');await cache.add(script.src)}catch(_){}
}
async function startScanner(){
 if(scanning||stopPending)return;
 scanLocked=false;
 try{
  $('start').disabled=true;setStatus('Запуск камеры…');
  await loadDecoder();
  if(!window.Html5Qrcode)throw Error('Сканер не загрузился');
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Нет доступа к камере: откройте PWA по HTTPS');
  $('scanner').hidden=false;
  const formats=[Html5QrcodeSupportedFormats.DATA_MATRIX,Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.EAN_8,Html5QrcodeSupportedFormats.UPC_A];
  // Explicit ZXing decoder: experimental native BarcodeDetector can omit Data Matrix.
  scanner=new Html5Qrcode('reader',{formatsToSupport:formats,verbose:false,experimentalFeatures:{useBarCodeDetectorIfSupported:false}});
  // Square viewfinder suits tiny 2D codes; 1080p source improves fine-module resolution.
  const viewport=Math.min(Math.max(window.innerWidth-50,220),440);
  const side=Math.min(280,Math.max(170,viewport-45));
  await scanner.start({facingMode:'environment'},{fps:15,qrbox:{width:side,height:side},aspectRatio:1,videoConstraints:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}}},scanFound,()=>{});
  const video=document.querySelector('#reader video');
  if(video){video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.muted=true;video.controls=false;}
  scanning=true;$('stop').disabled=false;setStatus('Наведите камеру на штрихкод или Data Matrix');
 }catch(e){setStatus('Камера: '+(e?.message||e));$('scanner').hidden=true;scanner=null}
 finally{$('start').disabled=false}
}
async function stopScanner(){
 if(stopPending)return;stopPending=true;
 try{if(scanner){if(scanning)await scanner.stop();scanner.clear()}}catch(_){}
 finally{scanner=null;scanning=false;stopPending=false;$('scanner').hidden=true;$('stop').disabled=true;setStatus('Готово к сканированию')}
}
async function save(){
 const raw=$('code').value.trim(),gtin=normalizeCode(raw),weight=Number($('weight').value.replace(',','.'));
 if(!gtin||!validGtin(gtin)){setStatus('Введите правильный GTIN (EAN-13 или 14 цифр, контрольная цифра обязательна)');return}
 if($('weight').value.trim()===''||!Number.isFinite(weight)||weight<0||weight>100000){setStatus('Введите корректный вес');return}
 const flavor=$('flavor').value.trim();
 if(!flavor){setStatus('Укажите вкус. Автоматическая привязка появится после подключения каталога');return}
 await transaction('readwrite',s=>s.put({id:makeId(),gtin,flavor,weight,createdAt:Date.now()}));
 clearEntry();await refresh();setStatus('Сохранено на этом iPhone · не отправлено в Google Sheets');
}
async function exportJson(){const all=await rows();if(!all.length){setStatus('Нет записей для экспорта');return}
 const blob=new Blob([JSON.stringify({schema:'cr-tobacco-scanner-v1',records:all},null,2)],{type:'application/json'});
 const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download='tobacco-inventory-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),5000)}
async function init(){
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
 try{db=await openDb();await refresh();setStatus('Тестовая PWA · данные хранятся локально; синхронизация с Google Sheets ещё не подключена')}catch(e){setStatus('Ошибка локального хранилища: '+e.message);return}
 $('start').onclick=startScanner;$('stop').onclick=stopScanner;$('cancel').onclick=clearEntry;
 $('save').onclick=()=>save().catch(e=>setStatus('Ошибка записи: '+e.message));
 $('export').onclick=()=>exportJson().catch(e=>setStatus('Ошибка экспорта: '+e.message));
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&scanning)stopScanner()});
}
init();
