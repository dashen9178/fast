const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(2200);
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,300));return r.result.value;};
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(500);
await ev(`var i=document.getElementById('newAppName');i.value='穿透';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`);await sleep(1200);
// 设计页加按钮并选中
await ev(`document.getElementById('tabDesign').click();1`);await sleep(400);
await ev(`document.querySelector('[data-add="button"]').click();1`);await sleep(500);
// 选中按钮（点画布上的按钮控件）以弹出属性面板
await ev(`(function(){var el=document.querySelector('#designArea .comp, #designArea [data-comp], .comp-item, [class*="component"]');if(el)el.click();return !!el;})()`);await sleep(400);
const selBtnCount=await ev(`document.querySelectorAll('.pp-sel-btn').length`);
console.log('M3 select buttons:',selBtnCount);
// 打开第一个 M3 下拉
const opened=await ev(`(function(){var b=document.querySelector('.pp-sel-btn');if(!b)return 'no-btn';b.click();return !!document.querySelector('.pp-sel-menu');})()`);
console.log('menu opened:',opened);await sleep(300);
// 取第一个菜单项坐标，在其位置下方埋一个测试按钮（z 低于菜单1300）
const pos=JSON.parse(await ev(`(function(){var it=document.querySelector('.pp-sel-menu .menu-item');var r=it.getBoundingClientRect();
  var t=document.createElement('button');t.id='ghostTarget';t.textContent='A';
  t.style.cssText='position:fixed;left:'+(r.left)+'px;top:'+(r.top)+'px;width:'+r.width+'px;height:'+r.height+'px;z-index:1290;background:red;';
  window.__ghostHits=0;t.addEventListener('click',function(){window.__ghostHits++;});
  document.body.appendChild(t);
  return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`));
console.log('item pos',JSON.stringify(pos));
// 真实点击菜单项（触发 onPick + armGhostGuard，菜单关闭）
async function clickAt(x,y){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await sleep(20);await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(20);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});await sleep(120);}
await clickAt(pos.x,pos.y);
const menuGone=await ev(`!document.querySelector('.pp-sel-menu')`);
// 菜单已关，此时同坐标命中的应是测试按钮 A；模拟浏览器补发的 ghost click
await ev(`(function(){var el=document.elementFromPoint(${pos.x},${pos.y});
  var opts={bubbles:true,cancelable:true,clientX:${pos.x},clientY:${pos.y},view:window};
  el.dispatchEvent(new PointerEvent('pointerdown',opts));
  el.dispatchEvent(new MouseEvent('click',opts));
  return el.id||el.className;})()`);
await sleep(100);
const hits=await ev(`window.__ghostHits`);
console.log('menu closed after pick:',menuGone,'| ghost clicks reached button A:',hits,'(应为 0)');
// 对照：500ms 后正常点击应能点到按钮 A（guard 已过期）
await sleep(500);
await ev(`(function(){var el=document.getElementById('ghostTarget');el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:${pos.x},clientY:${pos.y},view:window}));})()`);
const hits2=await ev(`window.__ghostHits`);
console.log('guard 过期后正常点击:',hits2,'(应恢复可点，计数变 1)');
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
