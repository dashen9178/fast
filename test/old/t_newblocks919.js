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
const cats=await ev(`(function(){var tb=blocklyWs.getToolbox();return tb.getToolboxItems().map(function(it){return it.name_||(it.getName_?it.getName_():'?');});})()`);
console.log('分类:',JSON.stringify(cats));
async function cat(name){const r=await ev(`(function(name){var tb=blocklyWs.getToolbox();var list=tb.getToolboxItems();
  for(var i=0;i<list.length;i++){var n=list[i].name_||(list[i].getName_?list[i].getName_():'');
  if(n===name){tb.setSelectedItem(list[i]);return 'ok';}}return 'NOTFOUND';})(${JSON.stringify(name)})`);console.log('切分类',name,r);await sleep(500);}
await cat('文本');
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/fly_text.png',Buffer.from(s.data,'base64'));
const castInFlyout=await ev(`Array.from(document.querySelectorAll('.blocklyFlyout text.blocklyText')).some(function(t){return t.textContent.indexOf('转换为')>=0;})`);
console.log('文本flyout含转换字符串:',castInFlyout);
const clipText=await ev(`(function(){
  var bg=document.querySelector('.blocklyFlyoutBackground');if(!bg)return 'noFlyout';
  var r=bg.getBoundingClientRect();
  var texts=Array.from(document.querySelectorAll('.blocklyFlyout text.blocklyText'));
  var bad=texts.filter(function(t){var b=t.getBoundingClientRect();return b.right>r.right-2;});
  return {flyoutRight:Math.round(r.right),cutCount:bad.length,cut:bad.slice(0,6).map(function(t){return t.textContent.slice(0,12)+'@'+Math.round(t.getBoundingClientRect().right);})};
})()`);
console.log('文本flyout裁切:',JSON.stringify(clipText));
await cat('数据列表');
await sleep(300);
s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/fly_list.png',Buffer.from(s.data,'base64'));
const groupInFlyout=await ev(`Array.from(document.querySelectorAll('.blocklyFlyout text.blocklyText')).some(function(t){return t.textContent.indexOf('把')>=0;})`);
console.log('数据列表flyout含组合积木:',groupInFlyout);
const clipList=await ev(`(function(){
  var bg=document.querySelector('.blocklyFlyoutBackground');var r=bg.getBoundingClientRect();
  var texts=Array.from(document.querySelectorAll('.blocklyFlyout text.blocklyText'));
  var bad=texts.filter(function(t){var b=t.getBoundingClientRect();return b.right>r.right-2;});
  return {flyoutRight:Math.round(r.right),cutCount:bad.length,cut:bad.slice(0,6).map(function(t){return t.textContent.slice(0,12)+'@'+Math.round(t.getBoundingClientRect().right);})};
})()`);
console.log('列表flyout裁切:',JSON.stringify(clipList));
await ev(`(function(){var B=Blockly;
 var c=B.Xml.domToBlock(B.utils.xml.textToDom('<xml><block type="val_cast"></block></xml>').firstChild,blocklyWs);
 c.initSvg();c.render();c.moveBy(300,80);
 var g=B.Xml.domToBlock(B.utils.xml.textToDom('<xml><block type="val_group"></block></xml>').firstChild,blocklyWs);
 g.initSvg();g.render();g.moveBy(300,300);
 return 1;})()`);
await sleep(500);
const STATE_FN=`(function(){
  var g=blocklyWs.getBlocksByType('val_group')[0];
  var vis=g.inputList.filter(function(i){return i.connection;});
  var texts=vis.map(function(i){var f=i.fieldRow[0];return f&&f.getText?f.getText():'';});
  var minus=document.getElementById('ifMutMinus');
  return {items:g.itemCount_,inputs:vis.length,texts:texts,minusDisabled:minus?minus.disabled:null};
})()`;
console.log('val_group初始:',JSON.stringify(await ev(STATE_FN)));
async function click(x,y){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x,y:y});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x,y:y,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x,y:y,button:'left',buttons:0,clickCount:1});await sleep(300);}
const gp=JSON.parse(await ev(`(function(){var g=blocklyWs.getBlocksByType('val_group')[0];
  var icon=g.getSvgRoot().querySelector('.blockly-icon-mutator');var r=icon.getBoundingClientRect();
  return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()`));
await click(gp.x,gp.y);
console.log('菜单打开(应2,置灰):',JSON.stringify(await ev(STATE_FN)));
async function gtap(id){const p=JSON.parse(await ev(`(function(id){var p=document.getElementById(id);var r=p.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})(${JSON.stringify(id)})`));await click(p.x,p.y);}
await gtap('ifMutPlus');console.log('+1(应3 把，，和):',JSON.stringify(await ev(STATE_FN)));
await gtap('ifMutPlus');console.log('+2(应4):',JSON.stringify(await ev(STATE_FN)));
await gtap('ifMutPlus');console.log('+3(应5):',JSON.stringify(await ev(STATE_FN)));
await gtap('ifMutMinus');await gtap('ifMutMinus');await gtap('ifMutMinus');
console.log('连减3(应2,置灰):',JSON.stringify(await ev(STATE_FN)));
await ev(`var m=document.querySelector('#ifMutMenu');if(m)m.classList.add('hidden');var mk=m&&m.previousElementSibling;if(mk)mk.classList.add('hidden');1`);
const round=await ev(`(function(){var B=Blockly;
 var g=blocklyWs.getBlocksByType('val_group')[0];
 var txt=B.Xml.domToText(B.Xml.blockToDomWithXY(g));
 blocklyWs.clear();
 var g2=B.Xml.domToBlock(B.utils.xml.textToDom('<xml>'+txt+'</xml>').firstChild,blocklyWs);
 g2.initSvg();g2.render();g2.moveBy(300,200);
 return {xml:txt,itemsAfter:g2.itemCount_,inputs:g2.inputList.filter(function(i){return i.connection;}).length};
})()`);
console.log('持久化:',JSON.stringify(round));
const code=await ev(`(function(){var B=Blockly;
 function gen(xml){var b=B.Xml.domToBlock(B.utils.xml.textToDom('<xml>'+xml+'</xml>').firstChild,blocklyWs);b.initSvg();return B.JavaScript.blockToCode(b);}
 return {
  castStr:gen('<block type="val_cast"><field name="TYPE">String</field><value name="V"><block type="math_number"><field name="NUM">3</field></block></value></block>'),
  castNum:gen('<block type="val_cast"><field name="TYPE">Number</field></block>'),
  castBool:gen('<block type="val_cast"><field name="TYPE">Boolean</field><value name="V"><block type="logic_boolean"><field name="BOOL">TRUE</field></block></value></block>'),
  group:gen('<block type="val_group"><mutation items="3"></mutation><value name="ADD0"><block type="math_number"><field name="NUM">1</field></block></value><value name="ADD1"><block type="math_number"><field name="NUM">2</field></block></value><value name="ADD2"><block type="math_number"><field name="NUM">3</field></block></value></block>')
 };})()`);
console.log('代码生成:',JSON.stringify(code));
await ev(`blocklyWs.getAllBlocks(false).forEach(function(b){if(b.rendered)b.render();});1`);
s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/newblocks.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
