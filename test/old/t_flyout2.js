const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>x.title==='事件');if(b)b.click();return 1;})()`);await sleep(500);
await sleep(300);
const info=await ev(`(function(){
  var fl=blocklyWs.getFlyout();
  var flWs=fl.getWorkspace();
  var c=flWs.getRendererConstants?flWs.getRendererConstants():null;
  var blocks=flWs.getTopBlocks(true);
  var out=blocks.map(function(b){
    var r=b.getSvgRoot().getBoundingClientRect();
    var p=b.getRelativeToSurfaceXY();
    var hw=b.getHeightWidth();
    return {type:b.type, x:Math.round(p.x), y:Math.round(p.y), w:Math.round(hw.width), h:Math.round(hw.height),
      cssLeft:Math.round(r.left), cssRight:Math.round(r.right), cssW:Math.round(r.width)};
  });
  var svg=document.querySelector('.blocklyFlyout');
  var clips=[].map.call(document.querySelectorAll('.blocklyFlyout clipPath rect'),function(r){return r.getAttribute('width')+'@'+r.getAttribute('x');});
  var bg=document.querySelector('.blocklyFlyoutBackground');
  return JSON.stringify({flyoutW:fl.width_, GAP:fl.GAP_, MARGIN:c&&c.FLYOUT_MARGIN, scale:flWs.scale,
    svgW:svg.getAttribute('width'), bgW:bg&&bg.getAttribute('width'), bgX:bg&&bg.getAttribute('x'),
    clips:clips, blocks:out});
})()`);
console.log(info);
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
