const WebSocket=require('ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{
 const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
 await new Promise(r=>ws.on('open',r));
 ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
 const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:2,mobile:true});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?r.result.value:undefined;};
 await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(1100);
 await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
 await ev(`var n=document.getElementById('newAppName');if(n){n.value='reg';n.dispatchEvent(new Event('input',{bubbles:true}));}1`);await sleep(100);
 await ev(`document.getElementById('createGo').click();1`);await sleep(700);
 await ev(`document.getElementById('tabBlocks').click();1`);await sleep(900);

 // 构造：controls_if 里 THEN 放一个真实 act_toast（带 shadow 输入）
 const setup=await ev(`(function(){
  var B=Blockly,ws=window.blocklyWs;
  var xml='<xml><block type="controls_if" x="120" y="80"><statement name="DO0"><block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">hi</field></shadow></value></block></statement></block></xml>';
  B.Xml.domToWorkspace(B.utils.xml.textToDom(xml),ws);
  var ifb=ws.getBlocksByType('controls_if')[0];
  // 真实块数：if + toast = 2（shadow text 不计）
  var real=ifb.getDescendants(false).filter(function(x){return !x.isShadow();}).length;
  return '真实块数(应2)='+real+' 总块数(含shadow)='+ifb.getDescendants(false).length;
 })()`);
 console.log('1.',setup);

 // 长按 if 块
 const pos=await ev(`(function(){var b=window.blocklyWs.getBlocksByType('controls_if')[0];var r=b.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:r.x+30,y:r.y+14});})()`);
 const pp=JSON.parse(pos);
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:pp.x,y:pp.y});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pp.x,y:pp.y,button:'left',buttons:1,clickCount:1});
 await sleep(560);
 const menu=await ev(`(function(){var items=document.querySelectorAll('#lpMenu .menu-item, .lp-pop .menu-item, [class*="lp"] .menu-item');var arr=Array.prototype.map.call(document.querySelectorAll(".popover:not(.hidden) .menu-item"),function(i){return i.textContent;});return JSON.stringify(arr);})()`);
 console.log('2. 长按菜单:',menu);
 // 释放
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pp.x,y:pp.y,button:'left',buttons:0,clickCount:1});
 await sleep(100);

 // 复制此单个（点第二项），然后空白粘贴
 const copySingle=await ev(`(function(){var items=document.querySelectorAll(".popover:not(.hidden) .menu-item");if(items[1]){items[1].click();return '点了:'+items[1].textContent;}return '无';})()`);
 console.log('3.',copySingle);
 await sleep(300);
 // 关闭可能残留菜单
 await ev(`document.querySelectorAll('.lp-mask,[class*="mask"]').forEach(function(m){});1`);
 // 空白处长按
 const bp=JSON.parse(await ev(`(function(){var r=document.getElementById('blocklyDiv').getBoundingClientRect();return JSON.stringify({x:r.right-60,y:r.bottom-60});})()`));
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:bp.x,y:bp.y});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:bp.x,y:bp.y,button:'left',buttons:1,clickCount:1});
 await sleep(560);
 const blankMenu=await ev(`(function(){return JSON.stringify(Array.prototype.map.call(document.querySelectorAll(".popover:not(.hidden) .menu-item"),function(i){return i.textContent;}));})()`);
 console.log('4. 空白菜单:',blankMenu);
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:bp.x,y:bp.y,button:'left',buttons:0,clickCount:1});
 await sleep(100);
 // 粘贴积木（第一项）
 const before=await ev(`window.blocklyWs.getAllBlocks(false).filter(function(x){return !x.isShadow();}).length`);
 const paste=await ev(`(function(){var items=document.querySelectorAll(".popover:not(.hidden) .menu-item");if(items[0]&&items[0].textContent.indexOf('粘贴')>=0){items[0].click();return '粘贴';}return '第一项:'+(items[0]?items[0].textContent:'无');})()`);
 await sleep(300);
 const after=await ev(`window.blocklyWs.getAllBlocks(false).filter(function(x){return !x.isShadow();}).length`);
 console.log('5.',paste,' 粘贴前真实块数='+before+' 粘贴后='+after);

 // 撤销/重做存在
 const undo=await ev(`(function(){try{Blockly.getMainWorkspace().undo(0);return '撤销后='+Blockly.getMainWorkspace().getAllBlocks(false).filter(function(x){return !x.isShadow();}).length;}catch(e){return 'undo err '+e;}})()`);
 console.log('6.',undo);
 const redo=await ev(`(function(){try{Blockly.getMainWorkspace().undo(1);return '重做后='+Blockly.getMainWorkspace().getAllBlocks(false).filter(function(x){return !x.isShadow();}).length;}catch(e){return 'redo err '+e;}})()`);
 console.log('7.',redo);
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
