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
await ev(`(function(){var B=Blockly;
 var b=B.Xml.domToBlock(B.utils.xml.textToDom('<xml><block type="controls_if"></block></xml>').firstChild,blocklyWs);
 b.initSvg();b.render();b.moveBy(200,100);return 1;})()`);
await sleep(400);
async function click(x,y){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x,y:y});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x,y:y,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x,y:y,button:'left',buttons:0,clickCount:1});await sleep(300);}
async function gearPos(){return JSON.parse(await ev(`(function(){var b=blocklyWs.getBlocksByType('controls_if')[0];
  var icon=b.getSvgRoot().querySelector('.blockly-icon-mutator');var r=icon.getBoundingClientRect();
  return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()`));}
async function state(){return ev(`(function(){var b=blocklyWs.getBlocksByType('controls_if')[0];
  return {elseif:b.elseifCount_,else:b.elseCount_,
    minusDisabled:document.getElementById('ifMutMinus').disabled};})()`);}
async function openGear(){var g=await gearPos();await click(g.x,g.y);await sleep(200);}
async function closeGear(){await ev(`var m=document.querySelector('#ifMutMenu');if(m)m.classList.add('hidden');var mk=m&&m.previousElementSibling;if(mk)mk.classList.add('hidden');1`);}
async function tap(id){var p=JSON.parse(await ev(`(function(){var p=document.getElementById('${id}');var r=p.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()`));await click(p.x,p.y);}
console.log('初始纯如果',JSON.stringify(await state()));
await openGear();
console.log('开菜单(应0/0,减号置灰)',JSON.stringify(await state()));
await closeGear();
console.log('关菜单后(应仍0/0)',JSON.stringify(await state()));
await openGear();await tap('ifMutPlus');
console.log('+1(应elseif0 else1)',JSON.stringify(await state()));
await tap('ifMutPlus');
console.log('+2(应elseif1 else1)',JSON.stringify(await state()));
await tap('ifMutPlus');
console.log('+3(应elseif2 else1)',JSON.stringify(await state()));
await tap('ifMutMinus');
console.log('-1(应elseif1 else1)',JSON.stringify(await state()));
await closeGear();
// 截图最终形态
blocklyWs && 0;
await ev(`blocklyWs.centerOnBlock(blocklyWs.getBlocksByType('controls_if')[0].id);1`);
await sleep(300);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/gear_plus.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
