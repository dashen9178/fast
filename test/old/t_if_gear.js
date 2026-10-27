const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
const results={};
// 当前编辑器已有工程（试运行重开的测试工程）。进积木页
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(700);
await ev(`blocklyWs.clear();1`);await sleep(200);
// 从工具箱拖一个纯“如果”块
await ev(`(function(){var b=Blockly.Xml.domToBlock(Blockly.utils.xml.textToDom('<block type="controls_if"></block>'),blocklyWs);b.moveBy(260,100);return 1;})()`);
await sleep(300);
function state(){return ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');
  if(!b)return JSON.stringify({missing:true});
  return JSON.stringify({ei:b.elseifCount_,el:b.elseCount_,h:b.getHeightWidth().height,
    labels:[].slice.call(b.getSvgRoot().querySelectorAll('.if-slot-labels text')).map(t=>t.textContent),
    rects:[].slice.call(b.getSvgRoot().querySelectorAll('rect.if-extra-bar')).length});})()`);}
results.initial = JSON.parse(await state());
// 打开齿轮框：点 mutator icon
await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var ic=b.getSvgRoot().querySelector('.blockly-icon-mutator');ic.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1;})()`);
await sleep(500);
results.ifMutOpensEmpty = await ev(`(function(){var d=document.getElementById('ifMutMask');return d&&!d.classList.contains('hidden');})()`);
// 什么都不加，直接确定
await ev(`document.getElementById('ifMutOk').click();1`);await sleep(400);
results.afterOkNoChange = JSON.parse(await state());
// 打开加 3 个否则如果
await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var ic=b.getSvgRoot().querySelector('.blockly-icon-mutator');ic.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1;})()`);await sleep(400);
for(let i=0;i<3;i++){await ev(`document.getElementById('ifMutAdd').click();1`);await sleep(120);}
await ev(`document.getElementById('ifMutOk').click();1`);await sleep(400);
results.afterAdd3 = JSON.parse(await state());
// 减 2 个
await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var ic=b.getSvgRoot().querySelector('.blockly-icon-mutator');ic.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1;})()`);await sleep(400);
for(let i=0;i<2;i++){await ev(`document.getElementById('ifMutMinus').click();1`);await sleep(120);}
await ev(`document.getElementById('ifMutOk').click();1`);await sleep(400);
results.afterMinus2 = JSON.parse(await state());
// 减到 0
await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var ic=b.getSvgRoot().querySelector('.blockly-icon-mutator');ic.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return 1;})()`);await sleep(400);
await ev(`document.getElementById('ifMutMinus').click();1`);await sleep(120);
await ev(`document.getElementById('ifMutOk').click();1`);await sleep(400);
results.afterMinusToZero = JSON.parse(await state());
// 撤销/重做往返
await ev(`blocklyWs.undo(false);1`);await sleep(200);
results.undo1 = JSON.parse(await state());
await ev(`blocklyWs.undo(false);1`);await sleep(200);
results.undo2 = JSON.parse(await state());
await ev(`blocklyWs.undo(true);1`);await sleep(200);
results.redo1 = JSON.parse(await state());
console.log(JSON.stringify(results,null,1));
let s=await send('Page.captureScreenshot',{format:'png',clip:{x:250,y:80,width:420,height:560,scale:1.6}});
fs.writeFileSync('/tmp/t_if_gear.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
