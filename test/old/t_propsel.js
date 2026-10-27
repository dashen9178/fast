const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])P[o.id].r(o.result);});
const send=(m,p={})=>new Promise(r=>{const i=++id;P[i]={r};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,200));return r.result.value;};
await ev(`document.getElementById('tabDesign').click();1`);await sleep(400);
await ev(`document.querySelector('[data-add="button"]').click();1`);await sleep(500);
const sels=await ev(`(function(){return [].slice.call(document.querySelectorAll('.pp-sel-btn')).filter(b=>b.offsetParent!==null).map(b=>b.textContent.trim().slice(0,8));})()`);
console.log('visible selects:',JSON.stringify(sels));
const results={};
if(sels&&sels.length){
  const k=sels[0];
  await ev(`document.querySelector('.pp-sel-btn').click();1`);await sleep(250);
  results.open1=await ev(`!!document._ppSel`);
  await ev(`document.querySelector('.pp-sel-btn').click();1`);await sleep(250);
  results.toggleClose=await ev(`!document._ppSel`);
  await ev(`document.querySelector('.pp-sel-btn').click();1`);await sleep(250);
  results.reopen=await ev(`!!document._ppSel`);
  // 若有第二个下拉，测 A 开时点 B 切换
  if(sels[1]){
    await ev(`document.querySelector('.pp-sel-btn').click();1`);await sleep(250);
    results.switchToB=await ev(`!!document._ppSel`);
    const same=await ev(`(function(){var m=document.querySelector('.pp-sel-menu');var b=document.querySelector('.pp-sel-btn');var mr=m.getBoundingClientRect();var br=b.getBoundingClientRect();return Math.abs(mr.top-br.bottom)<30;})()`);
    results.menuNearB=same;
  }
}
console.log(JSON.stringify(results,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
