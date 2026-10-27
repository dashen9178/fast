const WebSocket=require('ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
let id=0;
(async()=>{
 const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'));
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
 await new Promise(r=>ws.on('open',r));
 ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
 const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});return r.result?r.result.value:undefined;};
 const out=await ev(`(function(){
   var items=document.querySelectorAll('#layStage .litem');
   return Array.prototype.map.call(items,function(it){var cs=getComputedStyle(it);return JSON.stringify({cls:it.className.replace(/litem|t-text|sel|is-hidden/g,'').trim(),w:it.style.width,h:it.style.height,txt:(it.textContent||'').slice(0,20),cw:it.getBoundingClientRect().width});}).join('\\n');
 })()`);
 console.log(out);
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
