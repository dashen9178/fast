const WebSocket=require('ws');const HTTP='http://127.0.0.1:9333';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
function conn(u){return new Promise((res,rej)=>{const ws=new WebSocket(u,{perMessageDeflate:false});const pend={};ws.on('open',()=>res({send:(m,p={})=>new Promise((r,j)=>{const i=++id;pend[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));})}));ws.on('message',d=>{const o=JSON.parse(d);if(o.id&&pend[o.id])o.error?pend[o.id].j(new Error(JSON.stringify(o.error))):pend[o.id].r(o.result);});ws.on('error',rej);});}
let pass=0,fail=0;function ok(n,c,e){if(c){pass++;console.log('  ✓',n);}else{fail++;console.log('  ✗',n,e!==undefined?JSON.stringify(e):'');}}
(async()=>{
  const l=await get('/json/list');const t=l.find(x=>x.type==='page');const c=await conn(t.webSocketDebuggerUrl);const send=c.send;
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result.value;};
  await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?t='+Date.now()});setTimeout(r,900);});
  await ev(`document.getElementById('btnNewApp').click();1`);await sleep(250);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试App';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();})()`);await sleep(400);
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1200);

  const topCount=()=>ev(`Blockly.getMainWorkspace().getTopBlocks(true).length`);
  const before=await topCount();
  // 打开“事件”分类
  await ev(`[].slice.call(document.querySelectorAll('#bbCats .bb-panel-general .bb-cat')).find(x=>x.querySelector('.bb-cat-lb').textContent==='事件').click();1`);
  await sleep(400);
  // 取浮层第一个积木中心，鼠标点取（tap 即在主画布创建副本）
  const fb=await ev(`(function(){var fl=Blockly.getMainWorkspace().getFlyout();var b=fl.getWorkspace().getTopBlocks(true)[0];var p=b.getRelativeToSurfaceXY();var ws=fl.getWorkspace();var scale=ws.getScale();var xy=ws.getSvgXY?ws.getSvgXY(b.svgGroup_):null;var r=b.svgGroup_.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:fb.x,y:fb.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:fb.x,y:fb.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:fb.x,y:fb.y,button:'left',clickCount:1});
  await sleep(500);
  const after=await topCount();
  ok('点取浮层积木→画布新增块',after===before+1,{before,after});

  // 控件态：按钮分类浮层积木数
  await ev(`document.querySelector('#bbCats .bb-bot-wrap .bb-switch').click();1`);await sleep(400);
  await ev(`[].slice.call(document.querySelectorAll('#bbCats .bb-panel-widget .bb-cat')).find(x=>x.querySelector('.bb-cat-lb').textContent==='按钮').click();1`);
  await sleep(400);
  const wb=await ev(`Blockly.getMainWorkspace().getFlyout().getWorkspace().getTopBlocks(true).length`);
  ok('控件-按钮浮层有积木',wb>=7,wb);

  // 横屏：切方向后轨道仍可切换、浮层正常
  await ev(`document.getElementById('tabDesign')&&document.getElementById('tabDesign').click();1`);await sleep(300);
  await ev(`(function(){var b=document.querySelector('#moreOrient [data-orient="landscape"]');if(b)b.click();return 1;})()`);await sleep(300);
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(900);
  const land0=await ev(`(function(){var rail=document.getElementById('bbCats');var active=rail.querySelector('.bb-mode-widget .bb-switch, .bb-mode-general .bb-switch');var r=active.getBoundingClientRect();return {mode:rail.className,switchH:Math.round(r.height),railW:Math.round(rail.getBoundingClientRect().width)};})()`);
  ok('横屏轨道宽112/当前态切换按钮30高',land0.switchH===30&&land0.railW===112,land0);
  // 横屏下点当前可见切换按钮，应能正常切态
  await ev(`(function(){var rail=document.getElementById('bbCats');var vis=rail.className.indexOf('widget')>=0?'.bb-top-wrap .bb-switch':'.bb-bot-wrap .bb-switch';rail.querySelector(vis).click();return 1;})()`);
  await sleep(400);
  const landMode=await ev(`document.getElementById('bbCats').className`);
  ok('横屏下可切回常规态',/bb-mode-general/.test(landMode),landMode);

  console.log('\\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});
