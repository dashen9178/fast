const WebSocket=require('/home/user/fast/test/node_modules/ws');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
await ev(`(function(){
  window.__hits=0;
  var a=document.createElement('button');a.id='__btnA';a.textContent='A';
  a.style.cssText='position:fixed;left:560px;top:700px;width:120px;height:60px;z-index:1000;font-size:20px;';
  a.addEventListener('click',function(){window.__hits++;});
  document.body.appendChild(a);
  var menu=document.createElement('div');
  menu.className='popover pp-sel-menu';menu.id='__m';
  menu.style.cssText='position:fixed;left:540px;top:570px;width:160px;z-index:1300;background:#fff;border:1px solid #999;';
  var it=document.createElement('button');it.className='menu-item';it.textContent='X';
  it.style.cssText='display:block;width:100%;height:56px;';
  it.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();document.body.removeChild(menu);});
  menu.appendChild(it);document.body.appendChild(menu);
  document.addEventListener('click',function(e){window.__clickLog=(window.__clickLog||[]).concat(e.target.id||e.target.className||e.target.tagName);},true);
  document.addEventListener('pointerdown',function onD(e){
    if(menu.contains(e.target))return;
    installClickCatcher();
    if(menu.parentNode)menu.parentNode.removeChild(menu);
    document.removeEventListener('pointerdown',onD,true);
    window.__diagAtDown={el:e.target.id||e.target.className||e.target.tagName,
      catcherImmediate:!!document.getElementById('__clickCatcher'),
      hitAfter:document.elementFromPoint(620,730).id||document.elementFromPoint(620,730).tagName};
  },true);
  return 1;})()`);
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:620,y:730});
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:620,y:730,button:'left',buttons:1,clickCount:1});
await sleep(50);
const d1=await ev(`JSON.stringify(window.__diagAtDown)`);
console.log('pointerdown后:',d1);
const d2=await ev(`(function(){var e=document.elementFromPoint(620,730);return (e.id||e.className||e.tagName)+' catcher='+!!document.getElementById('__clickCatcher');})()`);
console.log('release前命中:',d2);
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:620,y:730,button:'left',buttons:0,clickCount:1});
await sleep(150);
console.log('release后 hits(应0):',await ev(`window.__hits`),'click日志:',JSON.stringify(await ev(`window.__clickLog`)));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
