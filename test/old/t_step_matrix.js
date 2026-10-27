const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');
await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(2200);
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails).slice(0,300));return r.result.value;};
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(500);
await ev(`var i=document.getElementById('newAppName');i.value='阶梯';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();1`);await sleep(1200);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(900);
// A: 宽条件(compare inline 大数字) + 空否则如果 + 否则
const xml=`<xml xmlns="https://developers.google.com/blockly/xml">
<block type="controls_if" x="80" y="60"><mutation elseif="1" else="1"></mutation>
  <value name="IF0"><block type="logic_compare" inline="true"><field name="OP">NEQ</field>
    <value name="A"><block type="math_number"><field name="NUM">12345678</field></block></value>
    <value name="B"><block type="math_number"><field name="NUM">10</field></block></value>
  </block></value>
</block>
<block type="controls_if" x="80" y="330"><mutation elseif="1" else="1"></mutation>
  <statement name="DO0"><block type="text_print"><value name="TEXT"><block type="text"><field name="TEXT">这是一个很长的输出内容用来撑宽第一个分支槽</field></block></value></block></statement>
</block>
<block type="controls_if" x="80" y="640"><mutation else="1"></mutation></block>
</xml>`;
await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);1`);await sleep(600);
await ev(`blocklyWs.zoomToFit&&blocklyWs.zoomToFit();1`);await sleep(400);
const s=await send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('/tmp/t_step_matrix.png',Buffer.from(s.data,'base64'));
// 读取每个块各单元右缘（从 path bbox 不易拆分，改为读 info 行宽，临时通过 block.width 与连接）
const report=await ev(`(function(){
 return JSON.stringify(blocklyWs.getTopBlocks(true).filter(b=>b.type==='controls_if').map(b=>{
   var bb=b.getSvgRoot().querySelector('path.blocklyPath').getBBox();
   return {w:Math.round(bb.width),h:Math.round(bb.height),ei:b.elseifCount_,el:b.elseCount_};
 }));
})()`);
console.log(report);
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
