const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,500));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
await ev(`(function(){
  var B=Blockly;
  var xml=B.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">'
    +'<block type="controls_if" x="60" y="40"><mutation else="1"></mutation>'
      +'<value name="IF0"><block type="logic_compare"><field name="OP">EQ</field></block></value>'
    +'</block></xml>');
  B.Xml.domToWorkspace(xml,blocklyWs);
  return 1;})()`);
await sleep(600);
const probe=await ev(`(function(){
  var b=blocklyWs.getTopBlocks(true)[0];
  var ren=b.workspace.getRenderer();
  var info=ren.makeRenderInfo_(b);
  info.measure(); info.alignRowElements_(); if(info.finalize_)info.finalize_();
  var C=ren.getConstants();
  function ename(e){return e.constructor.name.replace(/.*\\$/,'');}
  var rows=info.rows.map(function(r){
    return {k:r.constructor.name.replace(/.*\\$/,''),y:r.yPos,h:r.height,w:r.width,x:r.xPos,
      stmt:!!r.hasStatement,edge:r.statementEdge,
      els:r.elements.map(function(e){return {t:ename(e),x:e.xPos,w:e.width,h:e.height,
        no:e.notchOffset!==undefined?e.notchOffset:null, sw:e.shape?e.shape.width:null};})};
  });
  return {W:info.width,
    IC:{w:C.INSIDE_CORNERS.width,h:C.INSIDE_CORNERS.height,top:C.INSIDE_CORNERS.pathTop,bot:C.INSIDE_CORNERS.pathBottom},
    NOTCH_OFFSET:C.NOTCH_OFFSET, SINO:C.STATEMENT_INPUT_NOTCH_OFFSET, DARK:C.DARK_PATH_OFFSET,
    SBRW:C.STATEMENT_BOTTOM_RIGHT_WIDTH, SIPT:C.STATEMENT_INPUT_PADDING_TOP,
    rows:rows};
})()`);
console.log(JSON.stringify(probe,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
