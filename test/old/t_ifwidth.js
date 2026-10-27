const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,300));return r.result.value;};
await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(2200);
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(500);
await ev(`var i=document.getElementById('newAppName');i.value='宽测';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`);await sleep(1200);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(900);
// 复用当前工程：清空，放一个 elseif=1 的 if，IF0 塞长条件（逻辑比较：长文本 != 数字）
await ev(`blocklyWs.clear();1`);await sleep(200);
const xml=`<xml xmlns="https://developers.google.com/blockly/xml">
<block type="controls_if" x="200" y="100">
  <mutation elseif="1"></mutation>
  <value name="IF0">
    <block type="math_arithmetic" inline="true"><field name="OP">ADD</field>
      <value name="A"><block type="math_number"><field name="NUM">123456</field></block></value>
      <value name="B"><block type="math_number"><field name="NUM">789</field></block></value>
    </block></value>
      <value name="B"><block type="math_number"><field name="NUM">10</field></block></value>
    </block>
  </value>
</block></xml>`;
await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);1`);await sleep(300);
const inlineState=await ev(`(function(){var cs=blocklyWs.getBlocksByType('math_arithmetic');cs.forEach(c=>c.setInputsInline(true));return cs.map(c=>c.inputsInline).join(',');})()`);
console.log('compare inputsInline =',inlineState);await sleep(400);
const info=await ev(`JSON.stringify({info:window.__ifInfo,rows:window.__ifRows},null,1)`);
console.log(info);
// 截图（按块 bbox）
const q=await ev(`(function(){var b=blocklyWs.getTopBlocks(true).find(x=>x.type==='controls_if');var r=b.getSvgRoot().getBoundingClientRect();return JSON.stringify({x:Math.round(r.left-10),y:Math.round(r.top-10),w:Math.round(r.width+20),h:Math.round(r.height+20)});})()`);
const p=JSON.parse(q);
const s=await send('Page.captureScreenshot',{format:'png',clip:{x:p.x,y:p.y,width:p.w,height:p.h,scale:1.6}});
fs.writeFileSync('/tmp/t_ifwidth.png',Buffer.from(s.data,'base64'));
console.log('shot',JSON.stringify(p));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
