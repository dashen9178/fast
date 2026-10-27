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

  // ---------- bug3：新建控件从最上面 ----------
  await ev(`document.querySelector('[data-add="button"]').click();1`);await sleep(120);
  await ev(`document.querySelector('[data-add="button"]').click();1`);await sleep(200);
  const order=await ev(`[].slice.call(document.querySelectorAll('#compList .compcard .t1')).map(e=>e.textContent)`);
  ok('连加2个按钮，最新的在最上面',/button\d/.test(order[0])&&/button\d/.test(order[1])&&order[0]!==order[1]&&order[0].match(/button(\d+)/)[1]>order[1].match(/button(\d+)/)[1],order);
  const newestId=order[0].match(/\((button\d+)\)/)[1];

  // 选中第一张卡（最新按钮），改名“我的按钮A”
  await ev(`document.querySelector('#compList .compcard').click();1`);await sleep(150);
  await ev(`(function(){var f=[].slice.call(document.querySelectorAll('#propPanel .pp-field')).find(x=>x.textContent.indexOf('组件名称')>=0);var i=f.querySelector('input');i.value='我的按钮A';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(200);

  // ---------- 进积木，控件态→按钮分类，放一个“当按钮被点击” ----------
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1200);
  await ev(`document.querySelector('#bbCats .bb-bot-wrap .bb-switch').click();1`);await sleep(400);
  await ev(`[].slice.call(document.querySelectorAll('#bbCats .bb-panel-widget .bb-cat')).find(x=>x.querySelector('.bb-cat-lb').textContent==='按钮').click();1`);
  await sleep(450);
  // 浮层第一个块（当…被点击帽子），鼠标点取到画布
  const fb=await ev(`(function(){var fl=Blockly.getMainWorkspace().getFlyout();var b=fl.getWorkspace().getTopBlocks(true)[0];var r=b.svgGroup_.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),type:b.type};})()`);
  ok('浮层首个为按钮点击帽子',/^v_button_click$/.test(fb.type),fb.type);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:fb.x,y:fb.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:fb.x,y:fb.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:fb.x,y:fb.y,button:'left',clickCount:1});
  await sleep(500);
  const f1=await ev(`(function(){var b=Blockly.getMainWorkspace().getTopBlocks(true).find(x=>x.type==='v_button_click');var f=b.getField('COMP');return {text:f.getText(),value:f.getValue()};})()`);
  ok('积木下拉显示控件名“我的按钮A”',f1.text.indexOf('我的按钮A')>=0,f1);
  ok('下拉 value 存的是 id 而非名字',/^button\d+$/.test(f1.value),f1);

  // ---------- bug2：改名后积木下拉同步 ----------
  await ev(`document.getElementById('tabDesign').click();1`);await sleep(300);
  await ev(`(function(){var f=[].slice.call(document.querySelectorAll('#propPanel .pp-field')).find(x=>x.textContent.indexOf('组件名称')>=0);var i=f.querySelector('input');i.value='新名字C';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
  await sleep(250);
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(950);
  const f2=await ev(`(function(){var b=Blockly.getMainWorkspace().getTopBlocks(true).find(x=>x.type==='v_button_click');var f=b.getField('COMP');return {text:f.getText(),value:f.getValue()};})()`);
  ok('改名后积木下拉更新为“新名字C”',f2.text.indexOf('新名字C')>=0&&f2.text.indexOf('我的按钮A')<0,f2);
  ok('改名后 value 仍是同一 id',f2.value===f1.value,{before:f1.value,after:f2.value});

  // ---------- bug4：切换槽缩小 + 组名在槽内（两态都校验） ----------
  // 先确保回到常规态
  await ev(`(function(){var rail=document.getElementById('bbCats');if(rail.className.indexOf('widget')>=0)rail.querySelector('.bb-top-wrap .bb-switch').click();return 1;})()`);
  await sleep(380);
  const slotG=await ev(`(function(){var rail=document.getElementById('bbCats');return {botH:getComputedStyle(rail.querySelector('.bb-bot-wrap')).height,topH:getComputedStyle(rail.querySelector('.bb-top-wrap')).height,botTx:(rail.querySelector('.bb-bot-wrap .bb-sw-tx')||{}).textContent,topTx:(rail.querySelector('.bb-top-wrap .bb-sw-tx')||{}).textContent,labels:rail.querySelectorAll('.bb-panel-label').length};})()`);
  ok('常规态底部槽30/顶部0',slotG.botH==='30px'&&slotG.topH==='0px',slotG);
  ok('槽内含组名/列表无独立标题',slotG.botTx==='控件积木'&&slotG.topTx==='常规积木'&&slotG.labels===0,slotG);
  await ev(`document.querySelector('#bbCats .bb-bot-wrap .bb-switch').click();1`);await sleep(380);
  const slotW=await ev(`(function(){var rail=document.getElementById('bbCats');return {botH:getComputedStyle(rail.querySelector('.bb-bot-wrap')).height,topH:getComputedStyle(rail.querySelector('.bb-top-wrap')).height};})()`);
  ok('控件态顶部槽30/底部0',slotW.topH==='30px'&&slotW.botH==='0px',slotW);

  // ---------- bug1a：分类浮层切走后关闭（此刻停在控件态） ----------
  await ev(`[].slice.call(document.querySelectorAll('#bbCats .bb-panel-widget .bb-cat')).find(x=>x.querySelector('.bb-cat-lb').textContent==='按钮').click();1`);
  await sleep(400);
  const openBefore=await ev(`(function(){var ws=Blockly.getMainWorkspace();return {fly:ws.getFlyout().isVisible(),sel:!!ws.getToolbox().getSelectedItem()};})()`);
  ok('切走前浮层确实打开',openBefore.fly===true,openBefore);
  await ev(`document.getElementById('tabDesign').click();1`);await sleep(350);
  const afterLeave=await ev(`(function(){var ws=Blockly.getMainWorkspace();var dd=document.querySelector('.blocklyDropDownDiv');return {fly:ws.getFlyout().isVisible(),sel:!!ws.getToolbox().getSelectedItem(),ddDisplay:dd?getComputedStyle(dd).display:'none'};})()`);
  ok('切设计后分类浮层关闭',afterLeave.fly===false,afterLeave);
  ok('切设计后分类无选中',afterLeave.sel===false,afterLeave);

  // ---------- bug1b：控件下拉(挂 body)切走后关闭 ----------
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
  // 点画布积木上的 COMP 下拉文字
  const ddCoord=await ev(`(function(){var b=Blockly.getMainWorkspace().getTopBlocks(true).find(x=>x.type==='v_button_click');var t=b.svgGroup_.querySelector('.blocklyDropdownText');var r=t.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:ddCoord.x,y:ddCoord.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:ddCoord.x,y:ddCoord.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:ddCoord.x,y:ddCoord.y,button:'left',clickCount:1});
  await sleep(400);
  const ddOpen=await ev(`(function(){var dd=document.querySelector('.blocklyDropDownDiv');var items=document.querySelectorAll('.blocklyDropDownDiv .blocklyMenuItem').length;return {display:dd?getComputedStyle(dd).display:'none',items:items};})()`);
  ok('控件下拉已弹出',ddOpen.display==='block'&&ddOpen.items>0,ddOpen);
  await ev(`document.getElementById('tabDesign').click();1`);await sleep(350);
  const ddAfter=await ev(`(function(){var dd=document.querySelector('.blocklyDropDownDiv');return {display:dd?getComputedStyle(dd).display:'none',items:document.querySelectorAll('.blocklyDropDownDiv .blocklyMenuItem').length};})()`);
  ok('切设计后控件下拉关闭(不残留)',ddAfter.display==='none'||ddAfter.items===0,ddAfter);

  console.log('\\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});
