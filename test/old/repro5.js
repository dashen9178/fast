const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9222';
function get(path){return new Promise((res,rej)=>{require('http').get(HTTP+path,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let msgId=0;
async function conn(){const list=await get('/json/list');const t=list.find(x=>x.type==='page')||list[0];
  return new Promise((res,rej)=>{const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const pending={};
    ws.on('open',()=>res({send(m,p={}){return new Promise((r,j)=>{const id=++msgId;pending[id]={r,j};ws.send(JSON.stringify({id,method:m,params:p}));});}}));
    ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&pending[o.id])o.error?pending[o.id].j(new Error(JSON.stringify(o.error))):pending[o.id].r(o.result);});
    ws.on('error',rej);});}
(async()=>{
  const send=(await conn()).send;
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text));return r.result.value;};
  await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});setTimeout(r,1400);});
  await ev(`document.getElementById('btnNewApp').click();1`);await sleep(300);
  await ev(`document.getElementById('createGo').click();1`);await sleep(500);
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1600);
  async function catBtn(label){return ev(`(function(){const b=[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(x=>(x.querySelector('.bb-cat-lb')||{}).textContent===${JSON.stringify(label)});const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);}
  async function tap(p){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  async function click(p){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});}
  let p=await catBtn('数据列表'); await tap(p);await sleep(700);
  const lb=await ev(`(function(){const g=document.querySelector('.blocklyFlyout .blocklyBlockCanvas');const b=[].slice.call(g.children).filter(x=>(x.getAttribute('class')||'').indexOf('blocklyDraggable')>=0)[0];const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+20)};})()`);
  await click(lb); await sleep(700);
  const gear=await ev(`(function(){const gs=[].slice.call(document.querySelectorAll('#blocklyDiv .blocklyIconGroup.blockly-icon-mutator')).filter(g=>{const r=g.getBoundingClientRect();return r.width>0&&!g.closest('.blocklyFlyout');});const g=gs[gs.length-1];const r=g.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await click(gear); await sleep(800);
  // 埋点：包装 mutator icon 的 setBubbleVisible，记录 false 调用栈
  await ev(`(function(){const ws=window.blocklyWs;const b=ws.getTopBlocks(false).find(x=>x.type==='lists_create_with'||(x.mutator));if(!b||!b.mutator)return 'no mutator';const m=b.mutator;const orig=m.setBubbleVisible.bind(m);window.__closes=[];m.setBubbleVisible=function(v){if(v===false)window.__closes.push(new Error().stack);return orig(v);};window.__mut=m;return 'hooked';})()`);
  // 同时埋点我们自己的 closeMutatorBubbles
  await ev(`(function(){const ws=window.blocklyWs;const o=ws.closeMutatorBubbles;ws.closeMutatorBubbles=function(){window.__closes.push('CLOSE_MUTATOR_BUBBLES');return o.call(ws);};})();1`);
  const mutOpen=()=>ev(`(function(){const m=document.querySelector('.blocklyMutatorBackground');return m?Math.round(m.getBoundingClientRect().width):0;})()`);
  console.log('打开宽度:',await mutOpen());
  console.log('直接调 hideChaff 后:');
  await ev(`window.blocklyWs.hideChaff();1`);
  console.log('  宽度:',await mutOpen());
  // 重新打开
  if(!await mutOpen()){await click(gear);await sleep(700);console.log('重新打开:',await mutOpen());}

  // 场景1：触摸把浮层“项目”拖进右侧工作区
  const mb=await ev(`(function(){const mut=document.querySelector('.blocklyMutatorBackground');const svg=mut.closest('svg');const fl=svg.querySelector('g.blocklyFlyout');const blk=fl.querySelector('g.blocklyBlockCanvas > g.blocklyDraggable');const r=blk.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  async function tdrag(a,b,n=8,dt=55){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x,y:a.y}]});for(let i=1;i<=n;i++){await sleep(dt);await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:Math.round(a.x+(b.x-a.x)*i/n),y:Math.round(a.y+(b.y-a.y)*i/n)}]});}await sleep(150);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  await tdrag(mb,{x:mb.x+150,y:mb.y+30});
  await sleep(500);
  console.log('场景1 浮层块拖入工作区后:',await mutOpen());
  // 场景2：拖动工作区里的块
  const wb=await ev(`(function(){const mut=document.querySelector('.blocklyMutatorBackground');const svg=mut.closest('svg');const wss=[].slice.call(svg.querySelectorAll('g.blocklyWorkspace')).filter(g=>!g.closest('.blocklyFlyout')&&g.querySelector('g.blocklyBlockCanvas > g.blocklyDraggable'));let best=null;wss.forEach(g=>{const blk=g.querySelector('g.blocklyBlockCanvas > g.blocklyDraggable');const r=blk.getBoundingClientRect();if(r.width>0&&(!best||r.width>best.w))best={x:r.left+r.width/2,y:r.top+r.height/2,w:r.width};});return best;})()`);
  console.log('工作区块',wb);
  if(wb){await tdrag({x:wb.x,y:wb.y},{x:wb.x+30,y:wb.y+70});await sleep(500);console.log('场景2 拖动工作区块后:',await mutOpen());}
  // 场景3：长按工作区块（触发触摸长按）
  if(wb){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:wb.x,y:wb.y}]});await sleep(900);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(500);console.log('场景3 长按后:',await mutOpen());}
  // 场景4：双指捏合
  if(wb){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:wb.x-30,y:wb.y-30,id:0}]});await sleep(100);await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:wb.x-30,y:wb.y-30,id:0},{x:wb.x+40,y:wb.y+40,id:1}]});await sleep(100);await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:wb.x-10,y:wb.y-10,id:0},{x:wb.x+20,y:wb.y+20,id:1}]});await sleep(200);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x:wb.x-10,y:wb.y-10,id:0}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(500);console.log('场景4 双指后:',await mutOpen());}
  console.log('\\n关闭调用栈记录:');
  console.log(await ev(`JSON.stringify(window.__closes,null,1)`));
  process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
