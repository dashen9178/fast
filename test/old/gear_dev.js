const WebSocket=require('ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{
 const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
 await new Promise(r=>ws.on('open',r));
 ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
 const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
 await send('Page.enable');await send('Runtime.enable');
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?r.result.value:undefined;};
 await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(1200);
 await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
 await ev(`var n=document.getElementById('newAppName');if(n){n.value='t';n.dispatchEvent(new Event('input',{bubbles:true}));}1`);await sleep(100);
 await ev(`document.getElementById('createGo').click();1`);await sleep(700);
 await ev(`document.getElementById('tabBlocks').click();1`);await sleep(900);

 // ===== 1. 齿轮 bug =====
 const r1=await ev(`(function(){
  var B=Blockly,ws=window.blocklyWs,log=[];
  function mkIf(){return B.Xml.domToBlock(B.utils.xml.textToDom('<xml><block type="controls_if"></block></xml>').firstChild,ws);}
  var b=mkIf();b.initSvg();b.render();b.moveBy(120,80);
  log.push('初始 elseif='+b.elseifCount_+' else='+b.elseCount_);
  // 找齿轮图标
  var icon=b.getSvgRoot().querySelector('.blockly-icon-mutator');
  var r=icon.getBoundingClientRect();
  window.__gear={x:r.x+r.width/2,y:r.y+r.height/2};
  return JSON.stringify(log);
 })()`);
 console.log('1.',r1);
 const gp=JSON.parse(await ev(`JSON.stringify(window.__gear)`));
 // 点齿轮打开
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:gp.x,y:gp.y});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:gp.x,y:gp.y,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:gp.x,y:gp.y,button:'left',buttons:0,clickCount:1});
 await sleep(400);
 const afterOpen=await ev(`(function(){var b=window.blocklyWs.getBlocksByType('controls_if')[0];return '打开菜单后 elseif='+b.elseifCount_+' else='+b.elseCount_+' 菜单显示='+(document.querySelector('#ifMutMenu:not(.hidden)')?'是':'否');})()`);
 console.log('2.',afterOpen);
 // 关闭菜单（点 mask）
 await ev(`var m=document.querySelector('#ifMutMenu');var r=m.getBoundingClientRect();window.__mt={x:r.x-20,y:r.y+10};1`);
 const mt=JSON.parse(await ev(`JSON.stringify(window.__mt)`));
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:mt.x,y:mt.y,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:mt.x,y:mt.y,button:'left',buttons:0,clickCount:1});
 await sleep(300);
 const afterClose=await ev(`(function(){var b=window.blocklyWs.getBlocksByType('controls_if')[0];return '关闭后(不应有否则) elseif='+b.elseifCount_+' else='+b.elseCount_;})()`);
 console.log('3.',afterClose);
 // 重新打开，点 +
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:gp.x,y:gp.y});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:gp.x,y:gp.y,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:gp.x,y:gp.y,button:'left',buttons:0,clickCount:1});
 await sleep(300);
 const plus=await ev(`(function(){var p=document.getElementById('ifMutPlus');var r=p.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()`);
 const pp=JSON.parse(plus);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:pp.x,y:pp.y,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:pp.x,y:pp.y,button:'left',buttons:0,clickCount:1});
 await sleep(300);
 const afterPlus=await ev(`(function(){var b=window.blocklyWs.getBlocksByType('controls_if')[0];return '点+后 elseif='+b.elseifCount_+' else='+b.elseCount_;})()`);
 console.log('4.',afterPlus);
 // 点 − 回 0
 const minus=await ev(`(function(){var p=document.getElementById('ifMutMinus');var r=p.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()`);
 const mp=JSON.parse(minus);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:mp.x,y:mp.y,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:mp.x,y:mp.y,button:'left',buttons:0,clickCount:1});
 await sleep(300);
 const afterMinus=await ev(`(function(){var b=window.blocklyWs.getBlocksByType('controls_if')[0];return '点-后 elseif='+b.elseifCount_+' else='+b.elseCount_;})()`);
 console.log('5.',afterMinus);
 await ev(`document.querySelector('#ifMutMenu')&&(document.querySelector('#ifMutMenu').classList.add('hidden'),document.querySelector('#ifMutMenu').previousElementSibling&&document.querySelector('#ifMutMenu').previousElementSibling.classList.add('hidden'));1`);

 // ===== 2. toast 生成代码 =====
 const toastCode=await ev(`(function(){
  var B=Blockly,ws=window.blocklyWs;
  var b=B.Xml.domToBlock(B.utils.xml.textToDom('<xml><block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">提示内容</field></shadow></value><value name="DUR"><shadow type="math_number"><field name="NUM">2</field></shadow></value></block></xml>').firstChild,ws);
  b.initSvg();
  return B.JavaScript.blockToCode(b);
 })()`);
 console.log('6. toast代码:',JSON.stringify(toastCode).trim());

 // ===== 3. 设备积木 =====
 const devCode=await ev(`(function(){
  var B=Blockly,ws=window.blocklyWs;
  var b=B.Xml.domToBlock(B.utils.xml.textToDom('<xml><block type="val_device_info"><field name="KEY">fps</field></block></xml>').firstChild,ws);
  b.initSvg();
  return B.JavaScript.blockToCode(b);
 })()`);
 console.log('7. 设备积木代码:',JSON.stringify(devCode).trim());
 const toolbox=await ev(`document.querySelector('.blocklyTreeRow:not(.blocklyTreeSeparator)')? 'ok':'no'`);
 const devCat=await ev(`(function(){var xml=window.buildToolboxXml(null);return ['val_device_info','act_set_brightness','act_keep_screen','act_copy','act_toast'].map(function(t){return t+':'+(xml.indexOf(t)>=0);}).join(' ');})()`);
 console.log('8. 工具箱含新积木:',devCat);

 // ===== 4. runtime 兜底 deviceVal（模拟无原生）=====
 const rtTest=await ev(`(function(){
   try { return 'RT存在:'+(typeof RT); } catch(e){ return 'runtime未加载(正常,编辑器页)'; }
 })()`);
 console.log('9.',rtTest);
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
