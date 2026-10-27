const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 布置：按钮 A 固定在 (600,500)，浮层菜单项盖在它上面
await ev(`(function(){
  window.__hits=0;
  var a=document.createElement('button');a.id='__btnA';a.textContent='A';
  a.style.cssText='position:fixed;left:560px;top:560px;width:120px;height:60px;z-index:1000;font-size:20px;';
  a.addEventListener('click',function(){window.__hits++;});
  document.body.appendChild(a);
  var b2=document.createElement('button');b2.id='__btnB';b2.textContent='B';
  b2.style.cssText='position:fixed;left:560px;top:700px;width:120px;height:60px;z-index:1000;font-size:20px;';
  b2.addEventListener('click',function(){window.__hitsB=(window.__hitsB||0)+1;});
  document.body.appendChild(b2);
  return 1;})()`);
async function realClick(x,y){
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x,y:y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x,y:y,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x,y:y,button:'left',buttons:0,clickCount:1});
  await sleep(120);
}
function openMenu(){return ev(`(function(){
  var menu=document.createElement('div');
  menu.className='popover pp-sel-menu';
  menu.style.cssText='position:fixed;left:540px;top:570px;width:160px;z-index:1300;background:#fff;border:1px solid #999;';
  var it=document.createElement('button');it.className='menu-item';it.type='button';it.textContent='列表项X';
  it.style.cssText='display:block;width:100%;height:56px;font-size:18px;';
  it.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();document.body.removeChild(menu);window.__itemHit=(window.__itemHit||0)+1;});
  menu.appendChild(it);
  document.body.appendChild(menu);
  var r=it.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
})()`);}
// === 场景1：点菜单项（菜单盖住按钮A），紧接着同位置再来一次点击（模拟真机 ghost click）===
var p1=JSON.parse(await openMenu());
await realClick(p1.x,p1.y);
const itemHit=await ev(`window.__itemHit||0`);
await realClick(p1.x,p1.y);   // ghost：此时捕手应吞掉
await sleep(30);
const hits1=await ev(`window.__hits`);
console.log('场景1 菜单项命中:',itemHit,' ghost后按钮A命中(应0):',hits1);
await sleep(420);
await realClick(p1.x,p1.y);   // 捕手消失后恢复
const hits2=await ev(`window.__hits`);
console.log('场景1 恢复后按钮A命中(应1):',hits2);
// === 场景2：菜单打开，点外部（按钮A位置）关闭，首次点按只关闭不穿透 ===
await openMenu();
await ev(`(function(){
  // 复刻 M3 的 document 捕获 pointerdown 外部关闭逻辑（与 openM3SelectMenu 内一致）
  var menu=document.querySelector('.pp-sel-menu');
  document.addEventListener('pointerdown',function onD(e){
    if(menu.contains(e.target))return;
    if(typeof installClickCatcher==='function')installClickCatcher();
    if(menu.parentNode)menu.parentNode.removeChild(menu);
    document.removeEventListener('pointerdown',onD,true);
  },true);
  return 1;})()`);
await realClick(620,730);  // 菜单外、按钮B上
const hits3=await ev(`window.__hitsB||0`);
console.log('场景2 外部首点关闭 B命中(应0):',hits3);
await realClick(620,730);  // 350ms 内再点
const hits4=await ev(`window.__hitsB||0`);
console.log('场景2 350ms内再点 B命中(应0):',hits4);
await sleep(420);
await realClick(620,730);
const hits5=await ev(`window.__hitsB||0`);
console.log('场景2 恢复后 B命中(应1):',hits5);
// === 场景3：Blockly 自带下拉浮层选择器识别 ===
const sel=await ev(`(function(){
  var d=document.createElement('div');d.className='blocklyDropDownDiv';
  document.body.appendChild(d);
  var ok=!!d.closest('.popover, .modal, .mask, .pp-sel-menu, .menu-list, .blocklyDropDownDiv, .blocklyDropdownMenu, [role="dialog"], [id$="Mask"], [id$="Menu"], #ifMutMenu, #ifMutMask');
  document.body.removeChild(d);return ok;})()`);
console.log('场景3 Blockly下拉浮层可识别:',sel);
// 清理
await ev(`var b=document.getElementById('__btnA');if(b)b.parentNode.removeChild(b);1`);
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
