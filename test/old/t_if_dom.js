const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
// 复用当前页面（dbg3 已加载嵌套块）
const v=await ev(`(function(){
  var layers=[].slice.call(document.querySelectorAll('.if-slot-labels'));
  return layers.map(function(L){
    var p=L.parentNode;
    var pBlock=p.getAttribute('data-block-id')||(p.className&&p.className.baseVal!==undefined?p.className.baseVal:p.className);
    // 找该 layer 所属块：向上找 .blocklyBlockCanvas 下的 block g
    var g=L; while(g&&!(g.getAttribute&&g.getAttribute('data-block-id')))g=g.parentNode;
    return {parentClass:String(pBlock).slice(0,60), ownerBlock:g?g.getAttribute('data-block-id'):'?',
      texts:[].slice.call(L.querySelectorAll('text')).map(t=>t.textContent+'@'+t.getAttribute('y'))};
  });
})()`);
console.log(JSON.stringify(v,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
