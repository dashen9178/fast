const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9222';
function get(path){return new Promise((res,rej)=>{require('http').get(HTTP+path,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let msgId=0;
async function conn(){
  const list=await get('/json/list');const t=list.find(x=>x.type==='page')||list[0];
  return new Promise((res,rej)=>{
    const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const pending={};
    ws.on('open',()=>res({
      send(method,params={}){return new Promise((r,j)=>{const id=++msgId;pending[id]={r,j};ws.send(JSON.stringify({id,method,params}));});},
      ws}));
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

  await ev(`window.__closeLog=[]; (function(){const ws=window.blocklyWs; if(!ws)return; const orig=ws.closeMutatorBubbles; ws.closeMutatorBubbles=function(reason){window.__closeLog.push(reason||'?');return orig&&orig.call(ws);};})(); 1`);
  // 诊断：记录 blocklyDiv 捕获阶段 pointerdown 是否会走关闭逻辑
  await ev(`window.__pdLog=[];document.getElementById('blocklyDiv').addEventListener('pointerdown',function(e){const SEL='.blocklyToolboxDiv,.blocklyFlyout,.blocklyBubble,.blocklyBubbleCanvas,.blocklyWidgetDiv,.blocklyDropDownDiv,.blocklyZoom,.blocklyIconGroup';const hit=e.target.closest?e.target.closest(SEL):null;window.__pdLog.push({cls:(e.target.getAttribute&&e.target.getAttribute('class')||e.target.nodeName)+'', excluded:!!hit, ex:hit?hit.className.baseVal||hit.className:''});},true);1`);

  async function catBtn(label){return ev(`(function(){const b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>(x.querySelector('.bb-cat-lb')||{}).textContent===${JSON.stringify(label)});if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);}
  async function tap(p){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  async function click(p){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});}
  async function drag(p1,p2,steps=8,btn='left'){
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p1.x,y:p1.y});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p1.x,y:p1.y,button:btn,clickCount:1});
    for(let i=1;i<=steps;i++){await sleep(45);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.round(p1.x+(p2.x-p1.x)*i/steps),y:Math.round(p1.y+(p2.y-p1.y)*i/steps),buttons:1});}
    await sleep(120);
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p2.x,y:p2.y,button:btn,clickCount:1});
  }
  const flyBlock=async n=>ev(`(function(){const g=document.querySelector('.blocklyFlyout .blocklyBlockCanvas');const bs=[].slice.call(g.children).filter(x=>(x.getAttribute('class')||'').indexOf('blocklyDraggable')>=0);const b=bs[${n||0}];if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(20,r.height/2)),txt:b.textContent};})()`);

  /* ---------- BUG 1 ---------- */
  console.log('=== BUG1 删除提示 ===');
  let p=await catBtn('控制'); await tap(p); await sleep(700);
  const fb=await flyBlock(0);
  console.log('浮层积木',fb&&fb.txt,fb&&[fb.x,fb.y]);
  await click(fb); await sleep(700);
  console.log('画布顶层积木数:',await ev('window.blocklyWs.getTopBlocks(false).length'));
  const wb=await ev(`(function(){const b=window.blocklyWs.getTopBlocks(false)[0];const r=b.getSvgRoot().getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(24,r.height/2))};})()`);
  console.log('画布积木坐标',wb);
  const tb=await ev(`(function(){const t=document.querySelector('.blocklyToolboxDiv');const r=t.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:wb.x,y:wb.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:wb.x,y:wb.y,button:'left',clickCount:1});
  for(let i=1;i<=8;i++){await sleep(45);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:Math.round(wb.x+(tb.x-wb.x)*i/8),y:Math.round(wb.y+(tb.y-wb.y)*i/8),buttons:1});}
  await sleep(150);
  const hintDuring=await ev(`document.getElementById('delZone').classList.contains('on')`);
  console.log('拖到栏上时提示显示:',hintDuring);
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:tb.x,y:tb.y,button:'left',clickCount:1});
  await sleep(500);
  const hintAfter=await ev(`document.getElementById('delZone').classList.contains('on')`);
  console.log('松手后提示残留:',hintAfter,' 画布顶层积木数:',await ev('window.blocklyWs.getTopBlocks(false).length'));

  /* ---------- BUG 3 ---------- */
  console.log('\\n=== BUG3 齿轮 mutator ===');
  await ev(`window.__closeLog=[];1`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await sleep(300);
  p=await catBtn('数据列表'); await tap(p);await sleep(700);
  const lb=await flyBlock(0);
  console.log('数据列表浮层第一块:',lb.txt);
  await click({x:lb.x,y:lb.y}); await sleep(700);
  const gear=await ev(`(function(){const gs=[].slice.call(document.querySelectorAll('#blocklyDiv .blocklyIconGroup.blockly-icon-mutator')).filter(g=>{const r=g.getBoundingClientRect();return r.width>0&&r.height>0&&!(g.closest('.blocklyFlyout'));});const g=gs[gs.length-1];if(!g)return null;const r=g.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  console.log('齿轮',gear);
  await click(gear); await sleep(800);
  const mut0=await ev(`!!document.querySelector('.blocklyMutatorBackground')`);
  console.log('齿轮点开 mutator 存在:',mut0);
  const mb=await ev(`(function(){const mut=document.querySelector('.blocklyMutatorBackground');if(!mut)return null;const svg=mut.closest('svg');const blk=svg.querySelector('g.blocklyBlockCanvas > g.blocklyDraggable');if(!blk)return null;const r=blk.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  console.log('mutator 内积木',mb);
  if(mb){
    // 先记录 pointerdown 落点的祖先链
    const chain=await ev(`(function(){const mut=document.querySelector('.blocklyMutatorBackground');const svg=mut.closest('svg');const blk=svg.querySelector('g.blocklyBlockCanvas > g.blocklyDraggable');let n=blk,out=[];while(n&&out.length<12){out.push(n.nodeName.toLowerCase()+'.'+(n.getAttribute&&n.getAttribute('class')||'').split(' ').join('.'));n=n.parentNode;}return out.join(' < ');})()`);
    console.log('祖先链:',chain);
    await drag({x:mb.x,y:mb.y},{x:mb.x+70,y:mb.y+60},6);
    await sleep(500);
  }
  const mut1=await ev(`(function(){const mut=document.querySelector('.blocklyMutatorBackground');return {exists:!!mut, w:mut?Math.round(mut.getBoundingClientRect().width):0};})()`);
  console.log('拖动后 mutator:',JSON.stringify(mut1));
  console.log('closeMutatorBubbles 调用记录:',await ev('JSON.stringify(window.__closeLog)'));
  console.log('pointerdown 判定记录:',await ev('JSON.stringify(window.__pdLog.slice(-6))'));
  process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
