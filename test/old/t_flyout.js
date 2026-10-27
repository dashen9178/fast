const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:2,mobile:true});
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
await ev(`localStorage.clear()`);
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(150);
await ev(`document.getElementById('createGo').click();1`);await sleep(600);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(700);
// 点“事件”分类
await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>x.title==='事件');b.click();return 1;})()`);
await sleep(700);
const info=await ev(`(function(){
  var fl=blocklyWs.getFlyout();
  var flWs=fl.getWorkspace();
  var blocks=flWs.getTopBlocks(true);
  var maxW=0,maxB=null;
  blocks.forEach(function(b){var w=b.getHeightWidth().width;if(w>maxW){maxW=w;maxB=b;}});
  var svg=document.querySelector('.blocklyFlyout');
  var flRect=svg.getBoundingClientRect();
  var br=maxB?maxB.getSvgRoot().getBoundingClientRect():null;
  var scale=flWs.scale;
  var clip=document.querySelector('.blocklyFlyout defs clipPath rect');
  return JSON.stringify({flyoutW:fl.width_,flyoutScale:scale,maxBlockW:maxW,maxBlockType:maxB&&maxB.type,
    flRectW:flRect.width,flRectRight:flRect.right,flRectLeft:flRect.left,
    blockRight:br&&Math.round(br.right),blockLeft:br&&Math.round(br.left),overhang:br?Math.round(br.right-flRect.right):0,
    clipW:clip?clip.getAttribute('width'):null});
})()`);
console.log(info);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/t_flyout_event.png',Buffer.from(s.data,'base64'));
// 切到“控制”分类看如果块
await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>x.title==='控制');b.click();return 1;})()`);
await sleep(600);
s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/t_flyout_ctrl.png',Buffer.from(s.data,'base64'));
// 拖一个如果块到画布并加2个否则如果
await ev(`(function(){
  var fl=blocklyWs.getFlyout().getWorkspace();
  var b=fl.getTopBlocks(true).find(x=>x.type==='controls_if');
  var r=b.getSvgRoot().getBoundingClientRect();
  return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});
})()`);
console.log('done');process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
