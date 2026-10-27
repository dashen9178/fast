const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true});
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,500));return r.result.value;};
await send('Runtime.evaluate',{expression:'localStorage.clear()'});
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});setTimeout(r,1400);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(300);
await ev(`document.getElementById('createGo').click();1`);await sleep(500);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1600);
async function catBtn(label){return ev(`(function(){const b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>(x.querySelector('.bb-cat-lb')||{}).textContent===${JSON.stringify(label)});const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);}
async function tap(p){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
async function click(p){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});}
let p=await catBtn('数据列表');await tap(p);await sleep(700);
const lb=await ev(`(function(){const g=document.querySelector('.blocklyFlyout .blocklyBlockCanvas');const b=[].slice.call(g.children).filter(x=>(x.getAttribute('class')||'').indexOf('blocklyDraggable')>=0)[0];const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+20)};})()`);
await click(lb);await sleep(700);
const gear=await ev(`(function(){const gs=[].slice.call(document.querySelectorAll('#blocklyDiv .blocklyIconGroup.blockly-icon-mutator')).filter(g=>{const r=g.getBoundingClientRect();return r.width>0&&!g.closest('.blocklyFlyout');});const g=gs[gs.length-1];const r=g.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
await click(gear);await sleep(800);
// 真实组合：在 mutator 工作区新建“项目”块并接到“列表”栈后面
const before=await ev(`(function(){const ws=window.blocklyWs;const lb=ws.getTopBlocks(false).find(b=>b.type==='lists_create_with');return lb.inputList.filter(i=>/^ADD/.test(i.name)).length;})()`);
const struct=await ev(`(function(){try{const ws=window.blocklyWs;const lb=ws.getTopBlocks(false).find(b=>b.type==='lists_create_with');const mws=lb.mutator.miniWorkspaceBubble.getWorkspace();return mws.getAllBlocks(false).map(b=>b.type).join(',');}catch(e){return 'ERR '+e.message;}})()`);
console.log('mutator 结构:',struct);
const compose=await ev(`(function(){try{const ws=window.blocklyWs;const lb=ws.getTopBlocks(false).find(b=>b.type==='lists_create_with');const mws=lb.mutator.miniWorkspaceBubble.getWorkspace();
// 容器的 STACK 语句输入下挂着项目块链；新建项目块接到链尾（触发真实 compose 事件链）
const cont=mws.getBlocksByType('lists_create_with_container')[0];
const conn=cont.getInput('STACK').connection;
let tail=conn.targetBlock();
while(tail&&tail.nextConnection&&tail.nextConnection.targetBlock())tail=tail.nextConnection.targetBlock();
const item=mws.newBlock('lists_create_with_item');item.initSvg();item.render();
if(tail)tail.nextConnection.connect(item.previousConnection);else conn.connect(item.previousConnection);
return 'connected, items now '+mws.getBlocksByType('lists_create_with_item').length;}catch(e){return 'ERR '+e.message+' '+e.stack;}})()`);
console.log('组合操作:',compose,' 组合前项目数:',before);
await sleep(600);  // 越过 autosave 250ms
const after=await ev(`(function(){const ws=window.blocklyWs;const lb=ws.getTopBlocks(false).find(b=>b.type==='lists_create_with');return lb.inputList.filter(i=>/^ADD/.test(i.name)).length;})()`);
const open=await ev(`(function(){const m=document.querySelector('.blocklyMutatorBackground');return m?Math.round(m.getBoundingClientRect().width):0;})()`);
console.log('组合后项目数:',after,' 小框宽度:',open);
console.log(after===before+1?'✓ 真实组合生效':'✗ 组合未生效');
console.log(open>0?'✓ 真实组合后小框仍打开':'✗ 小框被关闭');
// 再等一个自动保存周期确认不延迟关闭
await sleep(500);
const open2=await ev(`(function(){const m=document.querySelector('.blocklyMutatorBackground');return m?Math.round(m.getBoundingClientRect().width):0;})()`);
console.log(open2>0?'✓ 二次确认小框仍在':'✗ 小框延迟关闭');
process.exit(after===before+1&&open>0&&open2>0?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
