const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 图二：如果 + 否则，IF0 接 logic_compare（=）；图一：如果 + 否则如果 + 否则，IF1 接 logic_compare
await ev(`(function(){
  var B=Blockly;
  var xml=B.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">'
    +'<block type="controls_if" x="60" y="40"><mutation else="1"></mutation>'
      +'<value name="IF0"><block type="logic_compare"><field name="OP">EQ</field></block></value>'
    +'</block>'
    +'<block type="controls_if" x="60" y="430"><mutation elseif="1" else="1"></mutation>'
      +'<value name="IF1"><block type="logic_compare"><field name="OP">EQ</field></block></value>'
    +'</block>'
    +'</xml>');
  B.Xml.domToWorkspace(xml,blocklyWs);
  return 1;})()`);
await sleep(700);
const dump=await ev(`(function(){
  function rowDump(b){
    var d=b.renderer_|0; // noop
    var info=b.getRenderer?null:null;
    // 通过 drawer 拿不到 info，用 block 的尺寸 + path 即可
    var p=b.getSvgRoot().querySelector('.blocklyPath');
    var hw=b.getHeightWidth();
    return {type:b.type,hw:hw,d:p.getAttribute('d')};
  }
  return blocklyWs.getTopBlocks(true).map(rowDump);
})()`);
console.log(JSON.stringify(dump,null,1));
// 分别截两块
const boxes=await ev(`(function(){
  var bs=blocklyWs.getTopBlocks(true);
  return bs.map(b=>{var r=b.getSvgRoot().getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
})()`);
console.log('BOXES',JSON.stringify(boxes));
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/repro_full.png',Buffer.from(s.data,'base64'));
for(let i=0;i<boxes.length;i++){
  const bx=boxes[i];
  s=await send('Page.captureScreenshot',{format:'png',clip:{x:Math.max(0,bx.x-10),y:Math.max(0,bx.y-10),width:bx.w+20,height:bx.h+20,scale:2}});
  fs.writeFileSync('/tmp/repro_block'+i+'.png',Buffer.from(s.data,'base64'));
}
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
