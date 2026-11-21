'use strict';
const $=id=>document.getElementById(id);
const token=new URLSearchParams(location.search).get('token')||'';
let scanner=null,running=false,locked=false;
const status=t=>{$('status').textContent=t};
function normalizeCode(raw){
 const s=String(raw??'').replace(/^\]d[12]/,'').replace(/^\]Q3/,'').trim();
 const values=[],add=v=>{if(/^\d{14}$/.test(v)&&!values.includes(v))values.push(v)};
 if(/^\d{14}[\s\S]{15}$/.test(s))add(s.slice(0,14));
 for(const m of s.matchAll(/(?:\(01\)|(?:^|\x1d)01)\s*(\d{14})/g))add(m[1]);
 if(/^01\d{14}/.test(s))add(s.slice(2,16));
 if(/^\d{13}$/.test(s))add('0'+s);
 if(/^\d{14}$/.test(s))add(s);
 return values.find(v=>{let sum=0;for(let i=12;i>=0;i--)sum+=Number(v[i])*((12-i)%2===0?3:1);return (10-sum%10)%10===Number(v[13])})||'';
}
async function decoder(){
 if(window.Html5Qrcode)return;
 for(const url of ['https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js','https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js']){
  try{await new Promise((ok,fail)=>{const s=document.createElement('script');s.src=url;s.onload=ok;s.onerror=fail;document.head.appendChild(s)});if(window.Html5Qrcode)return}catch(e){}
 }
 throw Error('Библиотека сканера недоступна');
}
async function stop(){
 const old=scanner;scanner=null;running=false;
 if(old){try{await old.stop()}catch(e){}try{old.clear()}catch(e){}}
}
function found(raw){
 const code=normalizeCode(raw);
 if(!code){if(String(raw).length>=13)status('Код считан, GTIN не найден. Повторите сканирование.');return}
 if(locked)return;locked=true;
 if(!token||!window.opener){$('manual').value=code;status('GTIN '+code+'. Передача недоступна, скопируйте код.');stop();return}
 try{window.opener.postMessage({type:'cr:inventory-gtin',token,gtin:code},'*');status('GTIN передан: '+code);stop();setTimeout(()=>window.close(),400)}
 catch(e){$('manual').value=code;status('Не удалось передать код: '+e.message)}
}
async function start(){
 if(scanner)return;locked=false;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Нужен HTTPS и доступ к камере');
  status('Запускаем заднюю камеру…');await decoder();
  const formats=[Html5QrcodeSupportedFormats.DATA_MATRIX,Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.EAN_8,Html5QrcodeSupportedFormats.UPC_A];
  scanner=new Html5Qrcode('reader',{formatsToSupport:formats,verbose:false,experimentalFeatures:{useBarCodeDetectorIfSupported:false}});
  const w=Math.min(Math.max(window.innerWidth-50,220),440),side=Math.min(280,Math.max(170,w-45));
  await scanner.start({facingMode:'environment'},{fps:15,qrbox:{width:side,height:side},aspectRatio:1,videoConstraints:{facingMode:'environment',width:{ideal:1920},height:{ideal:1080}}},found,()=>{});
  running=true;const v=document.querySelector('#reader video');if(v){v.setAttribute('playsinline','');v.controls=false;v.muted=true}
  status('Наведите на Data Matrix или обычный штрихкод');
 }catch(e){status('Камера: '+e.message);await stop()}
}
$('start').onclick=start;$('stop').onclick=stop;
$('send').onclick=()=>found($('manual').value);
window.addEventListener('pagehide',stop);
