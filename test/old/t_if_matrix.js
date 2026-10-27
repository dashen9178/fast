const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1000);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(600);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(700);
await ev(`(function(){
  var B=Blockly;
  var xml=B.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">'
    +'<block type="controls_if" x="60" y="30"></block>'
    +'<block type="controls_if" x="300" y="30"><mutation elseif="2" else="1"></mutation>'
      +'<statement name="DO1"><block type="controls_if"><mutation elseif="1" else="1"></mutation></block></statement>'
    +'</block>'
    +'<block type="controls_repeat_ext" x="620" y="30"><value name="TIMES"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block>'
    +'</xml>');
  B.Xml.domToWorkspace(xml,blocklyWs);
  return 1;
})()`);
await sleep(600);
// 统计标签数：第二个块（2 elseif+else）应有3个标签；DO1槽内有嵌套块，该槽标签应隐藏 → 2个；嵌套块2个；纯如果0；重复0
const count=await ev(`(function(){
  var bs=blocklyWs.getTopBlocks(true);
  return bs.map(function(b){return {t:b.type,labels:(b.getSvgRoot().querySelectorAll('.if-slot-label').length)};});
})()`);
console.log(JSON.stringify(count));
await sleep(200);
const detail=await ev(`(function(){
  return blocklyWs.getAllBlocks(false).filter(b=>b.type==='controls_if').map(function(b){
    var layer=b.getSvgRoot().querySelector('.if-slot-labels');
    return {parent:b.getParent()?b.getParent().type:'TOP',h:b.getHeightWidth().height,
      labels:layer?[].slice.call(layer.querySelectorAll('text')).map(t=>t.textContent+'@'+t.getAttribute('y')):[]};
  });
})()`);
console.log(JSON.stringify(detail,null,1));
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/t_if_matrix.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
