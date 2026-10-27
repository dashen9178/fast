const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,200));return r.result.value;};
const R={};
await ev(`blocklyWs.clear();1`);await sleep(200);
await ev(`(function(){var b=Blockly.Xml.domToBlock(Blockly.utils.xml.textToDom('<block type="controls_if"></block>'),blocklyWs);b.moveBy(300,120);return 1;})()`);await sleep(300);
async function clickAt(x,y){await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(25);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});}
async function openGear(){var p=JSON.parse(await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var ic=b.getSvgRoot().querySelector('.blockly-icon-mutator');var r=ic.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`));await clickAt(p.x,p.y);await sleep(350);}
async function closeGear(){await clickAt(6,6);await sleep(300);}
function st(){return ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');return JSON.stringify({ei:b.elseifCount_,el:b.elseCount_});})()`);}
R.init=JSON.parse(await st());
await openGear();
R.minusDisabledAtZero=await ev(`document.getElementById('ifMutMinus').disabled`);
await ev(`document.getElementById('ifMutPlus').click();1`);await sleep(100);
await ev(`document.getElementById('ifMutPlus').click();1`);await sleep(100);
await ev(`document.getElementById('ifMutPlus').click();1`);await sleep(100);
R.numAfter3=await ev(`document.getElementById('ifMutNum').textContent`);
await closeGear();
R.afterAdd3=JSON.parse(await st());
await openGear();
await ev(`document.getElementById('ifMutMinus').click();1`);await sleep(100);
await closeGear();
R.afterMinus1=JSON.parse(await st());
await ev(`blocklyWs.undo(false);1`);await sleep(200);
R.undo=JSON.parse(await st());
await ev(`blocklyWs.undo(true);1`);await sleep(200);
R.redo=JSON.parse(await st());
// 打开不操作直接关闭，不应有变化
await openGear();R.minusStillDisabled=await ev(`document.getElementById('ifMutMinus').disabled`);await closeGear();
R.afterOpenOnly=JSON.parse(await st());
console.log(JSON.stringify(R,null,1));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
