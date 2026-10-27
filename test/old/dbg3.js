const WebSocket=require('ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)return 'EXC:'+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||JSON.stringify(r.exceptionDetails)).slice(0,300);return r.result.value;};
console.log(await ev(`(function(){const ws=window.blocklyWs;if(!ws)return 'no ws';const tops=ws.getTopBlocks(false);return 'top types: '+tops.map(b=>b.type).join(',');})()`));
console.log(await ev(`(function(){const ws=window.blocklyWs;const lb=ws.getTopBlocks(false).find(b=>b.type==='lists_create_with');if(!lb)return 'no lb';return 'mutator='+(!!lb.mutator)+' bubble='+(lb.mutator&&!!lb.mutator.miniWorkspaceBubble);})()`));
console.log(await ev(`(function(){const ws=window.blocklyWs;const lb=ws.getTopBlocks(false).find(b=>b.type==='lists_create_with');const mws=lb.mutator.miniWorkspaceBubble.getWorkspace();return mws.getAllBlocks(false).map(b=>b.type).join(',');})()`));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
