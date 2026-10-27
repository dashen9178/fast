const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,500));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
await ev(`(function(){
  var B=Blockly;
  var toast='<block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">提示内容比较长的文字哈哈</field></block></value></block>';
  var xml=B.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">'
    +'<block type="controls_if" x="60" y="40"><mutation else="1"></mutation><statement name="ELSE">'+toast+'</statement></block>'
    +'</xml>');
  B.Xml.domToWorkspace(xml,blocklyWs);
  return 1;})()`);
await sleep(600);
const out=await ev(`(function(){
  var b=blocklyWs.getTopBlocks(true)[0];
  var ren=blocklyWs.getRenderer();
  var info=ren.makeRenderInfo_(b);
  info.measure();
  // measure 后、align 前抓自然宽
  var rows=info.rows;
  var nat=rows.map(function(r){
    var node=0; if(r.hasStatement&&r.elements)for(var k=r.elements.length-1;k>=0;k--){if(r.elements[k].connectionModel){node=r.elements[k].width;break;}}
    return {k:r.constructor.name.replace(/.*\\$/,''),stmt:!!r.hasStatement,edge:r.statementEdge,
      w:r.width,wwc:r.widthWithConnectedBlocks,node:node};
  });
  info.alignRowElements_(); if(info.finalize_)info.finalize_();
  var after=info.rows.map(function(r){return {w:r.width,edge:r.statementEdge};});
  return {R:info.__ifUnitEdges,unitOf:info.__ifUnitOf,W:info.width,nat:nat,after:after};
})()`);
console.log(JSON.stringify(out,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
