const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,600));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 矩阵：每行一个用例，纵向排列，横向 3 列
await ev(`(function(){
  var B=Blockly;
  function cmp(){return '<block type="logic_compare"><field name="OP">EQ</field></block>';}
  function vib(){return '<block type="act_vibrate"><value name="MS"><block type="math_number"><field name="NUM">200</field></block></value></block>';}
  function toast(long){return '<block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">'+(long?'提示内容比较长的文字哈哈':'提示')+'</field></block></value></block>';}
  var cases=[];
  // A 纯如果
  cases.push('<block type="controls_if"></block>');
  // B 如果+否则 等宽（短条件）
  cases.push('<block type="controls_if"><mutation else="1"></mutation></block>');
  // C 宽条件 + 否则（图二）
  cases.push('<block type="controls_if"><mutation else="1"></mutation><value name="IF0">'+cmp()+'</value></block>');
  // D 宽条件 + DO0 震动 + 否则
  cases.push('<block type="controls_if"><mutation else="1"></mutation><value name="IF0">'+cmp()+'</value><statement name="DO0">'+vib()+'</statement></block>');
  // E 否则槽里放宽块（toast 长文本）
  cases.push('<block type="controls_if"><mutation else="1"></mutation><statement name="ELSE">'+toast(true)+'</statement></block>');
  // F 如果+否则如果+否则，中间宽（图一）
  cases.push('<block type="controls_if"><mutation elseif="1" else="1"></mutation><value name="IF1">'+cmp()+'</value></block>');
  // G 三级否则如果，宽度交替 窄-宽-窄
  cases.push('<block type="controls_if"><mutation elseif="2" else="1"></mutation><value name="IF2">'+cmp()+'</value></block>');
  // H 宽在 IF0，槽内也宽（DO0 长 toast），否则窄
  cases.push('<block type="controls_if"><mutation elseif="1" else="1"></mutation><value name="IF0">'+cmp()+'</value><statement name="DO0">'+toast(true)+'</statement></block>');
  // I 嵌套：外层宽条件，内层纯如果
  cases.push('<block type="controls_if"><mutation else="1"></mutation><value name="IF0">'+cmp()+'</value><statement name="DO0"><block type="controls_if"></block></statement></block>');
  // J 嵌套：外层窄，内层（DO0内）宽条件+否则
  cases.push('<block type="controls_if"><mutation else="1"></mutation><statement name="DO0"><block type="controls_if"><mutation else="1"></mutation><value name="IF0">'+cmp()+'</value></block></statement></block>');
  // K 帽块 + 如果（宽条件）+ 下方普通块
  cases.push('<block type="ev_start" x="0" y="0"><next><block type="controls_if"><mutation else="1"></mutation><value name="IF0">'+cmp()+'</value><next><block type="act_exit"></block></next></block></next></block>');
  // L 纯如果 + 长条件
  cases.push('<block type="controls_if"><value name="IF0">'+cmp()+'</value></block>');
  var xml='<xml xmlns="https://developers.google.com/blockly/xml">';
  var COLW=560;
  cases.forEach(function(c,i){
    var col=i%3,row=Math.floor(i/3);
    var x=40+col*COLW, y=40+row*520;
    xml+=c.replace('<block ','<block x="'+x+'" y="'+y+'" ',1);
  });
  xml+='</xml>';
  B.Xml.domToWorkspace(B.utils.xml.textToDom(xml),blocklyWs);
  blocklyWs.getAllBlocks(false).forEach(function(b){if(b.rendered)b.render();});
  return cases.length;
})()`);
await sleep(900);
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/matrix_full.png',Buffer.from(s.data,'base64'));
// 分块包围盒裁剪
const boxes=await ev(`(function(){
  var bs=blocklyWs.getTopBlocks(true);
  return bs.map(function(b){var r=b.getSvgRoot().getBoundingClientRect();
    return {x:Math.floor(r.x),y:Math.floor(r.y),w:Math.ceil(r.width),h:Math.ceil(r.height)};});
})()`);
console.log('blocks',boxes.length);
for(let i=0;i<boxes.length;i++){
  const bx=boxes[i];
  s=await send('Page.captureScreenshot',{format:'png',clip:{x:Math.max(0,bx.x-8),y:Math.max(0,bx.y-8),width:bx.w+16,height:bx.h+16,scale:2}});
  fs.writeFileSync('/tmp/mx_'+String(i).padStart(2,'0')+'.png',Buffer.from(s.data,'base64'));
}
// 字母名修正
fs.writeFileSync('/tmp/mx_boxes.json',JSON.stringify(boxes));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
