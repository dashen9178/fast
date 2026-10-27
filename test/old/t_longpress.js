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
// 进积木页，构造：如果(含槽内打印块) + 下方一个数学赋值类块
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(700);
await ev(`blocklyWs.clear();1`);await sleep(200);
await ev(`(function(){
  var xml=Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml">'
   +'<block type="controls_if" x="300" y="120"><statement name="DO0"><block type="text_print"><value name="TEXT"><shadow type="text"><field name="TEXT">hi</field></shadow></value></block></statement></block>'
   +'<block type="text_print" x="300" y="300"></block>'
   +'</xml>');
  Blockly.Xml.domToWorkspace(xml,blocklyWs);
  return 1;
})()`);
await sleep(400);
async function longPressAt(x,y){
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await sleep(560);
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
  await sleep(250);
}
async function menuItems(){return await ev(`(function(){var m=document.body.querySelector('.popover:not(.hidden)');if(!m)return null;return [].slice.call(m.querySelectorAll('.menu-item')).map(i=>i.textContent.trim());})()`);}
async function close(){await send('Input.dispatchMouseEvent',{type:'mousePressed',x:5,y:5,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:5,y:5,button:'left',clickCount:1});await sleep(200);return await ev(`document.body.querySelector('.popover:not(.hidden)')?'stillOpen':'closed'`);}
// 长按外层“如果”头部
const p1=JSON.parse(await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var r=b.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+60),y:Math.round(r.top+18)});})()`));
await longPressAt(p1.x,p1.y);
const itemsIf=await menuItems();
await close();await sleep(200);
// 长按槽内打印块
const p2=JSON.parse(await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var inner=b.getInputTargetBlock('DO0');var r=inner.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+50),y:Math.round(r.top+12)});})()`));
await longPressAt(p2.x,p2.y);
const itemsInner=await menuItems();
await close();await sleep(200);
// 长按空白
await longPressAt(700,400);
const itemsEmpty=await menuItems();
await close();
console.log(JSON.stringify({itemsIf,itemsInner,itemsEmpty},null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
