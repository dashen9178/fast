const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9222';
function get(path){return new Promise((res,rej)=>{require('http').get(HTTP+path,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let msgId=0;
async function conn(){
  const list=await get('/json/list');const t=list.find(x=>x.type==='page')||list[0];
  return new Promise((res,rej)=>{
    const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const pending={};
    ws.on('open',()=>res({send(method,params={}){return new Promise((r,j)=>{const id=++msgId;pending[id]={r,j};ws.send(JSON.stringify({id,method,params}));});},ws}));
    ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&pending[o.id]){if(o.error)pending[o.id].j(new Error(JSON.stringify(o.error)));else pending[o.id].r(o.result);}});
    ws.on('error',rej);
  });
}
(async()=>{
  const c=await conn();const send=c.send;
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text));return r.result.value;};
  await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});setTimeout(r,1400);});
  await ev(`document.getElementById('btnNewApp').click();1`);await sleep(300);
  await ev(`document.getElementById('createGo').click();1`);await sleep(500);
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1600);
  await ev(`window.__pd=[];document.getElementById('blocklyDiv').addEventListener('pointerdown',function(e){const SEL=['.blocklyToolboxDiv','.blocklyFlyout','.blocklyBubble','.blocklyBubbleCanvas','.blocklyWidgetDiv','.blocklyDropDownDiv','.blocklyZoom','.blocklyIconGroup'];const t=e.target;const rec={cls:(t.getAttribute&&t.getAttribute('class')||t.nodeName)+''};SEL.forEach(s=>{try{if(t.closest&&t.closest(s))rec.hit=s;}catch(e){rec.err=String(e);}});rec.inMutator=!!(t.closest&&t.closest('.blocklyMutatorBackground'));window.__pd.push(rec);},true);1`);
  async function catBtn(label){return ev(`(function(){const b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>(x.querySelector('.bb-cat-lb')||{}).textContent===${JSON.stringify(label)});if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);}
  async function tap(p){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  async function click(p){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});}
  const flyBlock=async n=>ev(`(function(){const g=document.querySelector('.blocklyFlyout .blocklyBlockCanvas');const bs=[].slice.call(g.children).filter(x=>(x.getAttribute('class')||'').indexOf('blocklyDraggable')>=0);const b=bs[${n||0}];if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(20,r.height/2))};})()`);

  let p=await catBtn('数据列表'); await tap(p);await sleep(700);
  const lb=await flyBlock(0); await click(lb); await sleep(700);
  const gear=await ev(`(function(){const gs=[].slice.call(document.querySelectorAll('#blocklyDiv .blocklyIconGroup.blockly-icon-mutator')).filter(g=>{const r=g.getBoundingClientRect();return r.width>0&&!g.closest('.blocklyFlyout');});const g=gs[gs.length-1];const r=g.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await click(gear); await sleep(800);
  console.log('mutator 打开:',await ev(`!!document.querySelector('.blocklyMutatorBackground')`));
  // mutator 左侧浮层里的“项目”积木（可拖入）
  const mb=await ev(`(function(){const mut=document.querySelector('.blocklyMutatorBackground');const svg=mut.closest('svg');const fl=svg.querySelector('g.blocklyFlyout');const blk=fl.querySelector('g.blocklyBlockCanvas > g.blocklyDraggable');const r=blk.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  console.log('mutator浮层积木',mb);
  // 触摸拖到右侧工作区
  const tgt={x:mb.x+150,y:mb.y+40};
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mb.x,y:mb.y}]});
  for(let i=1;i<=8;i++){await sleep(60);await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.round(mb.x+(tgt.x-mb.x)*i/8),y:Math.round(mb.y+(tgt.y-mb.y)*i/8)}]});}
  await sleep(200);
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(600);
  console.log('触摸拖动后 mutator:',await ev(`(function(){const m=document.querySelector('.blocklyMutatorBackground');return m?Math.round(m.getBoundingClientRect().width):0;})()`));
  console.log('最近 pointerdown 记录:',await ev(`JSON.stringify(window.__pd.slice(-4),null,1)`));

  // 再测：拖动 mutator 右侧工作区里已有的积木
  const wb=await ev(`(function(){const mut=document.querySelector('.blocklyMutatorBackground');if(!mut)return null;const svg=mut.closest('svg');const wss=[].slice.call(svg.querySelectorAll('g.blocklyWorkspace')).filter(g=>!g.parentNode.classList.contains('blocklyFlyout'));const blk=wss[wss.length-1].querySelector('g.blocklyBlockCanvas > g.blocklyDraggable');if(!blk)return null;const r=blk.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  console.log('mutator工作区积木',wb);
  if(wb){
    const t2={x:wb.x+40,y:wb.y+50};
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:wb.x,y:wb.y}]});
    for(let i=1;i<=6;i++){await sleep(60);await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.round(wb.x+(t2.x-wb.x)*i/6),y:Math.round(wb.y+(t2.y-wb.y)*i/6)}]});}
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sleep(500);
    console.log('二次拖动后 mutator:',await ev(`(function(){const m=document.querySelector('.blocklyMutatorBackground');return m?Math.round(m.getBoundingClientRect().width):0;})()`));
    console.log('最后 pointerdown:',await ev(`JSON.stringify(window.__pd.slice(-2),null,1)`));
  }
  process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
