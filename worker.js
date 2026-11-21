/**
 * Cocktail Room · Inventory PWA 1.3.0
 * Cloudflare Worker: HTTPS same-purpose proxy, no storage and no changes to STAFF/MANAGEMENT.
 * Worker variable GAS_URL: https://script.google.com/macros/s/DEPLOYMENT_ID/exec
 * Deploy at https://<worker>.<account>.workers.dev.
 */
const ALLOWED_ORIGIN='https://issataevun-sys.github.io';
const ALLOWED_METHODS=new Set(['crStaffTobaccoActive','crStaffTobaccoCreate','crStaffTobaccoSave','crStaffTobaccoBarcodeSave']);
const HEADERS={
 'Access-Control-Allow-Origin':ALLOWED_ORIGIN,
 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Access-Control-Allow-Headers':'Content-Type',
 'Access-Control-Max-Age':'7200',
 'Vary':'Origin',
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'Content-Type':'application/json; charset=utf-8'
};
function result(status,body){return new Response(JSON.stringify(body),{status,headers:HEADERS})}
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin');
  if(origin!==ALLOWED_ORIGIN)return result(403,{ok:false,error:'Доступ разрешён только приложению инвентаризации'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
  if(request.method!=='POST')return result(405,{ok:false,error:'Метод запрещён'});
  const url=String(env.GAS_URL||'');
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))
   return result(503,{ok:false,error:'Не настроен адрес Google Apps Script (GAS_URL)'});
  let raw;
  try{raw=await request.text()}catch(_){return result(400,{ok:false,error:'Ошибка чтения запроса'})}
  if(raw.length>250000)return result(413,{ok:false,error:'Запрос слишком большой'});
  let data;
  try{data=JSON.parse(raw)}catch(_){return result(400,{ok:false,error:'Некорректный запрос'})}
  if(!data||!ALLOWED_METHODS.has(data.method)||!data.payload||typeof data.payload.deviceSecret!=='string')
   return result(400,{ok:false,error:'Недопустимая операция'});
  try{
   const response=await fetch(url,{
    method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:raw,redirect:'follow',signal:AbortSignal.timeout(20000)
   });
   if(!response.ok)return result(502,{ok:false,error:'Google Apps Script: HTTP '+response.status});
   let answer;
   try{answer=await response.json()}catch(_){return result(502,{ok:false,error:'GAS вернул не JSON. Проверьте развёртывание и доступ.'})}
   if(!answer||typeof answer.ok!=='boolean')return result(502,{ok:false,error:'Неправильный ответ GAS'});
   return result(200,answer);
  }catch(error){
   return result(502,{ok:false,error:'Нет связи с Google Apps Script: '+String(error&&error.message||error)});
  }
 }
};
