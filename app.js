
(function(){
'use strict';
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


var readCounter=0;
function readActive(){
 return new Promise(function(resolve,reject){
  if(!navigator.onLine){reject(Error('Нет интернета'));return}
  var callback='__crInvCallback_'+Array.from(crypto.getRandomValues(new Uint8Array(16)),function(x){return x.toString(16).padStart(2,'0')}).join('');
  var script=document.createElement('script'),complete=false;
  var timer=setTimeout(function(){finish(Error('Нет ответа от Google Apps Script. Проверьте новую версию развёртывания GAS.'))},20000);
  function finish(err,result){
   if(complete)return;complete=true;clearTimeout(timer);script.remove();delete window[callback];
   if(err)reject(err);else resolve(result);
  }
  window[callback]=function(body){
   if(!body||body.ok!==true)finish(Error(String(body&&body.error||'Ошибка Google Apps Script')));
   else finish(null,body.result);
  };
  script.onerror=function(){finish(Error('Не удалось прочитать данные из GAS. Проверьте адрес /exec и доступ.'))};
  script.src=state.bridgeUrl+'?action=active&callback='+encodeURIComponent(callback)+'&key='+encodeURIComponent(state.secret)+'&t='+Date.now()+'_'+(++readCounter);
  document.head.appendChild(script);
 });
}
function delay(ms){return new Promise(function(ok){setTimeout(ok,ms)})}
async function rpc(method,payload){
 if(!navigator.onLine)throw Error('Нет интернета');
 if(!state.bridgeUrl)throw Error('Укажите ссылку Google Apps Script');
 if(method==='crStaffTobaccoActive')return readActive();
 if(method!=='crStaffTobaccoSave'&&method!=='crStaffTobaccoCreate')throw Error('Недоступная операция');
 // GAS accepts text/plain POST. No CORS-readable response: always verify via authenticated reread.
 var data=Object.assign({},payload||{},{deviceSecret:state.secret});
 try{
  await fetch(state.bridgeUrl,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},
   body:JSON.stringify({method:method,payload:data}),cache:'no-store',redirect:'follow'});
 }catch(e){
  // An opaque redirected response can fail even when the server has applied the operation.
  // Never retry a potentially completed write blindly; check server state first.
 }
 var result=null;
 for(var attempt=0;attempt<7;attempt++){
  if(attempt)await delay(900+attempt*350);
  try{result=await readActive()}catch(e){if(attempt===6)throw e;continue}
  if(method==='crStaffTobaccoSave'&&sameZone(result,data))return {ok:true,verified:true};
  if(method==='crStaffTobaccoCreate'&&result&&result.active&&result.day===data.day)return {ok:true,verified:true};
 }
 throw Error('Сервер не подтвердил сохранение. Данные остаются локально; повторное сохранение не требуется.');
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
 if(syncing||!state.secret||!navigator.onLine||!state.queue.length||state.conflict)return;
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
    if(method==='crStaffTobaccoActive'){
     if(!state.queue.length&&navigator.onLine){
      try{state.snapshot=await rpc(method,{});await persist()}
      catch(e){if(!state.snapshot)throw e}
     }
     if(!state.snapshot)throw Error('Сначала откройте приложение с интернетом, чтобы загрузить инвентаризацию');
     success(clone(state.snapshot));showStatus();return;
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
      state.snapshot={ok:true,active:true,id:id,day:payload.day,revision:'',lines:clone(state.snapshot.template),barcodes:clone(state.snapshot.barcodes||[])};
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
     if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(bridge)){(document.getElementById('setupError')||document.getElementById('status')).textContent='Укажите ссылку GAS, оканчивающуюся на /exec';return}
     state.bridgeUrl=bridge;
    if(!/^[A-Za-z0-9]{8}$/.test(key)){(document.getElementById('setupError')||document.getElementById('status')).textContent='Введите 8 латинских букв и цифр';return}
    state.secret=key;
    try{state.snapshot=await rpc('crStaffTobaccoActive',{});await persist();launch()}
    catch(e){state.secret='';(document.getElementById('setupError')||document.getElementById('status')).textContent=e.message}
   };
   return;
  }
  launch();
 }catch(e){setStatus('Локальное хранилище недоступно: '+e.message)}
}
function launch(){
 document.getElementById('setup').hidden=true;
 document.getElementById('inventory').hidden=false;
 ui=window.crStaffTobaccoFactory(api);
 ui.mount(document.getElementById('inventory'));
 showStatus();flush();
}
document.getElementById('retry').onclick=function(){
 if(state.conflict){setStatus('Конфликт: данные сохранены локально');return}
 if(ui && state.snapshot && state.snapshot.active && !window.confirm('Обновить данные? Несохранённые значения в полях будут потеряны.'))return;
 if(state.queue.length){flush();return}
 if(ui)ui.refresh();else flush();
};
window.addEventListener('online',function(){showStatus();flush()});
window.addEventListener('offline',showStatus);
document.addEventListener('visibilitychange',function(){if(!document.hidden)flush()});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(function(){});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
