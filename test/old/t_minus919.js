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
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,500));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 构造 n=3（2 否则如果 + 否则），每个分支条件和槽内都放积木
await ev(`(function(){
  var B=Blockly;
  function cond(v){return '<value name="IF'+v+'"><block type="logic_compare"><field name="OP">EQ</field></block></value>';}
  function body(txt){return '<statement name="DO'+v2(txt)+'"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">'+txt+'</field></block></value></block></statement>';}
  function v2(t){return t;}
  var xml='<xml xmlns="https://developers.google.com/blockly/xml">'
    +'<block type="controls_if" x="120" y="60"><mutation elseif="2" else="1"></mutation>'
    + cond(0) + body(0)
    + cond(1) + body(1)
    + cond(2) + body(2)
    + '<statement name="ELSE"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">else块</field></block></value></block></statement>'
    +'</block></xml>';
  B.Xml.domToWorkspace(B.utils.xml.textToDom(xml),blocklyWs);
  return 1;})()`);
await sleep(600);
async function snap(label){var o=await ev(`(function(){
  var b=blocklyWs.getTopBlocks(true).filter(function(x){return x.type==='controls_if';})[0];
  function has(input){var i=b.getInput(input);return !!(i&&i.connection&&i.connection.targetConnection);}
  return {n:b.elseifCount_+(b.elseCount_?1:0),
    IF0:has('IF0'),DO0:has('DO0'),IF1:has('IF1'),DO1:has('DO1'),
    IF2:has('IF2'),DO2:has('DO2'),ELSE:has('ELSE'),
    topCount:blocklyWs.getTopBlocks(true).length};
})()`);o.label=label;return o;}
console.log('初始',JSON.stringify(await snap('init')));
// 打开齿轮
const gp=JSON.parse(await ev(`(function(){var b=blocklyWs.getTopBlocks(true).filter(function(x){return x.type==='controls_if';})[0];
 var icon=b.getSvgRoot().querySelector('.blockly-icon-mutator');var r=icon.getBoundingClientRect();
 return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()`));
async function click(x,y){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x,y:y});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x,y:y,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x,y:y,button:'left',buttons:0,clickCount:1});await sleep(350);}
await click(gp.x,gp.y);
const menuOpen=await ev(`!!document.querySelector('#ifMutMenu:not(.hidden)')`);
console.log('菜单打开:',menuOpen);
const hintGone=await ev(`!document.getElementById('ifMutHint')`);
console.log('提示已删:',hintGone);
async function btn(id){return JSON.parse(await ev(`(function(){var p=document.getElementById('${id}');var r=p.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,disabled:p.disabled});})()`));}
var mp=await btn('ifMutMinus');
await click(mp.x,mp.y);
console.log('减1次',JSON.stringify(await snap('minus1')));
mp=await btn('ifMutMinus');
await click(mp.x,mp.y);
console.log('减2次',JSON.stringify(await snap('minus2')));
// 撤销两次
await ev(`blocklyWs.undo(false);1`);await sleep(300);
console.log('撤销1',JSON.stringify(await snap('undo1')));
await ev(`blocklyWs.undo(false);1`);await sleep(300);
console.log('撤销2',JSON.stringify(await snap('undo2')));
// 重做两次
await ev(`blocklyWs.undo(true);1`);await sleep(300);
console.log('重做1',JSON.stringify(await snap('redo1')));
// 截图当前（减后状态 n=2）
await click(gp.x-30,gp.y-30); // 点菜单外关闭（可能被 catcher 拦，用 mask 关闭）
await sleep(200);
await ev(`var mk=document.querySelector('#ifMutMask')||document.querySelector('#ifMutMenu').previousElementSibling;if(mk){var r=mk.getBoundingClientRect();}1`);
// 直接用类名隐藏
await ev(`var m=document.querySelector('#ifMutMenu');if(m)m.classList.add('hidden');var mk=m&&m.previousElementSibling;if(mk)mk.classList.add('hidden');1`);
await sleep(200);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/gear_minus.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
