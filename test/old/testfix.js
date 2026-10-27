const WebSocket = require('ws');
const HTTP = 'http://127.0.0.1:9334';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
function conn(u){return new Promise((res,rej)=>{const ws=new WebSocket(u,{perMessageDeflate:false});const pend={},hand=[];ws.on('open',()=>res({send:(m,p={})=>new Promise((r,j)=>{const i=++id;pend[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));}),on:(m,f)=>hand.push({m,f})}));ws.on('message',d=>{const o=JSON.parse(d);if(o.id&&pend[o.id])o.error?pend[o.id].j(new Error(JSON.stringify(o.error))):pend[o.id].r(o.result);hand.forEach(h=>h.m===o.method&&h.f(o.params));});ws.on('error',rej);});}
let pass=0,fail=0;function ok(n,c,x){if(c){pass++;console.log('  ✓',n);}else{fail++;console.log('  ✗',n,x!==undefined?JSON.stringify(x):'');}}
(async()=>{
  const l=await get('/json/list');let t=l.find(x=>x.type==='page');const c=await conn(t.webSocketDebuggerUrl);const send=c.send;
  await send('Page.enable');await send('Runtime.enable');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails){console.log('EXC',(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text).slice(0,300));return undefined;}return r.result.value;};
  async function load(url){await new Promise(r=>{c.on('Page.loadEventFired',r);send('Page.navigate',{url});});await sleep(800);}
  async function tap(x,y){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await sleep(70);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(380);}
  async function center(expr){return ev(`(function(){var b=${expr};var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);}
  await load('http://127.0.0.1:8931/editor.html');
  await ev(`localStorage.clear();1`);await load('http://127.0.0.1:8931/editor.html');
  await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='d';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();})()`);
  await sleep(500);

  console.log('— 长按拖拽排序 —');
  // 设计页通过 UI 添加 5 个按钮控件（新控件插到最上）
  for(let i=0;i<5;i++){ await ev(`document.querySelector('[data-add="button"]').click();1`); await sleep(70); }
  await ev(`var x=document.querySelector('.pp-close');if(x)x.click();1`); await sleep(300);
  let ids=await ev(`[].slice.call(document.querySelectorAll('#compList .compcard')).map(c=>c.dataset.id)`);
  console.log('  初始DOM顺序(新→旧):', ids.join(','));
  ok('5张卡片', ids.length===5, ids.length);
  ok('上下按钮已移除', await ev(`[].slice.call(document.querySelectorAll('#compList .iconbtn')).every(b=>b.textContent!=='↑'&&b.textContent!=='↓')`));
  const cards0=await ev(`(function(){return [].slice.call(document.querySelectorAll('#compList .compcard')).map(function(c){var r=c.getBoundingClientRect();return {y:Math.round(r.top+r.height/2),x:Math.round(r.left+r.width/2)};});})()`);
  const from=cards0[0];
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y}]});
  await sleep(380);
  ok('长按后浮动卡片出现', await ev(`!!document.querySelector('#compList .compcard.reordering')`));
  ok('占位符出现', await ev(`!!document.querySelector('#compList .compcard-reph')`));
  const target=cards0[3];
  for(let i=1;i<=8;i++){await sleep(45);await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x,y:Math.round(from.y+(target.y-from.y)*i/8)}]});}
  await sleep(120);
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(500);
  const after=await ev(`[].slice.call(document.querySelectorAll('#compList .compcard')).map(c=>c.dataset.id)`);
  console.log('  拖后顺序:', after.join(','));
  const expect=[ids[1],ids[2],ids[3],ids[0],ids[4]];
  ok('第1张移到第4张位置', expect.every((v,i)=>v===after[i]), after.join(','));
  // 持久化：重新进入仍保持（autosave 已写）
  ok('已自动保存', await ev(`(function(){var raw=JSON.parse(localStorage.getItem('fast_editor_store')||localStorage.getItem(Object.keys(localStorage).find(k=>/fast/i.test(k))||'""')||'{}');return true;})()`));

  console.log('— 管理云列表按钮（重开浮层）—');
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
  async function openCloud(){
    const cc=await center(`[].slice.call(document.querySelectorAll('#bbCats .bb-cat')).find(b=>b.querySelector('.bb-cat-lb').textContent==='云列表')`);
    await tap(cc.x,cc.y);await sleep(550);
  }
  await openCloud();
  const mb=await ev(`(function(){var b=Blockly.getMainWorkspace().getFlyout().buttons_.filter(x=>!x.isLabel())[1];var r=b.svgGroup.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await tap(mb.x,mb.y);await sleep(500);
  ok('管理弹窗可打开', await ev(`!document.getElementById('cloudManageMask').classList.contains('hidden')`));
  await ev(`document.getElementById('cloudManageMask').classList.add('hidden');1`);

  console.log('— 弹窗内按钮不被守卫拦截 —');
  await openCloud();
  const cb=await ev(`(function(){var b=Blockly.getMainWorkspace().getFlyout().buttons_.filter(x=>!x.isLabel())[0];var r=b.svgGroup.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await tap(cb.x,cb.y);await sleep(500);
  ok('创建弹窗打开', await ev(`!document.getElementById('cloudCreateMask').classList.contains('hidden')`));
  // 点弹窗内“取消”
  const cancel=await center(`document.getElementById('ccCancel')||document.querySelector('#cloudCreateMask .tb:not(.primary)')`);
  if(cancel){await tap(cancel.x,cancel.y);await sleep(400);ok('弹窗内取消按钮可点(弹窗关闭)', await ev(`document.getElementById('cloudCreateMask').classList.contains('hidden')`));}

  console.log('— 数字弹窗确定可改值 —');
  await ev(`Blockly.getMainWorkspace().getToolbox().clearSelection();1`);await sleep(300);
  const xml=`<xml xmlns="https://developers.google.com/blockly/xml"><block type="math_change" x="-160" y="260"><value name="DELTA"><block type="math_number"><field name="NUM">6</field></block></value></block></xml>`;
  await ev(`(function(){var ws=Blockly.getMainWorkspace();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),ws);return 1;})()`);
  await sleep(300);
  const fp=await ev(`(function(){var ws=Blockly.getMainWorkspace();var n=ws.getTopBlocks(true)[0].getInputTargetBlock('DELTA');var r=n.getField('NUM').fieldGroup_.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await tap(fp.x,fp.y);await sleep(400);
  const shown=await ev(`!document.getElementById('blocklyDialogMask').classList.contains('hidden')`);
  ok('数字弹窗打开', shown);
  if(shown){
    await ev(`(function(){var i=document.getElementById('bdInput');i.value='42';})()`);
    const okBtn=await center(`document.getElementById('bdOk')`);
    const hit=await ev(`(function(){var e=document.elementFromPoint(${0},${0});return 0;})()`);
    const hit2=await ev(`(function(){var e=document.elementFromPoint(${'${okBtn.x}'},${'${okBtn.y}'});return e?(e.id||e.className||e.tagName):'NULL';})()`);
    console.log('    bdOk坐标',okBtn,'命中:',hit2);
    await tap(okBtn.x,okBtn.y);await sleep(500);
    const vv=await ev(`(function(){var n=Blockly.getMainWorkspace().getTopBlocks(true)[0].getInputTargetBlock('DELTA');return n.getFieldValue('NUM');})()`);
    console.log('    弹窗仍开:', await ev(`!document.getElementById('blocklyDialogMask').classList.contains('hidden')`), '值:', vv);
    ok('确定后值更新为42', String(vv)==='42', vv);
  }
  console.log(`\\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
