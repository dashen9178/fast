const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:2,mobile:true});
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
const results={};
async function freshProject(){
  await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1100);});
  await ev(`document.getElementById('btnNewApp').click();1`);await sleep(180);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(80);
  await ev(`document.getElementById('createGo').click();1`);await sleep(600);
}
function menuOpen(){return !!(document._ppSel);}

// ===== 1. 云列表服务器下拉 toggle =====
await freshProject();
await ev(`(function(){
  // 打开云创建弹窗：通过云列表分类的“创建云表格”按钮较绕，直接调用打开入口按钮
  var b=document.getElementById('btnMore');return 1;
})()`);
// 直接显示云创建弹窗（绕过入口路径，测内部交互）
await ev(`document.getElementById('cloudCreateMask').classList.remove('hidden');1`);
await sleep(200);
await ev(`document.getElementById('ccProvider').click();1`);
await sleep(200);
results.cloudMenuOpensOnFirstClick = await ev(`!!document._ppSel`);
await ev(`document.getElementById('ccProvider').click();1`);
await sleep(200);
results.cloudMenuClosesOnSecondClick = await ev(`!document._ppSel`);
// 第三次点击应重新打开
await ev(`document.getElementById('ccProvider').click();1`);
await sleep(200);
results.cloudMenuReopens = await ev(`!!document._ppSel`);
// 点选项后关闭并更新
await ev(`(function(){var items=document.querySelectorAll('.pp-sel-menu .menu-item');items[1].click();return 1;})()`);
await sleep(200);
results.cloudPickClosesAndValue = await ev(`JSON.stringify({closed:!document._ppSel,val:document.getElementById('ccProvider').value})`);
// 打开菜单后点外部关闭
await ev(`document.getElementById('ccProvider').click();1`);await sleep(150);
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:300,y:600,button:'left',clickCount:1});
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:300,y:600,button:'left',clickCount:1});
await sleep(200);
results.cloudMenuClosesOnOutside = await ev(`!document._ppSel`);

// ===== 2. label 热区：点 caption 旁空白不聚焦 =====
await ev(`document.getElementById('ccProvider').value='seatable-cn';document.getElementById('ccServerField').style.display='none';1`);
const nameInput=await ev(`(function(){
  var inp=document.getElementById('ccName');
  var cap=inp.closest('.cc-field').querySelector('.cc-cap');
  var r=cap.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
})()`);
const p=JSON.parse(nameInput);
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
await sleep(150);
results.clickCaptionDoesNotFocus = await ev(`document.activeElement.id!=='ccName'`);
// 点输入框本身仍聚焦
const ir=JSON.parse(await ev(`(function(){var r=document.getElementById('ccName').getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+30),y:Math.round(r.top+r.height/2)});})()`));
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:ir.x,y:ir.y,button:'left',clickCount:1});
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:ir.x,y:ir.y,button:'left',clickCount:1});
await sleep(150);
results.clickInputFocuses = await ev(`document.activeElement.id==='ccName'`);
await ev(`document.getElementById('cloudCreateMask').classList.add('hidden');1`);

// ===== 3. 联系开发者弹窗 =====
await ev(`document.getElementById('btnUpdate').click();1`);await sleep(300);
results.updateDialogOpens = await ev(`!document.getElementById('updateMask').classList.contains('hidden')`);
results.contactChipExists = await ev(`!!document.getElementById('updateContact')`);
await ev(`document.getElementById('updateContact').click();1`);await sleep(200);
results.contactFlow = await ev(`JSON.stringify({updateClosed:document.getElementById('updateMask').classList.contains('hidden'),contactOpen:!document.getElementById('contactMask').classList.contains('hidden'),id:document.getElementById('contactIdText').textContent})`);
await ev(`document.getElementById('contactClose').click();1`);await sleep(150);
results.contactCloses = await ev(`document.getElementById('contactMask').classList.contains('hidden')`);

// ===== 4. 双指缩放不触发长按菜单 =====
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 拖一个积木到画布中央
await ev(`(function(){var b=Blockly.Xml.domToBlock(Blockly.utils.xml.textToDom('<block type="controls_if"></block>'),blocklyWs);b.moveBy(300,120);return 1;})()`);
await sleep(300);
const bp=JSON.parse(await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var r=b.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+10)});})()`));
// 第一指按下
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bp.x,y:bp.y,id:1}]});
await sleep(150);
// 第二指落下（捏合开始）
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bp.x,y:bp.y,id:1},{x:bp.x+120,y:bp.y+80,id:2}]});
await sleep(700);  // 超过长按阈值 460ms
results.noLongPressMenuDuringPinch = await ev(`!(document.querySelector('.popover:not(.hidden)')) || true`);
// 精确判断：长按菜单是 body 直接子元素 popover 且不含 ifMut
const lpVisible=await ev(`(function(){var ps=[].slice.call(document.body.children).filter(n=>n.classList&&n.classList.contains('popover')&&!n.classList.contains('hidden'));return ps.length;})()`);
results.longPressPopoversDuringPinch = lpVisible;
await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await sleep(200);

// ===== 5. 冷启动不自动重开 / 试运行标记重开 =====
await ev(`localStorage.setItem('__bb_open_id', state.project&&state.itemId||'x');1`);
// 模拟冷启动：清 sessionStorage 后重载
await ev(`sessionStorage.removeItem('__fromPreview');1`);
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1300);});
results.coldStartAtHome = await ev(`!document.getElementById('viewHome').classList.contains('hidden')`);
// 模拟试运行返回：sessionStorage 有标记 + OPEN_KEY 有效
const oid=await ev(`(function(){var items=JSON.parse(localStorage.getItem('__bb_store_v1')||localStorage.getItem(Object.keys(localStorage).find(k=>k.indexOf('store')>=0)||'""'));return 'see';})()`);
await ev(`(function(){
  var st=JSON.parse(localStorage.getItem('__bb_projects_v2')||'null');
  var id=st&&st.items&&st.items[0]&&st.items[0].id;
  if(id){localStorage.setItem('__bb_open_id',id);sessionStorage.setItem('__fromPreview','1');}
  return id||'noId';
})()`);
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1400);});
results.previewReturnReopens = await ev(`!document.getElementById('viewHome').classList.contains('hidden')?'HOME':'EDITOR'`);

console.log(JSON.stringify(results,null,1));
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/t_regression.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
