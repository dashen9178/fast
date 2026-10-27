const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])P[o.id].r(o.result);});
const send=(m,p={})=>new Promise(r=>{const i=++id;P[i]={r};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});return r.result.value;};
// 当前编辑器页面，进积木页
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 缩放到 1.0 测一遍，再 1.4 测一遍（模拟放大）
const report=async()=>{
  const cats=await ev(`(function(){
    var tb=blocklyWs.getToolbox();var ks=tb.getToolboxItems().filter(i=>i.isSelectable&&i.isSelectable());
    return ks.map(k=>k.getName());
  })()`);
  const out=[];
  for(const name of cats){
    await ev(`(function(){var tb=blocklyWs.getToolbox();var k=tb.getToolboxItems().find(i=>i.isSelectable&&i.getName()===${JSON.stringify(name)});tb.setSelectedItem(k);return 1;})()`);
    await sleep(450);
    const o=await ev(`(function(){
      var fl=blocklyWs.getFlyout();if(!fl.isVisible())return null;
      var fr=fl.svgGroup_.getBoundingClientRect();
      var worstR=0,worstL=0,n=0;
      fl.getWorkspace().getTopBlocks(false).forEach(function(b){
        if(b.isInsertionMarker&&b.isInsertionMarker())return;n++;
        var r=b.getSvgRoot().getBoundingClientRect();if(!r.width)return;
        worstR=Math.max(worstR,Math.round(r.right-fr.right));
        worstL=Math.max(worstL,Math.round(fr.left-r.left));
      });
      return JSON.stringify({n:n,R:worstR,L:worstL});
    })()`);
    out.push(name+': '+o);
  }
  return out;
};
console.log('=== scale 1.0 ===');
await ev(`blocklyWs.setScale(1.0);1`);await sleep(300);
(await report()).forEach(x=>console.log(x));
console.log('=== scale 1.4 ===');
await ev(`blocklyWs.setScale(1.4);1`);await sleep(300);
(await report()).forEach(x=>console.log(x));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
