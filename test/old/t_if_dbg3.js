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
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1000);});
await send('Page.enable');
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(600);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(700);
await ev(`window.__ifDbg=[];1`);
await ev(`(function(){
  var B=Blockly;
  var xml=B.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="300" y="30"><mutation elseif="2" else="1"></mutation><statement name="DO1"><block type="controls_if"><mutation elseif="1" else="1"></mutation></block></statement></block></xml>');
  B.Xml.domToWorkspace(xml,blocklyWs);
  return 1;
})()`);
await sleep(900);
const v=await ev(`(function(){return blocklyWs.getAllBlocks(false).filter(b=>b.type==='controls_if').map(function(b){return (b.getParent()?'NEST':'TOP')+' h='+b.getHeightWidth().height+': '+[].slice.call(b.getSvgRoot().querySelectorAll('.if-slot-labels text')).map(t=>t.textContent+'@'+t.getAttribute('y')).join(',');});})()`);
console.log('ACTUAL:');console.log(JSON.stringify(v,null,1));
console.log('DRAW CALLS:',JSON.stringify(await ev('window.__ifDbg'),null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
