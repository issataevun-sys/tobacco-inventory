
(function(){
'use strict';
var APP_VERSION='1.3.27',pendingWrites=0,pendingCalls=0,pendingRpc=0,updateApplying=false,updateRegistration=null,updateCandidate=null,updateDeferred=null,updateCheckedAt=0,storageReady=false;
var inventorySession='',inventoryName='',canManageBarcodes=false;
var state={secret:'',bridgeUrl:'',inventoryDeviceId:'',snapshot:null,queue:[],conflict:''},db,storeKey='inventory',syncing=false,ui,active=true;
function inventoryCreateDeviceId(){
 if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();
 if(window.crypto&&crypto.getRandomValues){
  var bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  var hex=Array.from(bytes).map(function(x){return x.toString(16).padStart(2,'0')}).join('');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
 }
 throw Error('Устройство не поддерживает безопасную генерацию идентификатора');
}
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
function persist(){pendingWrites++;return new Promise(function(resolve,reject){
 var tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(state,storeKey);
 tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error)};tx.onabort=function(){reject(tx.error||Error('Хранилище: операция прервана'))};
}).finally(function(){pendingWrites--;})}


async function rpc(method,payload){
 if(updateApplying)throw Error('Приложение обновляется');
 if(!navigator.onLine)throw Error('Нет интернета');
 if(!{crStaffTobaccoActive:1,crStaffTobaccoCreate:1,crStaffTobaccoSave:1,crStaffTobaccoBarcodeSave:1,crInventoryPinLogin:1,crInventoryPinLogout:1}[method])throw Error('Недоступная операция');
 if(!state.bridgeUrl||!/^https:\/\/[a-z0-9.-]+(?:\/[^?#]*)?$/i.test(state.bridgeUrl))throw Error('Не указан адрес сервера синхронизации');
 const controller=new AbortController(),timer=setTimeout(function(){controller.abort()},65000);pendingRpc++;
 try{
  const response=await fetch(state.bridgeUrl,{method:'POST',mode:'cors',
   headers:{'Content-Type':'text/plain;charset=utf-8'},
   body:JSON.stringify({method:method,payload:Object.assign({},payload||{},{deviceSecret:state.secret,inventorySession:inventorySession,inventoryDeviceId:state.inventoryDeviceId})}),
   cache:'no-store',signal:controller.signal});
  const result=await response.json().catch(function(){return null});
  if(!response.ok)throw Error(String(result&&result.error||'Сервер синхронизации: HTTP '+response.status));
  if(!result||result.ok!==true){
   var requestError=Error(String(result&&result.error||'Ошибка сервера'));
   requestError.retryAfterMs=Math.max(0,Number(result&&result.retryAfterMs)||0);
   throw requestError;
  }
  return result.result;
 }catch(e){
  if(e&&e.retryAfterMs>0)throw e;
  throw Error(e&&e.name==='AbortError'?(method==='crStaffTobaccoBarcodeSave'?'Ответ сервера не получен. Проверьте штрихкод в списке перед повторным сохранением':'Превышено время ответа сервера'):String(e&&e.message||e));
 }
 finally{clearTimeout(timer);pendingRpc--;}
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
 if(updateApplying||syncing||!inventorySession||!state.secret||!navigator.onLine||!state.queue.length||state.conflict)return;
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
 onBarcodeClose:function(){exitBarcodePage()},
 isActive:function(){return active},
 call:function(method,payload,success,failure){
  if(updateApplying){failure('Приложение обновляется');return;}pendingCalls++;
  (async function(){
   try{
    if(!state.secret)throw Error('Устройство не активировано');
    if(!inventorySession)throw Error('Требуется вход по PIN');
    if(method==='crStaffTobaccoBarcodeSave'&&!canManageBarcodes)throw Error('Добавлять штрихкоды может только владелец');
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
   }catch(e){failure(e&&e.message||String(e))}finally{pendingCalls--;}
  })();
 }
};
async function start(){
 try{
  db=await openDb();var saved=await getSaved();if(saved)state=Object.assign(state,saved);storageReady=true;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.inventoryDeviceId||'')){
   state.inventoryDeviceId=inventoryCreateDeviceId();
   await persist();
  }
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
    try{await persist();showPin()}
    catch(e){state.secret='';(document.getElementById('setupError')||document.getElementById('status')).textContent=e.message}
   };
   return;
  }
  showPin();
 }catch(e){setStatus('Локальное хранилище недоступно: '+e.message)}
}
function showPin(){
 inventorySession='';inventoryName='';canManageBarcodes=false;
 if(ui){ui.clear();ui=null}
 document.getElementById('inventory').hidden=true;
 document.getElementById('staffBar').hidden=true;
 document.getElementById('barcodeCard').hidden=true;
 document.getElementById('barcodePage').hidden=true;
 document.getElementById('status').hidden=false;
 document.getElementById('pinScreen').hidden=false;
 document.getElementById('setup').hidden=true;
 document.getElementById('pin').value='';
 pinReset();
 document.body.classList.add('inventoryLogin');
 document.getElementById('pinError').textContent='';
 pinLockRestore();
 setStatus('Вход сотрудника');
}
var pinPhase='idle',pinTimer=null,pinLockTimer=null,pinLockUntil=0;
var pinLockKey=function(){return 'cr-inventory-pin-lock-until-'+state.inventoryDeviceId};
function pinLockRender(){
 var remain=Math.max(0,pinLockUntil-Date.now());
 var card=document.getElementById('pinLock'),time=document.getElementById('pinLockTime');
 if(!remain){
  if(pinLockTimer){clearInterval(pinLockTimer);pinLockTimer=null}
  pinLockUntil=0;
  try{localStorage.removeItem(pinLockKey())}catch(_){}
  card.hidden=true;
  if(pinPhase==='locked'){
   pinPhase='idle';
   document.getElementById('pin').disabled=false;
   document.getElementById('pinSubmit').disabled=false;
   pinEntry().classList.remove('is-verifying','is-error');
   document.getElementById('pinError').textContent='';
   pinUpdate();
  }
  return;
 }
 pinPhase='locked';
 document.getElementById('pin').disabled=true;
 document.getElementById('pinSubmit').disabled=true;
 document.getElementById('pin').value='';
 pinEntry().classList.remove('is-verifying','is-error');
 pinUpdate();
 card.hidden=false;
 var seconds=Math.ceil(remain/1000);
 time.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
 document.getElementById('pinLockProgress').style.width=(100*Math.min(1,remain/(15*60*1000)))+'%';
}
function pinLockStart(retryAfterMs){
 var duration=Math.max(0,Number(retryAfterMs)||0);
 if(!duration)return;
 pinLockUntil=Date.now()+duration;
 try{localStorage.setItem(pinLockKey(),String(pinLockUntil))}catch(_){}
 if(pinTimer){clearTimeout(pinTimer);pinTimer=null}
 if(pinLockTimer)clearInterval(pinLockTimer);
 pinLockRender();
 pinLockTimer=setInterval(pinLockRender,250);
}
function pinLockRestore(){
 var expiry=0;
 try{expiry=Number(localStorage.getItem(pinLockKey())||0)}catch(_){}
 if(expiry>Date.now())pinLockStart(expiry-Date.now());
 else pinLockRender();
}
function pinEntry(){return document.querySelector('#pinScreen .pinEntry')}
function pinUpdate(){
 var input=document.getElementById('pin'),digits=String(input.value||'').replace(/[^0-9]/g,'').slice(0,6);
 if(input.value!==digits)input.value=digits;
 document.querySelectorAll('#pinScreen .pinCell').forEach(function(cell,i){
  cell.classList.toggle('filled',i<digits.length);
  cell.classList.toggle('current',i===digits.length&&pinPhase==='idle');
 });
}
function pinReset(){
 if(pinTimer){clearTimeout(pinTimer);pinTimer=null}
 pinPhase='idle';
 pinEntry().classList.remove('is-verifying','is-error','is-success');
 document.getElementById('pin').disabled=false;
 document.getElementById('pinSubmit').disabled=false;
 pinUpdate();
}
function pinOffsets(){
 var cells=Array.from(document.querySelectorAll('#pinScreen .pinCell'));
 var rect=document.querySelector('#pinScreen .pinCells').getBoundingClientRect();
 var center=rect.left+rect.width/2;
 cells.forEach(function(cell){
  var r=cell.getBoundingClientRect();
  cell.style.setProperty('--pin-merge-x',(center-r.left-r.width/2)+'px');
 });
}
var pinAutoSubmit=null;
document.getElementById('pin').addEventListener('input',function(){
 if(pinPhase!=='idle')return;
 document.getElementById('pinError').textContent='';
 pinUpdate();
 if(pinAutoSubmit)clearTimeout(pinAutoSubmit);
 if(this.value.length===6){
  pinAutoSubmit=setTimeout(function(){
   if(pinPhase==='idle'&&!document.getElementById('pinScreen').hidden){
    var form=document.getElementById('pinForm');
    if(form.requestSubmit)form.requestSubmit();
    else form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
   }
  },90);
 }
});
document.getElementById('pin').addEventListener('focus',pinUpdate);
document.getElementById('pin').addEventListener('blur',pinUpdate);
document.querySelector('#pinScreen .pinCells').addEventListener('click',function(){if(pinPhase==='idle')document.getElementById('pin').focus()});
document.getElementById('pinForm').onsubmit=async function(event){
 event.preventDefault();
 if(pinPhase!=='idle'||pinLockUntil>Date.now())return;
 var field=document.getElementById('pin'),pin=field.value;
 if(!/^[0-9]{6}$/.test(pin)){document.getElementById('pinError').textContent='Введите 6 цифр';return}
 pinPhase='verifying';pinEntry().classList.add('is-verifying');pinUpdate();
 document.getElementById('pinSubmit').disabled=true;field.disabled=true;
 try{
  var user=await rpc('crInventoryPinLogin',{pin:pin});
  if(!user||!user.token)throw Error('Сервер не вернул PIN-сессию');
  inventorySession=user.token;inventoryName=user.name||'';
  canManageBarcodes=user.role==='owner'&&user.canManageBarcodes===true;
  pinPhase='success';pinOffsets();
  pinEntry().classList.remove('is-verifying');pinEntry().classList.add('is-success');
  pinTimer=setTimeout(function(){pinReset();field.value='';pinUpdate();launch()},380);
 }catch(e){
  if(e&&Number(e.retryAfterMs)>0){
   pinReset();field.value='';pinUpdate();
   document.getElementById('pinError').textContent='';
   pinLockStart(e.retryAfterMs);
   return;
  }
  pinPhase='error';pinEntry().classList.remove('is-verifying');pinEntry().classList.add('is-error');
  pinTimer=setTimeout(function(){
   pinReset();field.value='';pinUpdate();
   document.getElementById('pinError').textContent=String(e&&e.message||e);
   field.focus();
  },600);
 }
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
 document.body.classList.remove('inventoryLogin');
 document.getElementById('inventory').hidden=false;
 document.getElementById('staffName').textContent=inventoryName||'Сотрудник';
 document.getElementById('staffAvatar').textContent=(inventoryName||'С').trim().charAt(0).toLocaleUpperCase('ru-RU');
 document.getElementById('staffBar').hidden=false;
 document.getElementById('barcodeCard').hidden=!canManageBarcodes;
 document.getElementById('barcodePage').hidden=true;
 document.getElementById('status').hidden=false;
 if(ui)ui.clear();
 ui=window.crStaffTobaccoFactory(api);
 ui.mount(document.getElementById('inventory'));
 showStatus();flush();
}
function exitBarcodePage(){
 if(ui)ui.closeBarcode();
 document.getElementById('barcodePage').hidden=true;
 document.getElementById('staffBar').hidden=false;
 document.getElementById('barcodeCard').hidden=!canManageBarcodes;
 document.getElementById('inventory').hidden=false;
 document.getElementById('status').hidden=false;
}
document.getElementById('barcodeBack').onclick=exitBarcodePage;
document.getElementById('barcodeTrigger').onclick=function(){
 if(!ui||!inventorySession||!canManageBarcodes)return;
 document.getElementById('staffBar').hidden=true;
 document.getElementById('barcodeCard').hidden=true;
 document.getElementById('inventory').hidden=true;
 document.getElementById('status').hidden=true;
 document.getElementById('barcodePage').hidden=false;
 ui.openBarcode();
};
document.getElementById('retry').onclick=function(){
 if(state.conflict){setStatus('Конфликт: данные сохранены локально');return}
 if(ui && state.snapshot && state.snapshot.active && !window.confirm('Обновить данные? Несохранённые значения в полях будут потеряны.'))return;
 if(state.queue.length){flush();return}
 if(ui)ui.refresh();else if(inventorySession)flush();
};
window.addEventListener('online',function(){showStatus();flush()});
window.addEventListener('offline',showStatus);
document.addEventListener('visibilitychange',function(){if(!document.hidden)flush()});

function updateBlocked(){
 if(!storageReady||pendingWrites||pendingCalls||pendingRpc||syncing)return 'Дождитесь завершения сохранения и синхронизации.';
 if(state.queue.length)return 'Сначала отправьте '+state.queue.length+' несинхронизированных операций.';
 if(pinPhase==='verifying'||pinPhase==='success')return 'Дождитесь завершения входа.';
 if(ui&&(!ui.canUpdate||!ui.canUpdate()))return 'Сохраните изменения и вернитесь к списку инвентаризаций. Закройте сканер и открытые окна.';
 if(!document.getElementById('barcodePage').hidden)return 'Закройте сканер штрихкода.';
 return '';
}
function updateNotice(message){var el=document.getElementById('updateMessage');el.textContent=message||'';el.hidden=!message;}
function versionNewer(v,current){if(!/^\d+\.\d+\.\d+$/.test(v||''))return false;var x=v.split('.').map(Number),y=current.split('.').map(Number);for(var i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
var updateVersion='',updateProbe=0,updateManual=false;
function updateHide(){document.getElementById('updatePanel').hidden=true;}
function updateInfo(message){
 document.getElementById('updateVersion').textContent='Обновление приложения';
 document.getElementById('updateDetail').textContent='';
 document.getElementById('updateApply').hidden=true;
 updateNotice(message);document.getElementById('updatePanel').hidden=false;
}
function updateShow(worker,manual){
 if(!worker||!navigator.serviceWorker.controller||(!manual&&worker===updateDeferred))return;
 var probe=++updateProbe;
 try{
  var channel=new MessageChannel(),timer=setTimeout(function(){channel.port1.close();if(probe===updateProbe&&manual)updateInfo('Не удалось проверить версию.');},4000);
  channel.port1.onmessage=function(e){
   clearTimeout(timer);channel.port1.close();
   if(probe!==updateProbe||!updateRegistration||worker!==updateRegistration.waiting)return;
   var v=e.data&&e.data.version;
   if(!versionNewer(v,APP_VERSION)){updateCandidate=null;updateVersion='';if(manual)updateInfo('Установлена актуальная версия '+APP_VERSION+'.');else updateHide();return;}
   updateCandidate=worker;updateVersion=v;
   document.getElementById('updateVersion').textContent='Доступно обновление';
   document.getElementById('updateDetail').textContent='Версия '+v;
   document.getElementById('updateApply').hidden=false;
   updateNotice('');document.getElementById('updatePanel').hidden=false;
  };
  worker.postMessage({type:'GET_VERSION'},[channel.port2]);
 }catch(e){if(manual)updateInfo('Не удалось проверить версию.');}
}
async function checkUpdate(manual){
 if(manual){updateDeferred=null;updateManual=true;updateInfo('Проверяем обновления…');}
 if(!updateRegistration){if(manual)updateInfo('Механизм обновлений ещё не готов.');return;}
 if(!navigator.onLine){if(manual)updateInfo('Для проверки обновлений нужен интернет.');return;}
 if(!manual&&Date.now()-updateCheckedAt<60000)return;
 updateCheckedAt=Date.now();
 try{
  await updateRegistration.update();
  if(updateRegistration.waiting)updateShow(updateRegistration.waiting,manual);
  else if(manual)updateInfo(updateRegistration.installing?'Новая версия загружается…':'Установлена актуальная версия '+APP_VERSION+'.');
 }catch(e){if(manual)updateInfo('Не удалось проверить обновления. Повторите позже.');}
}
document.getElementById('updateLater').onclick=function(){updateProbe++;updateDeferred=updateCandidate||(updateRegistration&&updateRegistration.waiting);updateManual=false;updateHide();};
document.getElementById('updateCheck').onclick=function(){checkUpdate(true);};
document.getElementById('updateApply').onclick=async function(){
 if(updateApplying)return;
 var worker=updateRegistration&&updateRegistration.waiting;
 if(!worker||worker!==updateCandidate||!versionNewer(updateVersion,APP_VERSION)){updateNotice('Нет готового обновления.');return;}
 var reason=updateBlocked();if(reason){updateNotice(reason);return;}
 updateApplying=true;
 var main=document.querySelector('main');main.setAttribute('inert','');main.style.pointerEvents='none';
 if(document.activeElement)document.activeElement.blur();
 try{
  await persist();
  if(worker!==updateRegistration.waiting)throw Error('Версия обновления изменилась. Повторите проверку.');
  updateNotice('Устанавливаем обновление…');
  worker.postMessage({type:'ACTIVATE_UPDATE'});
  setTimeout(function(){if(updateApplying){updateApplying=false;main.removeAttribute('inert');main.style.pointerEvents='';updateNotice('Обновление не подтверждено. Повторите проверку.');}},15000);
 }catch(e){updateApplying=false;main.removeAttribute('inert');main.style.pointerEvents='';updateNotice('Не удалось обновить приложение: '+e.message);}
};
if('serviceWorker' in navigator){
 navigator.serviceWorker.addEventListener('controllerchange',function(){if(updateApplying)location.reload();});
 navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(function(reg){
  updateRegistration=reg;
  function watch(worker){if(!worker)return;worker.addEventListener('statechange',function(){if(worker.state==='installed'&&reg.waiting){updateShow(reg.waiting,updateManual);updateManual=false;}});}
  reg.addEventListener('updatefound',function(){watch(reg.installing);});
  watch(reg.installing);if(reg.waiting)updateShow(reg.waiting,false);
  checkUpdate(false);
 }).catch(function(){});
 window.addEventListener('online',function(){checkUpdate(false);});
 document.addEventListener('visibilitychange',function(){if(!document.hidden)checkUpdate(false);});
 setInterval(function(){if(!document.hidden)checkUpdate(false);},15*60*1000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
