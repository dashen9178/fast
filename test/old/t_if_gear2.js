const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,200));return r.result.value;};
const results={};
// 全新工程
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1100);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(180);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(80);
await ev(`document.getElementById('createGo').click();1`);await sleep(600);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
await ev(`(function(){var b=Blockly.Xml.domToBlock(Blockly.utils.xml.textToDom('<block type="controls_if"></block>'),blocklyWs);b.moveBy(260,100);return 1;})()`);
await sleep(300);
async function clickAt(x,y){await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(30);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});}
async function gearPos(){return JSON.parse(await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var ic=b.getSvgRoot().querySelector('.blockly-icon-mutator');var r=ic.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`));}
function st(){return ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');
  if(!b)return JSON.stringify({missing:true});
  return JSON.stringify({ei:b.elseifCount_,el:b.elseCount_,h:b.getHeightWidth().height,
    labels:[].slice.call(b.getSvgRoot().querySelectorAll('.if-slot-labels text')).map(t=>t.textContent),
    bars:[].slice.call(b.getSvgRoot().querySelectorAll('rect.if-extra-bar')).length});})()`);}
results.initial=JSON.parse(await st());
// 打开齿轮框，不加不减直接确定
let gp=await gearPos();await clickAt(gp.x,gp.y);await sleep(400);
results.ifMutOpens=await ev(`!document.getElementById('ifMutMenu').classList.contains('hidden')`);
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:10,y:10,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:10,y:10,button:'left',clickCount:1});await sleep(300);
results.okNoChange=JSON.parse(await st());
// 加 3
gp=await gearPos();await clickAt(gp.x,gp.y);await sleep(400);
for(let i=0;i<3;i++){await ev(`document.getElementById('ifMutPlus').click();1`);await sleep(100);}
results.counterAfterAdd3=await ev(`document.getElementById('ifMutNum').textContent`);
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:10,y:10,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:10,y:10,button:'left',clickCount:1});await sleep(400);
results.afterAdd3=JSON.parse(await st());
// 减 2
gp=await gearPos();await clickAt(gp.x,gp.y);await sleep(400);
await ev(`document.getElementById('ifMutMinus').click();1`);await sleep(100);
await ev(`document.getElementById('ifMutMinus').click();1`);await sleep(100);
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:10,y:10,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:10,y:10,button:'left',clickCount:1});await sleep(400);
results.afterMinus2=JSON.parse(await st());
// 减到 0
gp=await gearPos();await clickAt(gp.x,gp.y);await sleep(400);
await ev(`document.getElementById('ifMutMinus').click();1`);await sleep(100);
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:10,y:10,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:10,y:10,button:'left',clickCount:1});await sleep(400);
results.afterMinusToZero=JSON.parse(await st());
// 撤销链
await ev(`blocklyWs.undo(false);1`);await sleep(200);
results.undoBackToOne=JSON.parse(await st());
await ev(`blocklyWs.undo(false);1`);await sleep(200);
results.undoBackToThree=JSON.parse(await st());
await ev(`blocklyWs.undo(true);1`);await sleep(200);
results.redoToOne=JSON.parse(await st());
console.log(JSON.stringify(results,null,1));
let s=await send('Page.captureScreenshot',{format:'png',clip:{x:240,y:80,width:440,height:520,scale:1.6}});
fs.writeFileSync('/tmp/t_if_gear.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
