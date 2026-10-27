const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
await ev(`(function(){var B=Blockly;
 var a=B.Xml.domToBlock(B.utils.xml.textToDom('<xml><block type="ev_start"></block></xml>').firstChild,blocklyWs);a.initSvg();a.render();a.moveBy(120,80);
 var b=B.Xml.domToBlock(B.utils.xml.textToDom('<xml><block type="ev_first_start"></block></xml>').firstChild,blocklyWs);b.initSvg();b.render();b.moveBy(120,220);
 return 1;})()`);
await sleep(500);
const out=await ev(`(function(){
 function info(type){var b=blocklyWs.getBlocksByType(type)[0];
  var ren=blocklyWs.getRenderer();var ri=ren.makeRenderInfo_(b);ri.measure();ri.alignRowElements_();if(ri.finalize_)ri.finalize_();
  return {hw:b.getHeightWidth(),
   rows:ri.rows.map(function(r){return {k:r.constructor.name.replace(/.*\\$/,''),h:r.height,w:r.width,
     els:(r.elements||[]).map(function(e){return e.constructor.name.replace(/.*\\$/,'')+':'+Math.round(e.width)+(e.getText?('('+e.getText()+')'):'');})};}),
   infoH:ri.height,path:b.getSvgRoot().querySelector('.blocklyPath').getAttribute('d')};}
 return {a:info('ev_start'),b:info('ev_first_start')};})()`);
console.log(JSON.stringify(out,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
