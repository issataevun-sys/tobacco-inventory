
(function(){
'use strict';
var inventorySession='',inventoryName='';
var state={secret:'',bridgeUrl:'',snapshot:null,queue:[],conflict:''},db,storeKey='inventory',syncing=false,ui,active=true;
function setStatus(s){var status=document.getElementById('status');if(!status)return;status.textContent=s;status.dataset.state=state.conflict?'conflict':!navigator.onLine?'offline':syncing||state.queue.length?'syncing':'online'}
function openDb(){return new Promise(function(resolve,reject){
 var r=indexedDB.open('cr-temp-tobacco-v1',1);
 r.onupgradeneeded=function(){r.result.createObjectStore('kv')};
 r.onsuccess=function(){resolve(r.result)};r.onerror=function(){reject(r.error)};
})}
function getSaved(){return new Promise(function(resolve,reject){
 var tx=db.transaction('kv','readonly'),r=tx.objectStore('kv').get(storeKey);
 r.onsuccess=function(){resolve(r.result||null)};r.onerror=function(){reject(r.error)};
})}
function persist(){return new Promise(function(resolve,reject){
 var tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(state,storeKey);
 tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error)};
})}


async function rpc(method,payload){
 if(!navigator.onLine)throw Error('Нет интернета');
 if(!{crStaffTobaccoActive:1,crStaffTobaccoCreate:1,crStaffTobaccoSave:1,crStaffTobaccoBarcodeSave:1,crInventoryPinLogin:1,crInventoryPinLogout:1}[method])throw Error('Недоступная операция');
 if(!state.bridgeUrl||!/^https:\/\/[a-z0-9.-]+(?:\/[^?#]*)?$/i.test(state.bridgeUrl))throw Error('Не указан адрес сервера синхронизации');
 const controller=new AbortController(),timer=setTimeout(function(){controller.abort()},65000);
 try{
  const response=await fetch(state.bridgeUrl,{method:'POST',mode:'cors',
   headers:{'Content-Type':'text/plain;charset=utf-8'},
   body:JSON.stringify({method:method,payload:Object.assign({},payload||{},{deviceSecret:state.secret,inventorySession:inventorySession})}),
   cache:'no-store',signal:controller.signal});
  const result=await response.json().catch(function(){return null});
  if(!response.ok)throw Error(String(result&&result.error||'Сервер синхронизации: HTTP '+response.status));
  if(!result||result.ok!==true)throw Error(String(result&&result.error||'Ошибка сервера'));
  return result.result;
 }catch(e){throw Error(e&&e.name==='AbortError'?(method==='crStaffTobaccoBarcodeSave'?'Ответ сервера не получен. Проверьте штрихкод в списке перед повторным сохранением':'Превышено время ответа сервера'):String(e&&e.message||e))}
 finally{clearTimeout(timer)}
}
function clone(obj){return JSON.parse(JSON.stringify(obj))}
function value(v){return v===null||v===undefined||v===''?null:Number(v)}
function localApply(payload){
 var snapshot=state.snapshot;if(!snapshot||!snapshot.active)throw Error('Нет открытой инвентаризации');
 var byId=new Map(snapshot.lines.map(function(x){return [String(x.itemId),x]}));
 payload.lines.forEach(function(x){
  var current=byId.get(String(x.itemId));if(!current)return;
  if(payload.zone==='service'){
   if(current.category==='tobacco'){
    current.serviceGross=value(x.serviceGross);
    current.serviceTare=current.serviceGross===null?null:(current.serviceGross===0?0:(value(x.serviceTare)===null?Number(current.tare||0):value(x.serviceTare)));
   }else current.serviceQty=value(x.serviceQty);
  }else if(current.category==='tobacco')current.warehousePacks=clone(x.warehousePacks||[]);
  else current.warehouseQty=value(x.warehouseQty);
 });
}
function sameZone(remote,payload){
 if(!remote||!remote.active)return false;
 var byId=new Map(remote.lines.map(function(x){return [String(x.itemId),x]}));
 return payload.lines.every(function(x){
  var r=byId.get(String(x.itemId));if(!r)return false;
  if(payload.zone==='service')
   return r.category==='tobacco'?
    (value(r.serviceGross)===value(x.serviceGross)&&
     value(r.serviceTare)===(
      value(x.serviceGross)===null?null:(value(x.serviceGross)===0?0:
      (value(x.serviceTare)===null?Number(r.tare||0):value(x.serviceTare))))):
    value(r.serviceQty)===value(x.serviceQty);
  return r.category==='tobacco'?
   JSON.stringify(r.warehousePacks||[])===JSON.stringify(x.warehousePacks||[]):
   value(r.warehouseQty)===value(x.warehouseQty);
 });
}
function showStatus(){
 if(state.conflict){setStatus('Конфликт синхронизации: '+state.conflict);return}
 if(state.queue.length){setStatus((navigator.onLine?'Ожидает отправки: ':'Офлайн · не отправлено: ')+state.queue.length);return}
 setStatus(navigator.onLine?'Синхронизировано':'Офлайн · сохранено на iPhone');
}
async function flush(){
 if(syncing||!inventorySession||!state.secret||!navigator.onLine||!state.queue.length||state.conflict)return;
 syncing=true;
 try{
  var remote=await rpc('crStaffTobaccoActive',{});
  while(state.queue.length&&navigator.onLine){
   var op=state.queue[0];
   if(op.method==='create'){
    await rpc('crStaffTobaccoCreate',{day:op.day,operationId:op.id,queuedAt:op.queuedAt});
    remote=await rpc('crStaffTobaccoActive',{});
   }else{
    if(!sameZone(remote,op.payload)){
     if(!remote.active||remote.id!==op.payload.id||remote.revision!==op.baseRevision)
      throw Error('Изменения на сервере отличаются от исходной версии. Нужна ручная проверка');
     await rpc('crStaffTobaccoSave',Object.assign({},op.payload,{revision:remote.revision}));
     remote=await rpc('crStaffTobaccoActive',{});
    }
   }
   state.queue.shift();
   if(state.queue.length&&state.queue[0].method==='save')state.queue[0].baseRevision=remote.revision;
   await persist();
  }
  if(!state.queue.length){state.snapshot=remote;await persist()}
 }catch(e){
  var message=String(e&&e.message||e);
  if(/ручная проверка|уже завершена|несколько активных|неполный список|изменил|изменилось/.test(message)){
   state.conflict=message;await persist();
  }
  setStatus('Не синхронизировано · '+message);
 }finally{syncing=false;showStatus()}
}
var api={
 isActive:function(){return active},
 call:function(method,payload,success,failure){
  (async function(){
   try{
    if(!state.secret)throw Error('Устройство не активировано');
    if(!inventorySession)throw Error('Требуется вход по PIN');
    if(method==='crStaffTobaccoActive'){
     if(!state.queue.length&&navigator.onLine){
      try{state.snapshot=await rpc(method,{});await persist()}
      catch(e){if(!state.snapshot)throw e}
     }
     if(!state.snapshot)throw Error('Сначала откройте приложение с интернетом, чтобы загрузить инвентаризацию');
     success(clone(state.snapshot));showStatus();return;
    }
    if(method==='crStaffTobaccoBarcodeSave'){
     // Catalog writes are strictly online and never join the inventory offline queue.
     if(!navigator.onLine)throw Error('Для добавления штрихкода требуется интернет');
     var answer=await rpc(method,payload);
     if(state.snapshot){
      state.snapshot.barcodes=state.snapshot.barcodes||[];
      if(!state.snapshot.barcodes.some(function(x){return x.barcode===answer.barcode}))
       state.snapshot.barcodes.push({barcode:answer.barcode,itemId:answer.itemId,pack:answer.pack});
      await persist();
     }
     success(answer);showStatus();return;
    }
    if(state.conflict)throw Error('Есть конфликт синхронизации; редактирование временно заблокировано');
    if(method==='crStaffTobaccoCreate'){
     if(!state.snapshot||state.snapshot.active)throw Error('Обновите состояние инвентаризации');
     if(!state.snapshot.template||!state.snapshot.template.length){
      if(!navigator.onLine)throw Error('Нужна предварительная загрузка списка онлайн');
      await rpc(method,payload);
      state.snapshot=await rpc('crStaffTobaccoActive',{});
     }else{
      var id=crypto.randomUUID(),queuedAt=Date.now();
      state.snapshot={ok:true,active:true,id:id,day:payload.day,revision:'',lines:clone(state.snapshot.template),barcodes:clone(state.snapshot.barcodes||[]),flavors:clone(state.snapshot.flavors||[])};
      state.queue.push({method:'create',id:id,day:payload.day,queuedAt:queuedAt});
     }
    }else if(method==='crStaffTobaccoSave'){
     if(!state.snapshot||!state.snapshot.active)throw Error('Нет активной инвентаризации');
     state.queue.push({method:'save',payload:clone(payload),baseRevision:state.snapshot.revision});
     localApply(payload);
    }else throw Error('Недоступная операция');
    await persist();success({ok:true,queued:state.queue.length>0});
    showStatus();flush();
   }catch(e){failure(e&&e.message||String(e))}
  })();
 }
};
async function start(){
 try{
  db=await openDb();var saved=await getSaved();if(saved)state=Object.assign(state,saved);
  if(!state.secret||!state.bridgeUrl){
   document.getElementById('setup').hidden=false;
    document.getElementById('bridgeUrl').value=state.bridgeUrl||'';
   setStatus('Первичная активация устройства');
   document.getElementById('activate').onclick=async function(){
    var key=document.getElementById('key').value.trim();
     var bridge=document.getElementById('bridgeUrl').value.trim().replace(/\/+$/,'');
     if(!/^https:\/\/[a-z0-9.-]+(?:\/[^?#]*)?$/i.test(bridge)){(document.getElementById('setupError')||document.getElementById('status')).textContent='Укажите HTTPS-адрес Cloudflare Worker';return}
     state.bridgeUrl=bridge;
    if(!/^[A-Za-z0-9]{8}$/.test(key)){(document.getElementById('setupError')||document.getElementById('status')).textContent='Введите 8 латинских букв и цифр';return}
    state.secret=key;
    try{state.snapshot=await rpc('crStaffTobaccoActive',{}).catch(function(e){if(/PIN|вход|сессия/i.test(e.message))return state.snapshot;throw e});await persist();showPin()}
    catch(e){state.secret='';(document.getElementById('setupError')||document.getElementById('status')).textContent=e.message}
   };
   return;
  }
  showPin();
 }catch(e){setStatus('Локальное хранилище недоступно: '+e.message)}
}
function showPin(){
 inventorySession='';inventoryName='';
 if(ui){ui.clear();ui=null}
 document.getElementById('inventory').hidden=true;
 document.getElementById('pinScreen').hidden=false;
 document.getElementById('setup').hidden=true;
 document.getElementById('pin').value='';
 document.getElementById('pinError').textContent='';
 setStatus('Вход сотрудника');
}
document.getElementById('pinForm').onsubmit=async function(event){
 event.preventDefault();
 var pin=document.getElementById('pin').value;
 if(!/^[0-9]{6}$/.test(pin)){document.getElementById('pinError').textContent='Введите 6 цифр';return}
 var btn=document.getElementById('pinSubmit');btn.disabled=true;
 try{
  var user=await rpc('crInventoryPinLogin',{pin:pin});
  inventorySession=user.token;inventoryName=user.name||'';
  document.getElementById('pin').value='';
  launch();
 }catch(e){document.getElementById('pinError').textContent=e.message}
 finally{btn.disabled=false}
};
document.getElementById('logout').onclick=async function(){
 var previous=inventorySession;
 inventorySession='';
 showPin();
 if(previous&&navigator.onLine){
  inventorySession=previous;
  try{await rpc('crInventoryPinLogout',{})}catch(e){}
  inventorySession='';
 }
};
function launch(){
 document.getElementById('setup').hidden=true;
 document.getElementById('pinScreen').hidden=true;
 document.getElementById('inventory').hidden=false;
 document.getElementById('logout').hidden=false;
 if(ui)ui.clear();
 ui=window.crStaffTobaccoFactory(api);
 ui.mount(document.getElementById('inventory'));
 showStatus();flush();
}
document.getElementById('retry').onclick=function(){
 if(state.conflict){setStatus('Конфликт: данные сохранены локально');return}
 if(ui && state.snapshot && state.snapshot.active && !window.confirm('Обновить данные? Несохранённые значения в полях будут потеряны.'))return;
 if(state.queue.length){flush();return}
 if(ui)ui.refresh();else if(inventorySession)flush();
};
window.addEventListener('online',function(){showStatus();flush()});
window.addEventListener('offline',showStatus);
document.addEventListener('visibilitychange',function(){if(!document.hidden)flush()});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(function(){});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
